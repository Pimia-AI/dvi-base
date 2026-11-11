/**
 * Portada de las pruebas de una vertical anterior en producción, sin Playwright: el bundle del módulo de ejemplo
 * contra el doble de Pimia (`@dvi-base/pimia-double`), con `PIMIA_DOUBLE_URL` y el bundle de desarrollo. Cambia: los tokens son tokens de módulo firmados que emite el doble como lo hará el ERP. Nuevas: con un token bueno, el
 * handler recibe la sesión que dice el token; `/api/session` la devuelve; el permiso de la ruta sale del token.
 * Los siete casos de la suite de contrato están en `contract.test.ts`.
 */
import { test, before, after } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createPimiaDouble, LUCIA } from '@dvi-base/pimia-double'
import { build, cleanup, server, unusedPort, live, assert, MIGRATIONS_DIR, BUNDLE_DEV, type Instance } from './bundle-process'
import { manifest } from './example/module'

let baseUrl = '', instance: Instance | undefined
const double = createPimiaDouble({ owner: manifest.owner, key: manifest.key, baseUrl: 'https://pimia.test.invalid', tenantId: 'demo' })
before(async () => {
  await build()
  await new Promise<void>(resolve => double.listen(0, '127.0.0.1', resolve))
  const port = await unusedPort()
  instance = server({ PATH: process.env.PATH, NODE_ENV: 'test', PIMIA_DOUBLE_URL: `http://127.0.0.1:${(double.address() as AddressInfo).port}`,
    PIMIA_BASE_URL: 'https://pimia.test.invalid', PIMIA_TENANT_ID: 'demo', DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/notas', MIGRATIONS_DIR: MIGRATIONS_DIR, HOSTNAME: '127.0.0.1', PORT: String(port) }, BUNDLE_DEV)
  assert.equal(await live(port), true)
  baseUrl = `http://127.0.0.1:${port}`
})
after(async () => { await instance?.stop(); double.close(); cleanup() })

const get = (path: string, headers: Record<string, string>, method = 'GET') => fetch(`${baseUrl}${path}`, { method, headers })
const tokenFor = (company: number, scopes = ['notes:read'], extra = {}) => double.issue({ person: LUCIA.id, company, tenant: 'demo', scopes, ...extra })!.token

test('sin token, con uno opaco o sin empresa, el módulo no abre', async () => {
  const noToken = await get('/api/notes', { company: '1' })
  assert.equal(noToken.status, 401); assert.equal(noToken.headers.get('www-authenticate'), 'Bearer'); assert.equal(noToken.headers.get('cache-control'), 'no-store')
  assert.equal((await noToken.json()).error, 'unauthorized')
  const opaque = await get('/api/notes', { authorization: 'Bearer module-lucia', company: '1' })
  assert.equal(opaque.status, 401); assert.equal((await opaque.json()).error, 'unauthorized')
  const noCompany = await get('/api/notes', { authorization: `Bearer ${tokenFor(1)}` })
  assert.equal(noCompany.status, 403); assert.equal((await noCompany.json()).error, 'company_required')
})

test('nueva: con un token bueno y su empresa, el handler recibe la sesión que dice el token', async () => {
  const ok = await get('/api/notes/abc/comments?x=1', { authorization: `Bearer ${tokenFor(2, ['notes:read'], { actor: 'dvi:agent:1' })}`, company: '2', 'x-pimia-tenant': 'demo' })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { data: { route: 'comments', method: 'GET', params: { noteId: 'abc' }, session: { userId: '7', userName: 'Lucía García', tenantId: 'demo', companyId: '2', scopes: ['notes:read'], actor: 'dvi:agent:1' } } })
})

test('nueva: /api/session devuelve la sesión; el permiso de la ruta sale del token, antes de tocar la base', async () => {
  const who = await get('/api/session', { authorization: `Bearer ${tokenFor(1, [])}`, company: '1' })
  assert.equal(who.status, 200)
  assert.deepEqual(await who.json(), { data: { userId: '7', userName: 'Lucía García', tenantId: 'demo', companyId: '1', scopes: [], actor: null } })
  // Sin `notes:read`, la lista no llega a abrir la base (que en esta prueba ni existe): 403, no 503.
  const list = await get('/api/notes', { authorization: `Bearer ${tokenFor(1, [])}`, company: '1' })
  assert.equal(list.status, 403); assert.equal((await list.json()).error, 'insufficient_scope')
  assert.equal(list.headers.get('www-authenticate'), 'Bearer error="insufficient_scope", scope="notes:read"')
})
