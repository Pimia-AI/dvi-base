/** El cliente de la API del módulo desde sus pantallas (contrato embebido §7). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModuleApi, ModuleApiError } from '../src/api'
import type { HostSession } from '../src/host'

const make = (token: string): HostSession => ({ token, expiresAt: Date.now() + 600_000, tenant: 'demo', company: { id: '12', name: 'Doce' }, user: { id: '7', name: 'Lucía' }, locale: 'es-ES', theme: 'light' })
function source() {
  const calls = { get: 0, request: 0, reported: [] as [string, number][] }
  return {
    calls,
    session: {
      getSession: async () => { calls.get++; return make('tok-1') },
      requestSession: async () => { calls.request++; return make('tok-2') },
      reportError: (code: string, status: number) => { calls.reported.push([code, status]) },
    },
  }
}

test('cada petición lleva el token, la empresa y la instancia, sin cookies; el cuerpo, en JSON', async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const { session } = source()
  const api = createModuleApi({ session, fetch: async (url, init) => { seen.push({ url: String(url), init: init! }); return Response.json({ data: { ok: true } }, { status: 201 }) } })
  assert.deepEqual(await api.post('/api/notes', { title: 'Hola' }), { data: { ok: true } })
  assert.equal(seen[0].url, '/api/notes')
  assert.equal(seen[0].init.method, 'POST')
  assert.deepEqual(seen[0].init.headers, { authorization: 'Bearer tok-1', company: '12', 'x-pimia-tenant': 'demo', 'content-type': 'application/json' })
  assert.equal(seen[0].init.body, '{"title":"Hola"}')
  assert.equal(seen[0].init.credentials, 'omit')
})

test('un 401 pide sesión nueva una vez y repite una vez; si vuelve a fallar, error y aviso al anfitrión', async () => {
  const tokens: string[] = []
  const ok = source()
  let first = true
  const api = createModuleApi({ session: ok.session, fetch: async (_url, init) => {
    tokens.push(String((init!.headers as Record<string, string>).authorization))
    if (first) { first = false; return Response.json({ error: 'unauthorized', message: 'x' }, { status: 401 }) }
    return Response.json({ data: [] })
  } })
  assert.deepEqual(await api.get('/api/notes'), { data: [] })
  assert.deepEqual(tokens, ['Bearer tok-1', 'Bearer tok-2']); assert.equal(ok.calls.request, 1)

  const bad = source()
  const always401 = createModuleApi({ session: bad.session, fetch: async () => Response.json({ error: 'unauthorized', message: 'Hace falta un token de Pimia válido.' }, { status: 401 }) })
  await assert.rejects(always401.get('/api/notes'), (e: unknown) => e instanceof ModuleApiError && e.status === 401 && e.code === 'unauthorized')
  assert.equal(bad.calls.request, 1, 'solo un reintento')
  assert.deepEqual(bad.calls.reported, [['unauthorized', 401]])
})

test('los errores del módulo salen con su código y sus errores por campo; los que bloquean se avisan', async () => {
  const s = source()
  const reply = (status: number, body: unknown) => createModuleApi({ session: s.session, fetch: async () => Response.json(body, { status }) })
  await assert.rejects(reply(422, { error: 'validation', message: 'Revisa.', errors: { title: 'Obligatorio.' } }).post('/api/notes', {}),
    (e: unknown) => e instanceof ModuleApiError && e.code === 'validation' && e.errors?.title === 'Obligatorio.')
  await assert.rejects(reply(403, { error: 'not_in_plan', message: 'x' }).get('/api/notes'), (e: unknown) => e instanceof ModuleApiError && e.code === 'not_in_plan')
  await assert.rejects(reply(409, { error: 'conflict', message: 'x' }).put('/api/notes/1', {}), (e: unknown) => e instanceof ModuleApiError && e.code === 'conflict')
  await assert.rejects(createModuleApi({ session: s.session, fetch: async () => new Response('<html>', { status: 502 }) }).get('/x'), (e: unknown) => e instanceof ModuleApiError && e.code === 'unavailable')
  await assert.rejects(createModuleApi({ session: s.session, fetch: async () => { throw new TypeError('fetch failed') } }).get('/x'), (e: unknown) => e instanceof ModuleApiError && e.status === 0 && e.code === 'network')
  assert.deepEqual(s.calls.reported, [['not_in_plan', 403]], 'solo lo que bloquea')
})
