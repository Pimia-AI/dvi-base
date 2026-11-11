/** Nueva (vet no tenía ejecutor de migraciones): cómo se lee y se valida la carpeta, sin base de datos. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasTransactionControl, splitStatements, SqlLexicalError, readMigrations, checkHistory, MigrationError, sha256 } from '../src/migrations'

const root = mkdtempSync(join(tmpdir(), 'dvi-mig-'))
after(() => rmSync(root, { recursive: true, force: true }))
let n = 0
function folder(files: Record<string, string>): string {
  const dir = join(root, String(n++))
  mkdirSync(dir)
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
  return dir
}
const reason = (m: string) => (e: unknown) => e instanceof MigrationError && e.reason === m

test('una carpeta válida: en orden, con su checksum SHA-256 de los bytes; vacía también vale', () => {
  const dir = folder({ '0002_b.sql': 'SELECT 2;', '0001_a.sql': 'SELECT 1;', 'LEEME.md': 'no es una migración' })
  const migrations = readMigrations(dir)
  assert.deepEqual(migrations.map(m => [m.version, m.name, m.file]), [[1, 'a', '0001_a.sql'], [2, 'b', '0002_b.sql']])
  assert.equal(migrations[0].checksum, sha256('SELECT 1;'))
  assert.match(migrations[0].checksum, /^[0-9a-f]{64}$/)
  assert.deepEqual(readMigrations(folder({})), [])
})

test('lo que no cuadra para la lectura: nombre, hueco, repetida, sin carpeta o con su propia transacción', () => {
  assert.throws(() => readMigrations(join(root, 'no-existe')), reason('directory'))
  for (const name of ['1_a.sql', '0001-a.sql', '0001_A.sql', '0001_.sql', 'a_0001.sql', '00001_a.sql']) {
    assert.throws(() => readMigrations(folder({ [name]: 'SELECT 1;' })), reason('name'), name)
  }
  assert.throws(() => readMigrations(folder({ '0002_a.sql': 'SELECT 1;' })), reason('order'), 'empieza en 0002')
  assert.throws(() => readMigrations(folder({ '0001_a.sql': 'SELECT 1;', '0003_c.sql': 'SELECT 3;' })), reason('order'), 'hueco')
  assert.throws(() => readMigrations(folder({ '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 1;' })), reason('order'), 'repetida')
  for (const sql of ['BEGIN;\nCREATE TABLE x(id int);\nCOMMIT;', 'CREATE TABLE x(id int);\n  commit', 'START TRANSACTION;', 'rollback;']) {
    assert.throws(() => readMigrations(folder({ '0001_a.sql': sql })), reason('transaction'), sql)
  }
  // `BEGIN` dentro de una función no es una transacción del fichero.
  assert.doesNotThrow(() => readMigrations(folder({ '0001_a.sql': 'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;' })))
  assert.doesNotThrow(() => readMigrations(folder({ '0001_a.sql': 'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $cuerpo$\nBEGIN\n  RETURN 1;\nEND;\n$cuerpo$;\n-- COMMIT en un comentario\n' })))
})

test('el historial tiene que ser un prefijo exacto de la carpeta', () => {
  const migrations = readMigrations(folder({ '0001_a.sql': 'SELECT 1;', '0002_b.sql': 'SELECT 2;' }))
  const row = (i: number) => ({ version: migrations[i].version, name: migrations[i].name, checksum: migrations[i].checksum })
  assert.doesNotThrow(() => checkHistory([], migrations))
  assert.doesNotThrow(() => checkHistory([row(0)], migrations))
  assert.doesNotThrow(() => checkHistory([row(0), row(1)], migrations))
  assert.throws(() => checkHistory([{ ...row(0), checksum: 'f'.repeat(64) }], migrations), reason('checksum'))
  assert.throws(() => checkHistory([{ ...row(0), name: 'otra' }], migrations), reason('unknown'))
  assert.throws(() => checkHistory([row(1)], migrations), reason('unknown'))
  assert.throws(() => checkHistory([row(0), row(1), { version: 3, name: 'c', checksum: 'a'.repeat(64) }], migrations), reason('unknown'))
})

test('regresión (revisión): cualquier control de transacción del fichero se rechaza, en cualquier forma y posición', () => {
  const rejected = [
    'CREATE TABLE residue(id int); COMMIT WORK; SELECT 1/0;',
    'COMMIT', 'commit work', 'COMMIT TRANSACTION;', 'COMMIT AND CHAIN;', 'end', 'END WORK;', 'end transaction;', 'ABORT;',
    'BEGIN WORK;', 'begin transaction isolation level serializable;', 'START TRANSACTION READ WRITE;',
    'ROLLBACK WORK;', 'ROLLBACK TO SAVEPOINT a;', 'SAVEPOINT a;', 'RELEASE SAVEPOINT a;', "PREPARE TRANSACTION 'x';", 'COMMIT PREPARED \'x\';',
    'SELECT 1;COMMIT', 'select 1; /* x */ commit work; select 2', 'SELECT 1; -- nada\n  Commit\n', '/* a /* anidado */ b */ COMMIT;',
    "SELECT 'a;b'; COMMIT;", 'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; COMMIT;',
  ]
  for (const sql of rejected) {
    assert.equal(hasTransactionControl(sql), true, sql)
    assert.throws(() => readMigrations(folder({ '0001_a.sql': sql })), reason('transaction'), sql)
  }
  const allowed = [
    'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;',
    'CREATE PROCEDURE p() LANGUAGE plpgsql AS $body$ BEGIN COMMIT; END $body$;',
    'DO $$ BEGIN PERFORM 1; END $$;',
    "INSERT INTO t(note) VALUES ('COMMIT; END; ROLLBACK');", "SELECT E'it\\'s; COMMIT';",
    'CREATE TABLE "commit" ("end" int);', 'CREATE TABLE periods (begin_at date, end_at date);',
    '-- COMMIT\nSELECT 1; /* ROLLBACK */', 'CREATE TABLE x(id int);\nPREPARE q AS SELECT 1;',
  ]
  for (const sql of allowed) assert.equal(hasTransactionControl(sql), false, sql)
})

test('regresión (revisión, 2.ª pasada): un $ dentro de un identificador no abre un cuerpo $$ que esconda un COMMIT', () => {
  const rejected = [
    'CREATE TABLE a$$$ (x int); COMMIT; CREATE TABLE b$$$ (x int); SELECT 1/0;',
    'CREATE TABLE a$$ (x int); COMMIT; CREATE TABLE b$$ (x int);',
    'CREATE TABLE t$x$ (x int); COMMIT; SELECT $x$ $x$;',
    'SELECT 1 AS a$; COMMIT; SELECT 2 AS b$;',
    'CREATE TABLE ñ$$ (x int); COMMIT; CREATE TABLE ü$$ (x int);',
    'SELECT 1$$; COMMIT; SELECT $$ $$;',
    'PREPARE q AS SELECT $1; COMMIT;',
    'SELECT E\'a\\\'b\'; COMMIT;',
  ]
  for (const sql of rejected) assert.equal(hasTransactionControl(sql), true, sql)
  const allowed = [
    'CREATE TABLE "a$$" (x int); CREATE TABLE "b$$" (x int);',
    'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $t1$ BEGIN COMMIT; RETURN 1; END $t1$;',
    'CREATE FUNCTION g(int) RETURNS int LANGUAGE sql AS $_$ SELECT $1; $_$;',
    'CREATE TABLE price$ (amount$ int); INSERT INTO price$ VALUES (1);',
    "SELECT 'a$$'; SELECT $$ COMMIT $$;",
  ]
  for (const sql of allowed) assert.equal(hasTransactionControl(sql), false, sql)
  // Y el texto que se ejecuta es el original de cada sentencia, con sus comentarios y cadenas.
  assert.deepEqual(splitStatements("CREATE TABLE a$$ (x int); /* ; */ INSERT INTO a$$ VALUES (1); SELECT ';'"), [
    { text: 'CREATE TABLE a$$ (x int)', words: 'CREATE TABLE A$$ (X INT)' },
    { text: ' /* ; */ INSERT INTO a$$ VALUES (1)', words: 'INSERT INTO A$$ VALUES (1)' },
    { text: " SELECT ';'", words: "SELECT ''" },
  ])
})

test('regresión (revisión, 3.ª pasada): el comentario de línea acaba también en CR, y lo que queda abierto se rechaza antes de ejecutar', () => {
  // CR, CRLF y LF terminan el comentario: lo que sigue es una sentencia, y se ve.
  for (const end of ['\r', '\r\n', '\n']) {
    assert.deepEqual(splitStatements(`-- comentario${end}CREATE TABLE x(id int);`).map(s => s.words), ['CREATE TABLE X(ID INT)'], JSON.stringify(end))
    assert.equal(hasTransactionControl(`-- comentario${end}COMMIT;`), true, JSON.stringify(end))
  }
  // Construcciones sin cerrar: error de lectura, no se ejecuta nada.
  const open = [
    'CREATE TABLE x(id int); /* /* */', '/* sin cerrar', "CREATE TABLE x(id int); SELECT 'abc", 'SELECT "abc', 'SELECT $$abc',
    'SELECT $body$ abc $other$', "SELECT E'abc\\'", "SELECT E'abc\\",
  ]
  for (const sql of open) {
    assert.throws(() => splitStatements(sql), SqlLexicalError, sql)
    assert.throws(() => readMigrations(folder({ '0001_a.sql': sql })), reason('syntax'), sql)
  }
  // Lo cerrado sigue valiendo, también acabado en comentario.
  for (const sql of ['CREATE TABLE x(id int); /* /* */ */', "SELECT 'a''b';", 'SELECT "a""b";', 'SELECT $$a$$;', 'SELECT 1; -- fin sin salto']) {
    assert.doesNotThrow(() => readMigrations(folder({ '0001_a.sql': sql })), sql)
  }
})
