import pg from 'pg'
import { databaseUrl, type Environment } from './config'
import type { ModuleSession } from './session'
/**
 * El almacén del módulo: un pool de PostgreSQL con el rol de ejecución, en el esquema del módulo. Extraído de una vertical
 * anterior en producción. `statement_timeout` lo aplica Postgres; si la base acepta la conexión y deja
 * de contestar, `query_timeout` corta en el cliente: la conexión se descarta, la plaza queda libre y la petición sale
 * como 503 `unavailable`, en vez de colgarse y agotar el pool.
 *
 * Convenciones que la base pide a todo repositorio (y que el módulo de ejemplo sigue):
 * - Cada tabla lleva `tenant_id` y `company_id` delante en la clave primaria, y **cada consulta** filtra por los dos
 *   con el `Ambito` de la sesión. Sin RLS: el ámbito lo pone el repositorio a partir de la sesión comprobada en Pimia.
 * - Alta idempotente: el id (UUID) lo elige quien llama; repetir la misma alta devuelve la misma fila y otra distinta
 *   con ese id es `Conflict` (409). Se detecta con `esClaveRepetida` (SQLSTATE 23505).
 * - Edición con `version` optimista: `UPDATE … WHERE … AND version = $n`; si no casa y la fila existe, `Conflict`.
 * - El rol de ejecución no borra ni cambia el esquema (lo concede el migrador: `SELECT, INSERT, UPDATE`).
 */
export interface Scope { tenantId: string; companyId: string }
export const scopeOf = (session: ModuleSession): Scope => ({ tenantId: session.tenantId, companyId: session.companyId })
export const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505'

let configured: { schema: string; env: Environment } | undefined
let pool: pg.Pool | undefined

/** Lo llama el arranque con el esquema de `module.json`. Sin esto, `modulePool()` no sabe a qué esquema ir. */
export function configureStore(schema: string, env: Environment = process.env): void {
  configured = { schema, env }
}

export function modulePool(): pg.Pool {
  if (!configured) throw new Error('Almacén sin configurar')
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl(configured.env), max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10_000,
      statement_timeout: 5000, query_timeout: 6000, application_name: 'module',
      // El esquema viene de `module.json`, ya validado como identificador en minúsculas.
      options: `-c search_path=${configured.schema}`,
    })
    pool.on('error', () => {})
  }
  return pool
}

/** Cierra el pool al parar el servidor. Si no llegó a abrirse, nada. */
export async function closeModulePool(): Promise<void> {
  const open = pool
  pool = undefined
  await open?.end()
}
