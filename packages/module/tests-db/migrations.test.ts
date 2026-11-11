/**
 * Nueva (vet no tenía ejecutor de migraciones): el migrador contra un PostgreSQL de verdad, con el rol propietario y
 * el de ejecución separados. Cada prueba usa su propio esquema. Criterio 5: historial aplicado con checksum, y
 * `/api/version` las enumera.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { migrate, readMigrations, MigrationError, sha256 } from '../src/migrations'
import { createDiagnostics } from '../src/diagnostics'

const ownerUrl = process.env.TEST_PG_OWNER_URL!, runtimeUrl = process.env.TEST_PG_RUNTIME_URL!
assert.ok(ownerUrl && runtimeUrl, 'Ejecuta con `npm run test:bd`')
const runtimeRole = decodeURIComponent(new URL(runtimeUrl).username)
const root = mkdtempSync(join(tmpdir(), 'dvi-migbd-'))
after(() => rmSync(root, { recursive: true, force: true }))
let n = 0
function folder(files: Record<string, string>): string {
  const dir = join(root, String(n++))
  mkdirSync(dir)
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
  return dir
}
async function query<T extends pg.QueryResultRow>(url: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try { return (await client.query<T>(sql, params)).rows } finally { await client.end() }
}
const history = (schema: string) => query<{ version: number; name: string; checksum: string; duration_ms: number }>(ownerUrl, `SELECT version, name, checksum, duration_ms FROM ${schema}.migrations ORDER BY version`)
const options = (schema: string, dir: string) => ({ ownerUrl, runtimeRole, schema, migrations: readMigrations(dir) })
const reason = (m: string, version?: number) => (e: unknown) => e instanceof MigrationError && e.reason === m && (version === undefined || e.version === version)

test('aplica en orden, una vez, con historial y checksum; /readyz y /api/version lo leen con el rol de ejecución', async () => {
  const sql1 = 'CREATE TABLE things (id int PRIMARY KEY, name text NOT NULL);'
  const sql2 = 'ALTER TABLE things ADD COLUMN nota text;'
  const dir = folder({ '0001_things.sql': sql1, '0002_note.sql': sql2 })
  const diagnostics = createDiagnostics({ key: 'prueba', schema: 'm_order', migrations: readMigrations(dir), databaseUrl: () => runtimeUrl, commit: 'b'.repeat(40) })
  // Antes de migrar no está listo.
  assert.equal((await diagnostics.readyz.GET(new Request('http://m/readyz'), {})).status, 503)
  const first = await migrate(options('m_order', dir))
  assert.deepEqual(first.applied.map(m => [m.version, m.name]), [[1, 'things'], [2, 'note']])
  assert.equal(first.alreadyApplied, 0)
  const rows = await history('m_order')
  assert.deepEqual(rows.map(f => [f.version, f.name, f.checksum]), [[1, 'things', sha256(sql1)], [2, 'note', sha256(sql2)]])
  assert.ok(rows.every(f => f.duration_ms >= 0))
  // Las tablas van al esquema del módulo, no a public.
  assert.deepEqual(await query(ownerUrl, "SELECT table_schema FROM information_schema.tables WHERE table_name = 'things'"), [{ table_schema: 'm_order' }])
  // Otra vez: nada que aplicar.
  const second = await migrate(options('m_order', dir))
  assert.deepEqual(second, { applied: [], alreadyApplied: 2 })
  assert.equal((await history('m_order')).length, 2)
  // Listo, y la versión dice lo aplicado.
  const readyz = await diagnostics.readyz.GET(new Request('http://m/readyz'), {})
  assert.equal(readyz.status, 200); assert.deepEqual(await readyz.json(), { status: 'ready' })
  const version = await diagnostics.version.GET(new Request('http://m/api/version'), {})
  assert.deepEqual(await version.json(), { module: 'prueba', commit: 'b'.repeat(40), migrations: [{ version: 1, name: 'things' }, { version: 2, name: 'note' }] })
})

test('una migración ya aplicada que cambia, o que desaparece de la carpeta, para el migrador y /readyz dice que no', async () => {
  const dir = folder({ '0001_a.sql': 'CREATE TABLE a (id int);' })
  await migrate(options('m_checksum', dir))
  // El fichero cambia (aunque sea un espacio) y se añade otra: no se aplica nada.
  const changed = folder({ '0001_a.sql': 'CREATE TABLE a (id int); ', '0002_b.sql': 'CREATE TABLE b (id int);' })
  await assert.rejects(migrate(options('m_checksum', changed)), reason('checksum', 1))
  assert.equal((await history('m_checksum')).length, 1)
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_checksum.b') AS b"), [{ b: null }])
  const diagnostics = createDiagnostics({ key: 'prueba', schema: 'm_checksum', migrations: readMigrations(changed), databaseUrl: () => runtimeUrl })
  assert.equal((await diagnostics.readyz.GET(new Request('http://m/readyz'), {})).status, 503)
  // La base tiene una migración que la carpeta ya no tiene.
  await migrate(options('m_unknown', folder({ '0001_a.sql': 'SELECT 1;', '0002_b.sql': 'SELECT 2;' })))
  await assert.rejects(migrate(options('m_unknown', folder({ '0001_a.sql': 'SELECT 1;' }))), reason('unknown', 2))
})

test('si una migración falla, se deshace entera, las anteriores quedan y las siguientes no se aplican', async () => {
  const dir = folder({
    '0001_good.sql': 'CREATE TABLE good (id int);',
    '0002_bad.sql': 'CREATE TABLE half_done (id int);\nSELECT * FROM missing_table;',
    '0003_after.sql': 'CREATE TABLE after_table (id int);',
  })
  await assert.rejects(migrate(options('m_failure', dir)), (e: unknown) => reason('failed', 2)(e) && /0002_bad\.sql/.test((e as Error).message))
  assert.deepEqual((await history('m_failure')).map(f => f.version), [1])
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_failure.good') IS NOT NULL AS good, to_regclass('m_failure.half_done') AS half_done, to_regclass('m_failure.after_table') AS after"), [{ good: true, half_done: null, after: null }])
  // Arreglada la 0002 (aún no se había aplicado, así que puede cambiar), sigue donde lo dejó.
  const fixed = folder({ '0001_good.sql': 'CREATE TABLE good (id int);', '0002_bad.sql': 'CREATE TABLE half_done (id int);', '0003_after.sql': 'CREATE TABLE after_table (id int);' })
  assert.deepEqual((await migrate(options('m_failure', fixed))).applied.map(m => m.version), [2, 3])
})

test('dos procesos que migran a la vez no aplican nada dos veces', async () => {
  const dir = folder({ '0001_slow.sql': 'SELECT pg_sleep(0.3);\nCREATE TABLE slow (id int);', '0002_other.sql': 'CREATE TABLE other (id int);' })
  const results = await Promise.all([migrate(options('m_concurrent', dir)), migrate(options('m_concurrent', dir)), migrate(options('m_concurrent', dir))])
  assert.equal(results.reduce((total, r) => total + r.applied.length, 0), 2)
  assert.deepEqual((await history('m_concurrent')).map(f => f.version), [1, 2])
})

test('el rol de ejecución lee, inserta y actualiza; no borra, no cambia el esquema ni toca el historial', async () => {
  await migrate(options('m_permissions', folder({ '0001_t.sql': 'CREATE TABLE t (id int PRIMARY KEY, v text);' })))
  const runtime = new pg.Client({ connectionString: runtimeUrl })
  await runtime.connect()
  try {
    await runtime.query("INSERT INTO m_permissions.t VALUES (1, 'a')")
    await runtime.query("UPDATE m_permissions.t SET v = 'b' WHERE id = 1")
    assert.deepEqual((await runtime.query('SELECT v FROM m_permissions.t')).rows, [{ v: 'b' }])
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM m_permissions.migrations')).rows[0].n, 1)
    for (const sql of ['DELETE FROM m_permissions.t', 'TRUNCATE m_permissions.t', 'CREATE TABLE m_permissions.nueva (id int)', 'ALTER TABLE m_permissions.t ADD COLUMN x int', 'DROP TABLE m_permissions.t',
      "INSERT INTO m_permissions.migrations(version, name, checksum, duration_ms) VALUES (2, 'x', repeat('a', 64), 0)", "UPDATE m_permissions.migrations SET name = 'x'", 'DELETE FROM m_permissions.migrations']) {
      await assert.rejects(runtime.query(sql), (e: unknown) => ['42501'].includes((e as { code?: string }).code ?? '') || /must be owner/.test((e as Error).message), sql)
    }
  } finally { await runtime.end() }
})

test('regresión (revisión): una migración con COMMIT WORK no llega a la base, aunque no pase por readMigrations', async () => {
  const sql = 'CREATE TABLE residue(id int); COMMIT WORK; SELECT 1/0;'
  const migrations = [{ version: 1, name: 'residue', file: '0001_residue.sql', sql, checksum: sha256(sql) }]
  await assert.rejects(migrate({ ownerUrl, runtimeRole, schema: 'm_residue', migrations }), reason('transaction', 1))
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_residue.residue') AS residue"), [{ residue: null }])
  assert.deepEqual(await history('m_residue'), [])
})

test('un COMMIT que se cuela por un procedimiento falla dentro de la transacción del migrador y se deshace de verdad', async () => {
  const sql = "CREATE PROCEDURE commit_inside() LANGUAGE plpgsql AS $$ BEGIN COMMIT; END $$;\nCREATE TABLE before_call (id int);\nCALL commit_inside();"
  await assert.rejects(migrate(options('m_procedure', folder({ '0001_p.sql': sql }))), (e: unknown) => reason('failed', 1)(e) && /se deshizo/.test((e as Error).message))
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_procedure.before_call') AS t, to_regprocedure('m_procedure.commit_inside()') AS p"), [{ t: null, p: null }])
  assert.deepEqual(await history('m_procedure'), [])
})

test('regresión (revisión, 2.ª pasada): el caso de a$$$ no llega a la base; y un trozo con dos órdenes, PostgreSQL lo rechaza', async () => {
  const sql = 'CREATE TABLE a$$$ (x int); COMMIT; CREATE TABLE b$$$ (x int); SELECT 1/0;'
  await assert.rejects(migrate({ ownerUrl, runtimeRole, schema: 'm_dollar', migrations: [{ version: 1, name: 'dollar', file: '0001_dollar.sql', sql, checksum: sha256(sql) }] }), reason('transaction', 1))
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_dollar.\"a$$$\"') AS a"), [{ a: null }])
  assert.deepEqual(await history('m_dollar'), [])
  // La red de seguridad: con el protocolo extendido, dos órdenes en una petición no se ejecutan.
  const client = new pg.Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    await assert.rejects(client.query({ text: 'SELECT 1; COMMIT', queryMode: 'extended' } as unknown as pg.QueryConfig), /multiple commands/)
  } finally { await client.end() }
})

test('migraciones normales siguen aplicándose sentencia a sentencia: funciones, DO, cadenas con ; y nombres con $', async () => {
  const sql = [
    'CREATE TABLE price$ (id int PRIMARY KEY, note text);',
    "INSERT INTO price$ VALUES (1, 'uno; dos'), (2, E'it\\'s; COMMIT');",
    'CREATE FUNCTION bump(n int) RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RETURN n + 1; END $body$;',
    "DO $$ BEGIN INSERT INTO price$ VALUES (bump(2), 'do'); END $$;",
    '-- comentario con COMMIT; dentro',
    '/* bloque /* anidado; */ */ CREATE INDEX price_note ON price$ (note);',
  ].join('\n')
  const result = await migrate(options('m_normal', folder({ '0001_normal.sql': sql })))
  assert.deepEqual(result.applied.map(m => m.version), [1])
  assert.deepEqual(await query(ownerUrl, 'SELECT id, note FROM m_normal.price$ ORDER BY id'), [{ id: 1, note: 'uno; dos' }, { id: 2, note: "it's; COMMIT" }, { id: 3, note: 'do' }])
})

test('regresión (revisión, 3.ª pasada): lo que se registra como aplicado es lo que PostgreSQL ejecutó', async () => {
  // (a) Comentario terminado en CR: PostgreSQL ve el CREATE; el migrador también lo ejecuta, y el historial es verdad.
  const cr = '-- comentario\rCREATE TABLE x(id int);'
  assert.deepEqual((await migrate({ ownerUrl, runtimeRole, schema: 'm_cr', migrations: [{ version: 1, name: 'cr', file: '0001_cr.sql', sql: cr, checksum: sha256(cr) }] })).applied.map(m => m.version), [1])
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_cr.x') IS NOT NULL AS x"), [{ x: true }])
  assert.deepEqual((await history('m_cr')).map(f => f.version), [1])
  // (b) Comentario de bloque sin cerrar: se rechaza antes de ejecutar nada; ni tabla ni historial.
  const open = 'CREATE TABLE x(id int); /* /* */'
  await assert.rejects(migrate({ ownerUrl, runtimeRole, schema: 'm_open', migrations: [{ version: 1, name: 'open', file: '0001_open.sql', sql: open, checksum: sha256(open) }] }), reason('syntax', 1))
  assert.deepEqual(await query(ownerUrl, "SELECT to_regclass('m_open.x') AS x"), [{ x: null }])
  assert.deepEqual(await history('m_open'), [])
})
