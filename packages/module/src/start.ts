import type { Server } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { databaseUrl, readModuleConfig, type Environment } from './config'
import { createModuleServer, type BaseHandlers, type ModuleDefinition } from './server'
import { closeModulePool, configureStore } from './store'
import { createDiagnostics } from './diagnostics'
import { MigrationError, readMigrations, migrate, type Migration } from './migrations'
import type { Manifest } from './manifest'
import { loadUi, readHostOrigins } from './ui'
import { createModuleDeps } from './deps'
import { json, withModule } from './http'
import type { RouteDef } from './routes'
/**
 * El arranque de un módulo (`node server.cjs`, o `npx tsx src/main.ts` en desarrollo). Extraído de una vertical
 * anterior en producción. Valida su configuración y sus migraciones, y nada más; si falla, un mensaje
 * sin valores y código 1. Escucha en HOSTNAME:PORT (por defecto 127.0.0.1:3000). Con SIGTERM o SIGINT deja de
 * aceptar, termina lo que esté en curso, cierra el pool y sale con 0.
 *
 * `node server.cjs migrate`: aplica las migraciones con el rol propietario (`DATABASE_OWNER_URL`), concede al rol de
 * `DATABASE_URL` lo suyo y escribe una línea JSON por resultado. Código 0 si todo fue bien.
 *
 * `node server.cjs seed`: aplica los datos de ejemplo (`SEEDS_DIR`, por defecto `./seeds`, en orden) con el rol
 * propietario. Solo en la compilación de desarrollo: el bundle de producción no lo admite.
 *
 * Las migraciones están en `MIGRATIONS_DIR` o, por defecto, en `./migrations` (junto a `server.cjs` en la imagen).
 * Fuera de la imagen, fija siempre `HOSTNAME=127.0.0.1`: muchas distribuciones y Docker la exportan con el nombre del
 * equipo, y con un nombre heredado el módulo escucha donde resuelva ese nombre.
 */
export interface StartOptions<R extends readonly RouteDef[]> extends ModuleDefinition<R> {
  manifest: Manifest
  baseHandlers?: Partial<BaseHandlers>
  onStop?: () => Promise<void>
  env?: Environment
  argv?: readonly string[]
}
export const CANCELLED = 'Configuración del módulo incompleta o no válida. Arranque cancelado.'

const migrationsDir = (env: Environment) => resolve(env.MIGRATIONS_DIR?.trim() || 'migrations')

export function startModule<const R extends readonly RouteDef[]>(options: StartOptions<R>): Server | undefined {
  const env = options.env ?? process.env
  const command = (options.argv ?? process.argv.slice(2))[0]
  if (command === 'migrate') {
    void runMigrateCommand(options.manifest, env).then(code => process.exit(code))
    return undefined
  }
  if (command === 'seed') {
    void runSeedCommand(options.manifest, env).then(code => process.exit(code))
    return undefined
  }
  const hostname = env.HOSTNAME?.trim() || '127.0.0.1'
  const port = Number(env.PORT?.trim() || 3000)
  let server: Server
  try {
    readModuleConfig(env)
    databaseUrl(env)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT')
    const migrations = readMigrations(migrationsDir(env))
    configureStore(options.manifest.schema, env)
    const diagnostics = createDiagnostics({ key: options.manifest.key, schema: options.manifest.schema, migrations, databaseUrl: () => databaseUrl(env), commit: env.BUILD_REVISION?.trim() })
    // Con pantallas en `module.json`, la interfaz construida (`UI_DIR`, por defecto `./ui`) y quién puede embeberla.
    const ui = options.manifest.ui ? loadUi(resolve(env.UI_DIR?.trim() || 'ui'), options.manifest, readHostOrigins(env.PIMIA_HOST_ORIGINS)) : undefined
    // `/api/session`: quién llama según su token de módulo (persona, empresa, instancia, permisos y quién lo pidió).
    // Lo usan el diagnóstico y la suite de contrato; no dice nada que el token no diga ya.
    const deps = createModuleDeps(options.manifest, env)
    const session = { GET: (request: Request) => withModule(request, deps, async who => json({ data: who })) }
    server = createModuleServer(options, { baseHandlers: { ...diagnostics, session, ...options.baseHandlers }, ui })
  } catch {
    console.error(CANCELLED)
    process.exit(1)
  }
  const cannotListen = () => {
    console.error('El módulo no puede escuchar en HOSTNAME:PORT. Arranque cancelado.')
    process.exit(1)
  }
  server.once('error', cannotListen)
  server.listen(port, hostname, () => {
    server.off('error', cannotListen)
    console.log(`Módulo ${options.manifest.key} escuchando en ${hostname}:${port}`)
  })

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    const cerrar = async () => { await closeModulePool().catch(() => {}); await options.onStop?.() }
    server.close(() => { void cerrar().catch(() => {}).finally(() => process.exit(0)) })
    // Dentro del plazo de `docker stop` (10 s): lo que siga abierto a los 8 s se corta, y se sale igual con 0.
    setTimeout(() => {
      server.closeAllConnections()
      setTimeout(() => process.exit(0), 1_000).unref()
    }, 8_000).unref()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  return server
}

/** `migrate`: una línea JSON con el resultado. Nunca escribe una dirección de base. */
async function runMigrateCommand(manifest: Manifest, env: Environment): Promise<number> {
  const line = (data: Record<string, unknown>) => console.log(JSON.stringify({ step: 'migrations', ...data }))
  let migrations: Migration[], ownerUrl: string, runtimeRole: string
  try {
    migrations = readMigrations(migrationsDir(env))
  } catch (error) {
    line({ status: 'error', reason: error instanceof MigrationError ? error.reason : 'directory', message: error instanceof Error ? error.message : '' })
    return 1
  }
  try {
    ownerUrl = databaseUrl({ DATABASE_URL: env.DATABASE_OWNER_URL })
    runtimeRole = decodeURIComponent(new URL(databaseUrl(env)).username)
    if (!runtimeRole) throw new Error()
  } catch {
    line({ status: 'error', reason: 'configuration', message: 'Faltan DATABASE_OWNER_URL o DATABASE_URL (con su usuario)' })
    return 1
  }
  try {
    const result = await migrate({ ownerUrl, runtimeRole, schema: manifest.schema, migrations })
    line({ status: 'ok', schema: manifest.schema, applied: result.applied.map(m => `${String(m.version).padStart(4, '0')}_${m.name}`), already_applied: result.alreadyApplied })
    return 0
  } catch (error) {
    if (error instanceof MigrationError) line({ status: 'error', reason: error.reason, version: error.version ?? null, message: error.message })
    else line({ status: 'error', reason: 'database', message: 'No se pudo conectar con la base o aplicar las migraciones' })
    return 1
  }
}

/** `seed`: los datos de ejemplo, en orden, con el rol propietario y en el esquema del módulo. Solo desarrollo. */
async function runSeedCommand(manifest: Manifest, env: Environment): Promise<number> {
  const line = (data: Record<string, unknown>) => console.log(JSON.stringify({ step: 'seed', ...data }))
  if (process.env.DVI_BUILD === 'production' || env.NODE_ENV === 'production') {
    line({ status: 'error', reason: 'production', message: 'Los datos de ejemplo no se aplican en producción' })
    return 1
  }
  const dir = resolve(env.SEEDS_DIR?.trim() || 'seeds')
  let files: string[]
  try { files = readdirSync(dir).filter(file => /^\d{4}_[a-z0-9_-]+\.sql$/.test(file)).sort() } catch { files = [] }
  let ownerUrl: string
  try { ownerUrl = databaseUrl({ DATABASE_URL: env.DATABASE_OWNER_URL }) } catch {
    line({ status: 'error', reason: 'configuration', message: 'Falta DATABASE_OWNER_URL' })
    return 1
  }
  const client = new pg.Client({ connectionString: ownerUrl, options: `-c search_path=${manifest.schema}`, application_name: 'module-seed' })
  client.on('error', () => {})
  try {
    await client.connect()
    let rows = 0
    for (const file of files) {
      const result = await client.query(readFileSync(join(dir, file), 'utf8'))
      rows += (Array.isArray(result) ? result : [result]).reduce((total, r) => total + (r.rowCount ?? 0), 0)
    }
    line({ status: 'ok', files: files.length, rows })
    return 0
  } catch (error) {
    line({ status: 'error', reason: 'failed', message: error instanceof Error ? error.message : 'Los datos de ejemplo fallaron' })
    return 1
  } finally {
    await client.end().catch(() => {})
  }
}
