import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
/**
 * Las migraciones del módulo, con historial aplicado. En vet no había ejecutor: se aplicaban a mano con `psql -1`
 * (inventario §1.2). Reglas:
 *
 * - Ficheros `migrations/<version>_<name>.sql`: `version` de cuatro cifras, desde `0001` y sin huecos; `nombre` en
 *   minúsculas, cifras, `_` o `-`. Cualquier otro `.sql` en la carpeta es un error, no se ignora.
 * - Cada migración va en su propia transacción (la abre el migrador: el fichero no puede llevar `BEGIN`, `COMMIT` ni
 *   `ROLLBACK`), con `search_path` en el esquema del módulo. Si falla, se deshace entera y no se aplica ninguna más.
 * - El historial es `<schema>.migrations (version, name, checksum, applied_at, duration_ms)`. El checksum es el
 *   SHA-256 de los bytes del fichero: si una migración ya aplicada cambia, el migrador para y `/readyz` dice que no.
 * - Un cerrojo consultivo por esquema: dos procesos que migran a la vez no aplican nada dos veces.
 * - Lo aplica el rol propietario. Al terminar, el rol de ejecución recibe `USAGE` en el esquema, `SELECT, INSERT,
 *   UPDATE` en sus tablas y solo `SELECT` en el historial. Nunca `DELETE` ni DDL.
 */
export interface Migration { version: number; name: string; file: string; sql: string; checksum: string }
export interface AppliedMigration { version: number; name: string; checksum: string }
export interface MigrateResult { applied: { version: number; name: string; ms: number }[]; alreadyApplied: number }
export class MigrationError extends Error {
  constructor(readonly reason: 'directory' | 'name' | 'order' | 'transaction' | 'syntax' | 'checksum' | 'unknown' | 'failed', message: string, readonly version?: number) { super(message) }
}

const FILE_NAME = /^(\d{4})_([a-z0-9][a-z0-9_-]{0,62})\.sql$/

/**
 * Las sentencias de primer nivel de un fichero SQL, con las reglas léxicas de PostgreSQL (con
 * `standard_conforming_strings`, que el migrador fija): un `COMMIT` dentro de una función, un comentario, una cadena o
 * un identificador no es una sentencia del fichero. De cada una, `text` es el trozo original (lo que se ejecuta) y
 * `words`, lo que queda sin comentarios, cadenas ni cuerpos, en mayúsculas y con los espacios reducidos (lo que se
 * comprueba).
 *
 * Los límites, como los pone PostgreSQL:
 * - un identificador sin comillas o un número se lee entero, con sus `$` (`a$$$` es un identificador, no el
 *   principio de un cuerpo): un `$etiqueta$` solo empieza donde no sigue a un carácter de identificador;
 * - `$1` es un parámetro, no una etiqueta (las etiquetas no empiezan por cifra);
 * - `E'…'` admite escapes con `\`; las demás cadenas, no;
 * - los comentarios de bloque se anidan, y los de línea acaban en LF, CR o CRLF;
 * - lo que se abre y no se cierra (comentario de bloque, cadena, identificador entre comillas, cuerpo `$…$`) es un
 *   error léxico: lanza `SqlLexicalError` y no se ejecuta nada.
 *
 * Ante la duda, se lee lo que hace visible una sentencia, nunca lo que la esconde. Y el migrador ejecuta cada trozo
 * por separado con el protocolo extendido, que no admite dos órdenes en una petición: si este análisis se equivocara
 * al partir, PostgreSQL rechazaría el trozo dentro de la transacción en vez de ejecutar un `COMMIT` escondido.
 */
export class SqlLexicalError extends Error {}

export function splitStatements(sql: string): { text: string; words: string }[] {
  const statements: { text: string; words: string }[] = []
  let words = '', start = 0, i = 0
  const n = sql.length
  const identifierChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(ch)
  const close = (end: number) => { statements.push({ text: sql.slice(start, end), words }); words = ''; start = end + 1 }
  while (i < n) {
    const c = sql[i], next = sql[i + 1]
    if (c === '-' && next === '-') { while (i < n && sql[i] !== '\n' && sql[i] !== '\r') i++; words += ' '; continue }
    if (c === '/' && next === '*') {
      let depth = 1; i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 } else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 } else i++
      }
      if (depth > 0) throw new SqlLexicalError('un comentario de bloque sin cerrar')
      words += ' '; continue
    }
    // Identificador o palabra clave sin comillas, o número: entero, con sus `$` y sus cifras.
    if (/[A-Za-z_\u0080-\uffff0-9]/.test(c)) {
      let end = i + 1
      while (identifierChar(sql[end])) end++
      const word = sql.slice(i, end)
      i = end
      // `E'…'` (cadena con escapes): la `E` pegada a la comilla.
      if ((word === 'E' || word === 'e') && sql[i] === "'") { i = skipString(sql, i, true); words += " E'' "; continue }
      words += word; continue
    }
    if (c === "'") { i = skipString(sql, i, false); words += " '' "; continue }
    if (c === '"') {
      let closed = false
      i++
      while (i < n) { if (sql[i] === '"') { if (sql[i + 1] === '"') { i += 2; continue } i++; closed = true; break } i++ }
      if (!closed) throw new SqlLexicalError('un identificador entre comillas sin cerrar')
      words += ' "" '; continue
    }
    if (c === '$') {
      // Aquí nunca se llega pegado a un identificador o un número: los consume la rama de arriba.
      const tag = /^\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        if (end === -1) throw new SqlLexicalError(`un cuerpo ${tag[0]} sin cerrar`)
        i = end + tag[0].length
        words += ' $$ '; continue
      }
    }
    if (c === ';') { close(i); i++; continue }
    words += c; i++
  }
  close(n)
  return statements
    .map(statement => ({ text: statement.text, words: statement.words.replace(/\s+/g, ' ').trim().toUpperCase() }))
    .filter(statement => statement.words)
}
/** Una cadena desde su comilla de apertura; devuelve la posición tras la de cierre. `''` es una comilla dentro. */
function skipString(sql: string, open: number, escapes: boolean): number {
  let i = open + 1
  while (i < sql.length) {
    if (escapes && sql[i] === '\\') { i += 2; continue }
    if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue } return i + 1 }
    i++
  }
  throw new SqlLexicalError('una cadena sin cerrar')
}
/** `queryMode: 'extended'` existe en `pg` 8.16 (`lib/query.js`), pero no en sus tipos. */
const extended = (text: string) => ({ text, queryMode: 'extended' }) as unknown as pg.QueryConfig

/** Lo comprobable de cada sentencia de primer nivel (`splitStatements`). */
export const topLevelStatements = (sql: string): string[] => splitStatements(sql).map(statement => statement.words)
/** Control de transacciones en cualquiera de sus formas (`COMMIT WORK`, `END TRANSACTION`, `ABORT`, `SAVEPOINT`…). */
const TRANSACTION_CONTROL = /^(BEGIN|COMMIT|ROLLBACK|END|ABORT|START TRANSACTION|SAVEPOINT|RELEASE|PREPARE TRANSACTION)\b/
export function hasTransactionControl(sql: string): boolean {
  return topLevelStatements(sql).some(statement => TRANSACTION_CONTROL.test(statement))
}
/** Lo que se comprueba de cada migración antes de ejecutar nada: que se pueda leer entera y que no controle la transacción. */
function checkMigrationSql(file: string, version: number, sql: string): void {
  let control: boolean
  try { control = hasTransactionControl(sql) } catch (error) {
    if (error instanceof SqlLexicalError) throw new MigrationError('syntax', `${file}: ${error.message}; no se ejecuta nada`, version)
    throw error
  }
  if (control) throw transactionError(file, version)
}
const transactionError = (file: string, version: number) =>
  new MigrationError('transaction', `${file}: la transacción la abre y la cierra el migrador; quita BEGIN, COMMIT, ROLLBACK, END, ABORT, SAVEPOINT y similares`, version)
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

/** Lee y valida la carpeta. Una carpeta vacía es válida (un módulo recién creado). */
export function readMigrations(dir: string): Migration[] {
  let names: string[]
  try {
    if (!statSync(dir).isDirectory()) throw new Error()
    names = readdirSync(dir).filter(name => name.endsWith('.sql')).sort()
  } catch {
    throw new MigrationError('directory', 'No existe la carpeta de migraciones')
  }
  const migrations = names.map(file => {
    const match = FILE_NAME.exec(file)
    if (!match) throw new MigrationError('name', `Nombre de migración no válido: ${file} (se espera 0001_nombre.sql)`)
    const bytes = readFileSync(join(dir, file))
    const sql = bytes.toString('utf8')
    const version = Number(match[1])
    checkMigrationSql(file, version, sql)
    return { version, name: match[2], file, sql, checksum: sha256(bytes) }
  })
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) throw new MigrationError('order', `Las versiones van de 0001 en adelante sin huecos ni repetidas: falla ${m.file}`, m.version)
  })
  return migrations
}

const ident = (client: pg.ClientBase, name: string) => client.escapeIdentifier(name)

/** El historial tal cual, en orden. `null` si el esquema o la tabla aún no existen. */
export async function readApplied(client: pg.ClientBase, schema: string): Promise<AppliedMigration[] | null> {
  const exists = await client.query<{ table_ref: string | null }>('SELECT to_regclass($1) AS table_ref', [`${ident(client, schema)}.migrations`])
  if (!exists.rows[0].table_ref) return null
  const { rows } = await client.query<AppliedMigration>(`SELECT version, name, checksum FROM ${ident(client, schema)}.migrations ORDER BY version`)
  return rows
}

/** Lo aplicado es un prefijo exacto de lo que hay en la carpeta: mismas versiones, nombres y checksums. */
export function checkHistory(applied: readonly AppliedMigration[], migrations: readonly Migration[]): void {
  applied.forEach((row, index) => {
    const expected = migrations[index]
    if (row.version !== index + 1 || !expected || expected.version !== row.version || expected.name !== row.name) {
      throw new MigrationError('unknown', `La base tiene la migración ${row.version} (${row.name}) y la carpeta no`, row.version)
    }
    if (expected.checksum !== row.checksum) {
      throw new MigrationError('checksum', `La migración ${expected.file} cambió después de aplicarse (checksum distinto)`, row.version)
    }
  })
}

export interface MigrateOptions {
  /** Conexión del rol propietario: aplica el DDL. */
  ownerUrl: string
  /** Nombre del rol de ejecución, al que se conceden los permisos. */
  runtimeRole: string
  schema: string
  migrations: readonly Migration[]
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString: options.ownerUrl, application_name: 'module-migrate' })
  client.on('error', () => {})
  await client.connect()
  const schema = ident(client, options.schema)
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`dvi-base:migrations:${options.schema}`])
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 63),
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL CHECK (duration_ms >= 0))`)
    const applied = (await readApplied(client, options.schema)) ?? []
    checkHistory(applied, options.migrations)
    const result: MigrateResult = { applied: [], alreadyApplied: applied.length }
    // Otra vez aquí: `migrate` puede recibir migraciones que no pasaron por `readMigrations`.
    for (const migration of options.migrations.slice(applied.length)) checkMigrationSql(migration.file, migration.version, migration.sql)
    for (const migration of options.migrations.slice(applied.length)) {
      const start = Date.now()
      let transaction = ''
      try {
        await client.query('BEGIN')
        await client.query(`SET LOCAL search_path TO ${schema}`)
        // Las cadenas, como las lee el análisis de sentencias: `\` solo escapa en `E'…'`.
        await client.query('SET LOCAL standard_conforming_strings = on')
        transaction = String((await client.query<{ id: string }>('SELECT txid_current()::text AS id')).rows[0].id)
        // Una sentencia por petición, con el protocolo extendido: PostgreSQL rechaza un trozo que lleve dos órdenes.
        for (const statement of splitStatements(migration.sql)) await client.query(extended(statement.text))
        // Si la migración cerró la transacción por su cuenta (algo que el filtro no vio), lo hecho ya no se puede deshacer.
        const still = (await client.query<{ id: string | null }>('SELECT txid_current_if_assigned()::text AS id')).rows[0].id
        if (still !== transaction) throw new MigrationError('failed', `La migración ${migration.file} cerró la transacción del migrador: puede haber quedado aplicada en parte y no está en el historial. Revisa la base a mano`, migration.version)
        const ms = Date.now() - start
        await client.query(`INSERT INTO ${schema}.migrations(version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)`, [migration.version, migration.name, migration.checksum, ms])
        await client.query('COMMIT')
        result.applied.push({ version: migration.version, name: migration.name, ms })
      } catch (error) {
        if (error instanceof MigrationError) { await client.query('ROLLBACK').catch(() => {}); throw error }
        // Solo se dice «se deshizo» si la transacción del migrador seguía abierta (abortada) al fallar.
        const intact = transaction !== '' && await client.query('SELECT 1').then(() => false, () => true)
        await client.query('ROLLBACK').catch(() => {})
        const detail = error instanceof Error ? error.message : 'error desconocido'
        throw new MigrationError('failed', intact
          ? `La migración ${migration.file} falló y se deshizo: ${detail}`
          : `La migración ${migration.file} falló fuera de la transacción del migrador: puede haber quedado aplicada en parte y no está en el historial. Revisa la base a mano: ${detail}`, migration.version)
      }
    }
    const role = ident(client, options.runtimeRole)
    await client.query('BEGIN')
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`)
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`)
    await client.query(`REVOKE INSERT, UPDATE ON ${schema}.migrations FROM ${role}`)
    await client.query('COMMIT')
    return result
  } finally {
    await client.query('SELECT pg_advisory_unlock_all()').catch(() => {})
    await client.end().catch(() => {})
  }
}
