/**
 * Portada de las pruebas de una vertical anterior en producción. Criterio 4: las consultas van acotadas por
 * instancia y empresa. Cambia: pacientes → notas (repositorio del módulo de ejemplo), la base es la efímera de
 * `with-postgres.ts` con el esquema `notes` aplicado por el migrador, `PetConflict` → `Conflict`, y la comprobación de
 * que no hay esquema `auth` pasa a ser que no hay tablas del módulo en `public`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import pg from 'pg'
import { migrate, readMigrations } from '../src/migrations'
import { Conflict } from '../src/http'
import { NotesRepository, type NoteValues } from '../tests/example/notes'

const ownerUrl = process.env.TEST_PG_OWNER_URL!, runtimeUrl = process.env.TEST_PG_RUNTIME_URL!
assert.ok(ownerUrl && runtimeUrl, 'Ejecuta con `npm run test:bd`')
await migrate({ ownerUrl, runtimeRole: decodeURIComponent(new URL(runtimeUrl).username), schema: 'notes', migrations: readMigrations(join(import.meta.dirname, '..', 'tests', 'example', 'migrations')) })
const purchase: NoteValues = { title: 'Comprar material', body: 'Tornillos y cola' }

test('notas en el esquema del módulo: ámbito por instancia y empresa, alta repetible, versión y permisos del rol de ejecución', { timeout: 20000 }, async () => {
  const pool = new pg.Pool({ connectionString: runtimeUrl, max: 4, options: '-c search_path=notes' })
  try {
    const repo = new NotesRepository(pool, { tenantId: 'A', companyId: '1' })
    const id = randomUUID()
    const created = await repo.create(id, purchase, '7')
    assert.equal(created.id, id); assert.equal(created.version, 1); assert.equal(created.created_by, '7')
    assert.equal(created.tenant_id, 'A'); assert.equal(created.company_id, '1'); assert.equal(typeof created.updated_at, 'string')
    // La misma alta otra vez (reintento) devuelve la misma nota; otra alta con ese id es conflicto.
    assert.deepEqual(await repo.create(id, purchase, '7'), created)
    await assert.rejects(repo.create(id, { ...purchase, title: 'Otra' }, '7'), (e: unknown) => e instanceof Conflict)
    await assert.rejects(repo.create(id, purchase, '8'), (e: unknown) => e instanceof Conflict)
    // Edición con la versión vista; repetirla con la versión vieja es conflicto.
    const edited = await repo.update(id, 1, { ...purchase, title: 'Comprar material II' })
    assert.equal(edited?.title, 'Comprar material II'); assert.equal(edited?.version, 2)
    await assert.rejects(repo.update(id, 1, { ...purchase, title: 'III' }), (e: unknown) => e instanceof Conflict)
    assert.equal(await repo.update(randomUUID(), 1, purchase), null)
    assert.equal((await repo.get(id))?.version, 2)
    // Criterio 4: otra empresa de la misma instancia, la misma empresa en otra instancia, u otra de las dos, no ven la
    // nota, ni la pueden editar, ni les sale en la lista ni en la búsqueda.
    for (const scope of [{ tenantId: 'A', companyId: '2' }, { tenantId: 'B', companyId: '1' }, { tenantId: 'B', companyId: '2' }]) {
      const other = new NotesRepository(pool, scope)
      assert.equal(await other.get(id), null, JSON.stringify(scope))
      assert.equal(await other.update(id, 2, purchase), null, JSON.stringify(scope))
      assert.deepEqual((await other.list()).notes, [], JSON.stringify(scope))
      assert.deepEqual((await other.list(1, 'material')).notes, [], JSON.stringify(scope))
      // Y la suya no la ve la primera.
      const theirs = await other.create(randomUUID(), { title: 'De otro ámbito', body: null }, '9')
      assert.equal(await repo.get(theirs.id), null, JSON.stringify(scope))
    }
    assert.equal((await repo.get(id))?.title, 'Comprar material II', 'nadie de fuera la cambió')
    // Búsqueda por título o texto; paginación de 20.
    await repo.create(randomUUID(), { title: 'Llamar al proveedor', body: 'Preguntar por la cola' }, '7')
    assert.deepEqual((await repo.list(1, 'proveedor')).notes.map(n => n.title), ['Llamar al proveedor'])
    assert.deepEqual((await repo.list(1, 'COLA')).notes.map(n => n.title), ['Comprar material II', 'Llamar al proveedor'])
    for (let n = 0; n < 20; n++) await repo.create(randomUUID(), { title: `Nota ${String(n).padStart(2, '0')}`, body: null }, '7')
    const first = await repo.list(1)
    assert.equal(first.notes.length, 20); assert.equal(first.nextPage, 2)
    const second = await repo.list(2)
    assert.equal(second.notes.length, 2); assert.equal(second.nextPage, null)
    await assert.rejects(repo.list(0), RangeError)
    await assert.rejects(repo.list(1, 'x'.repeat(121)), RangeError)
    // Los CHECK del esquema protegen aunque el código fallara, y el rol de ejecución no borra.
    await assert.rejects(pool.query("INSERT INTO notes(tenant_id,company_id,id,title,created_by) VALUES('A','1',$1,' ','7')", [randomUUID()]), { code: '23514' })
    await assert.rejects(pool.query('DELETE FROM notes'), { code: '42501' })
    assert.equal((await pool.query("SELECT to_regclass('public.notes') AS t")).rows[0].t, null)
  } finally { await pool.end() }
})
