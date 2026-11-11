import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
/**
 * Un PostgreSQL efímero en Docker para las pruebas de base de datos de la base y de cada módulo. Nada de `initdb`
 * local ni de esquemas ajenos: un contenedor por ejecución, con los datos en memoria (`tmpfs`), publicado solo en
 * `127.0.0.1` y en un puerto libre que elige Docker. Al parar, el contenedor se borra.
 *
 * Dos roles por base, como en producción: el propietario aplica migraciones (DDL) y el de ejecución solo recibe lo
 * que las migraciones le concedan.
 */
/** PostgreSQL 17.11, fijada por digest (la imagen oficial `postgres:17-alpine`). */
export const POSTGRES_IMAGE = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'

export interface EphemeralPostgres {
  /** Superusuario del contenedor: solo para preparar bases y roles. */
  adminUrl: string
  container: string
  stop(): void
}
export interface PreparedDatabase {
  name: string
  ownerUrl: string
  runtimeUrl: string
}

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`docker ${args[0]} falló: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout.trim()
}
const secret = () => randomBytes(18).toString('base64url')

export async function startPostgres(image = POSTGRES_IMAGE): Promise<EphemeralPostgres> {
  const password = secret()
  const container = docker([
    'run', '-d', '--rm', '--tmpfs', '/var/lib/postgresql/data',
    '-p', '127.0.0.1::5432',
    '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_USER=dvi_admin', '-e', 'POSTGRES_DB=postgres',
    '--label', 'dvi-base=tests',
    image,
  ])
  const stop = () => { spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' }) }
  try {
    const port = docker(['port', container, '5432/tcp']).split('\n')[0].split(':').pop()
    const adminUrl = `postgresql://dvi_admin:${password}@127.0.0.1:${port}/postgres`
    await waitReady(adminUrl)
    return { adminUrl, container, stop }
  } catch (error) {
    stop()
    throw error
  }
}

/** Espera a que Postgres acepte conexiones de verdad (el script de arranque de la imagen reinicia el servidor una vez). */
async function waitReady(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let streak = 0
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 })
    client.on('error', () => {})
    try {
      await client.connect()
      await client.query('SELECT 1')
      if (++streak >= 2) return
    } catch {
      streak = 0
    } finally {
      await client.end().catch(() => {})
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('PostgreSQL no arrancó a tiempo')
}

/** Crea una base `nombre`, de la que es dueño `<nombre>_propietario`, y el rol `<nombre>_ejecucion` sin privilegios. */
export async function prepareDatabase(adminUrl: string, name: string): Promise<PreparedDatabase> {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error('Nombre de base no válido')
  const owner = `${name}_owner`, runtime = `${name}_runtime`
  const ownerPassword = secret(), runtimePassword = secret()
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${ownerPassword}'`)
    await admin.query(`CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${runtimePassword}'`)
    await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`)
    await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`)
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${runtime}`)
  } finally {
    await admin.end()
  }
  const url = (user: string, password: string) => {
    const target = new URL(adminUrl)
    target.username = user
    target.password = password
    target.pathname = `/${name}`
    return target.toString()
  }
  return { name, ownerUrl: url(owner, ownerPassword), runtimeUrl: url(runtime, runtimePassword) }
}
