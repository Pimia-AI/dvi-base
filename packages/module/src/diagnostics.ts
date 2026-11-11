import pg from 'pg'
import { json, jsonError } from './http'
import { checkHistory, readApplied, type Migration } from './migrations'
import type { Handler } from './server'
/**
 * `/readyz` y `/api/version`: lo que el DVI y el `HEALTHCHECK` observan. `/readyz` conserva el nombre del de una vertical anterior
 * en producción, pero en vez de mirar columnas de tablas clínicas comprueba que la base
 * contesta con el rol de ejecución y que el historial de migraciones coincide exactamente con las migraciones del
 * módulo (versiones, nombres y checksums). En una transacción de solo lectura, con tiempos de 1,5 s, y sin detalles
 * en la respuesta.
 *
 * `/api/version` dice qué corre: `{module, commit, migrations: [{version, name}]}`, con las migraciones leídas del
 * historial (lo aplicado, no lo que hay en la carpeta). `commit` es `BUILD_REVISION` si es un SHA de 40 cifras.
 */
export interface DiagnosticsOptions {
  key: string
  schema: string
  migrations: readonly Migration[]
  /** Se lee en cada petición: un cambio de configuración no exige reconstruir los handlers. */
  databaseUrl: () => string
  commit?: string
}

async function withHistory<T>(options: DiagnosticsOptions, read: (applied: Awaited<ReturnType<typeof readApplied>>) => T): Promise<T> {
  const client = new pg.Client({ connectionString: options.databaseUrl(), connectionTimeoutMillis: 1500, query_timeout: 1500, statement_timeout: 1500, application_name: 'module-readyz' })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.query('BEGIN READ ONLY')
    const applied = await readApplied(client, options.schema)
    await client.query('COMMIT')
    return read(applied)
  } finally {
    await client.end().catch(() => {})
  }
}

export function createDiagnostics(options: DiagnosticsOptions): { readyz: { GET: Handler }; version: { GET: Handler } } {
  const commit = options.commit && /^[0-9a-f]{40}$/.test(options.commit) ? options.commit : null
  return {
    readyz: {
      GET: async () => {
        try {
          await withHistory(options, applied => {
            if (!applied || applied.length !== options.migrations.length) throw new Error('Migraciones pendientes')
            checkHistory(applied, options.migrations)
          })
          return json({ status: 'ready' })
        } catch {
          return json({ status: 'unavailable' }, 503, { 'Retry-After': '5' })
        }
      },
    },
    version: {
      GET: async () => {
        try {
          const migrations = await withHistory(options, applied => (applied ?? []).map(({ version, name }) => ({ version, name })))
          return json({ module: options.key, commit, migrations })
        } catch {
          return jsonError(503, 'unavailable', 'El módulo no está disponible ahora mismo.')
        }
      },
    },
  }
}

/** Sin diagnóstico configurado (un servidor de pruebas sin base): no está listo y no dice versión. */
export const NO_DIAGNOSTICS: { readyz: { GET: Handler }; version: { GET: Handler }; session: { GET: Handler } } = {
  readyz: { GET: async () => json({ status: 'unavailable' }, 503, { 'Retry-After': '5' }) },
  version: { GET: async () => jsonError(503, 'unavailable', 'El módulo no está disponible ahora mismo.') },
  session: { GET: async () => jsonError(503, 'unavailable', 'El módulo no está disponible ahora mismo.') },
}
