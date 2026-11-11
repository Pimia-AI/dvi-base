/**
 * Portada de las pruebas de una vertical anterior en producción. Cambia: `PetConflict` pasa a `Conflict`, genérico
 * de la base, y el error de relación inventado ya no nombra una tabla clínica. La prueba de `validatePet` (61-75) es del
 * dominio y no se porta; `isUuid`, sí.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withModule, readJson, json, isUuid, ModuleHttpError, Conflict } from '../src/http'
import { ModuleAuthError, type ModuleSession } from '../src/session'

const session: ModuleSession = { userId: '7', userName: 'Lucía', tenantId: 'demo', companyId: '1', scopes: ['notes:read'], actor: null }
const deps = (overrides: Partial<{ error: Error }> = {}) => ({
  session: async () => { if (overrides.error) throw overrides.error; return session },
})
const request = (body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://modulo.test/api/notes', body === undefined ? { headers } : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })

test('sin modo que mirar: withModule pasa siempre por la sesión (el 404 de lo que no existe lo da la tabla)', async () => {
  let asked = 0
  const response = await withModule(request(), { session: async () => { asked++; return session } }, async () => json({ data: 1 }))
  assert.equal(response.status, 200); assert.equal(asked, 1)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { data: 1 })
})

test('los fallos de sesión salen como JSON con su código y sin interioridades', async () => {
  const unauthorized = await withModule(request(), deps({ error: new ModuleAuthError(401, 'unauthorized') }), async () => json({}))
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.headers.get('www-authenticate'), 'Bearer')
  assert.deepEqual(await unauthorized.json(), { error: 'unauthorized', message: 'Hace falta un token de módulo de Pimia válido.' })
  const forbidden = await withModule(request(), deps({ error: new ModuleAuthError(403, 'forbidden') }), async () => json({}))
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.headers.get('www-authenticate'), null)
  const notInPlan = await withModule(request(), deps({ error: new ModuleAuthError(403, 'not_in_plan') }), async () => json({}))
  assert.deepEqual(await notInPlan.json(), { error: 'not_in_plan', message: 'El plan de esta instancia no incluye este módulo.' })
  const broken = await withModule(request(), deps({ error: new Error('ECONNRESET pg://secreto') }), async () => json({}))
  assert.equal(broken.status, 503)
  assert.doesNotMatch(await broken.text(), /secreto|ECONNRESET/)
})

test('el handler recibe la sesión y sus errores se traducen', async () => {
  let seen: ModuleSession | undefined
  const ok = await withModule(request(), deps(), async s => { seen = s; return json({ data: { hola: 'mundo' } }, 201) })
  assert.equal(ok.status, 201)
  assert.deepEqual(seen, session)
  assert.deepEqual(await ok.json(), { data: { hola: 'mundo' } })
  const conflict = await withModule(request(), deps(), async () => { throw new Conflict() })
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).error, 'conflict')
  const validation = await withModule(request(), deps(), async () => { throw new ModuleHttpError(422, 'validation', 'Revisa.', { title: 'Obligatorio.' }) })
  assert.equal(validation.status, 422)
  assert.deepEqual(await validation.json(), { error: 'validation', message: 'Revisa.', errors: { title: 'Obligatorio.' } })
  const range = await withModule(request(), deps(), async () => { throw new RangeError('page') })
  assert.equal(range.status, 400)
  const unknown = await withModule(request(), deps(), async () => { throw new Error('pg: relation "notas.notas" does not exist') })
  assert.equal(unknown.status, 503)
  assert.doesNotMatch(await unknown.text(), /notes\.notes|relation/)
})

test('readJson exige un objeto JSON de tamaño acotado', async () => {
  assert.deepEqual(await readJson(request({ a: 1 })), { a: 1 })
  await assert.rejects(readJson(request([1])), (e: unknown) => e instanceof ModuleHttpError && e.status === 400)
  await assert.rejects(readJson(new Request('https://m.test', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })), (e: unknown) => e instanceof ModuleHttpError && e.status === 400)
  await assert.rejects(readJson(request({ a: 1 }, { 'content-length': String(100 * 1024) })), (e: unknown) => e instanceof ModuleHttpError && e.status === 413)
})

test('isUuid solo admite UUID (de la línea 61 de vet)', () => {
  assert.equal(isUuid('00000000-0000-4000-8000-000000000001'), true)
  for (const bad of ['', 'x', '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-c000-000000000001', 7, null]) assert.equal(isUuid(bad), false, String(bad))
})

test('nueva: el permiso de la ruta sale del token; sin él, 403 insufficient_scope con su reto; sin declarar, 503', async () => {
  const declared = { ...deps(), scopes: ['notes:read', 'notes:write'] }
  assert.equal((await withModule(request(), declared, async () => json({ data: 1 }), { scope: 'notes:read' })).status, 200)
  const denied = await withModule(request(), declared, async () => json({ data: 1 }), { scope: 'notes:write' })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('www-authenticate'), 'Bearer error="insufficient_scope", scope="notes:write"')
  assert.deepEqual(await denied.json(), { error: 'insufficient_scope', message: 'La persona no tiene permiso para esto en el módulo.' })
  let asked = 0
  const undeclared = await withModule(request(), { session: async () => { asked++; return session }, scopes: ['notes:read'] }, async () => json({}), { scope: 'notes:admin' })
  assert.equal(undeclared.status, 503); assert.equal(asked, 0, 'ni siquiera mira la sesión')
  for (const code of ['wrong_audience', 'token_expired', 'token_revoked'] as const) {
    const reply = await withModule(request(), deps({ error: new ModuleAuthError(401, code) }), async () => json({}))
    assert.equal(reply.status, 401, code); assert.equal(reply.headers.get('www-authenticate'), 'Bearer'); assert.equal((await reply.json()).error, code)
  }
})
