/**
 * Portada de las pruebas de una vertical anterior en producción, sin Playwright: el bundle del módulo
 * de ejemplo contra el doble de Pimia y el PostgreSQL efímero. Cambia: pacientes → notas; antes de arrancar, el propio
 * bundle aplica las migraciones (`node server.cjs migrate`, nuevo); `/readyz` mira el historial de migraciones; nuevo `/api/version` con el
 * commit y las migraciones aplicadas (criterio 5). Criterio 4 visto desde la API: la otra empresa no ve ni edita.
 */
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createPimiaDouble, LUCIA } from '@dvi-base/pimia-double'
import { build, cleanup, server, unusedPort, live, assert, BUNDLE_DEV as BUNDLE, MIGRATIONS_DIR, type Instance } from '../tests/bundle-process'
import { manifest } from '../tests/example/module'

const ownerUrl = process.env.TEST_PG_OWNER_URL!, runtimeUrl = process.env.TEST_PG_RUNTIME_URL!
assert.ok(ownerUrl && runtimeUrl, 'Ejecuta con `npm run test:bd`')
const COMMIT = 'c'.repeat(40)
const double = createPimiaDouble({ owner: manifest.owner, key: manifest.key, baseUrl: 'https://pimia.test.invalid', tenantId: 'demo' })
let baseUrl = '', instance: Instance | undefined, env: Record<string, string | undefined> = {}
const migrateWithBundle = () => {
  const result = spawnSync(process.execPath, [BUNDLE, 'migrate'], { env: { ...env, DATABASE_OWNER_URL: ownerUrl } as NodeJS.ProcessEnv, encoding: 'utf8' })
  return { code: result.status, lines: result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), output: result.stdout + result.stderr }
}

before(async () => {
  await build()
  await new Promise<void>(resolve => double.listen(0, '127.0.0.1', resolve))
  const port = await unusedPort()
  env = { PATH: process.env.PATH, NODE_ENV: 'test', PIMIA_DOUBLE_URL: `http://127.0.0.1:${(double.address() as AddressInfo).port}`,
    PIMIA_BASE_URL: 'https://pimia.test.invalid', PIMIA_TENANT_ID: 'demo', DATABASE_URL: runtimeUrl, MIGRATIONS_DIR: MIGRATIONS_DIR,
    BUILD_REVISION: COMMIT, HOSTNAME: '127.0.0.1', PORT: String(port) }
  const migrated = migrateWithBundle()
  assert.equal(migrated.code, 0, migrated.output)
  assert.equal(migrated.lines.length, 1); assert.equal(migrated.lines[0].step, 'migrations'); assert.equal(migrated.lines[0].status, 'ok')
  instance = server(env, BUNDLE)
  assert.equal(await live(port), true)
  baseUrl = `http://127.0.0.1:${port}`
})
after(async () => { await instance?.stop(); double.close(); cleanup() })

/** Lucía, con un token de módulo de la empresa que se pida (por defecto la 1) y los dos permisos del módulo. */
const lucia = (extra: Record<string, string> = {}) => {
  const company = extra.company ?? '1'
  const token = double.issue({ person: LUCIA.id, company: Number(company), tenant: 'demo', scopes: ['notes:read', 'notes:write'] })!.token
  return { authorization: `Bearer ${token}`, company, 'content-type': 'application/json', ...extra }
}
const send = (method: string, path: string, headers: Record<string, string>, data?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) })
const purchase = { title: 'Comprar material', body: 'Tornillos y cola' }

test('migrar con el bundle: una línea JSON, idempotente, y nunca dice la dirección de la base', () => {
  const again = migrateWithBundle()
  assert.equal(again.code, 0)
  assert.deepEqual(again.lines, [{ step: 'migrations', status: 'ok', schema: 'notes', applied: [], already_applied: 1 }])
  assert.ok(!again.output.includes(new URL(ownerUrl).password), 'sin la clave')
  // Sin la conexión del propietario, error de configuración, sin valores.
  const withoutOwner = spawnSync(process.execPath, [BUNDLE, 'migrate'], { env: { ...env } as NodeJS.ProcessEnv, encoding: 'utf8' })
  assert.equal(withoutOwner.status, 1)
  assert.equal(JSON.parse(withoutOwner.stdout.trim()).reason, 'configuration')
  assert.ok(!withoutOwner.stdout.includes(new URL(runtimeUrl).password))
})

test('alta, lista, ficha y edición con versión, acotadas a la empresa', async () => {
  const empty = await send('GET', '/api/notes', lucia({ 'x-pimia-tenant': 'demo' }))
  assert.equal(empty.status, 200)
  const countBefore = (await empty.json()).data.length

  const id = randomUUID()
  const createReply = await send('POST', '/api/notes', lucia(), { id, ...purchase })
  assert.equal(createReply.status, 201)
  const created = (await createReply.json()).data
  assert.deepEqual({ ...created, updated_at: undefined }, { id, ...purchase, version: 1, created_by: '7', company_id: '1', tenant_id: 'demo', updated_at: undefined })
  // Repetir la misma alta (un reintento) devuelve la misma nota; otra con ese id es conflicto.
  assert.equal((await (await send('POST', '/api/notes', lucia(), { id, ...purchase })).json()).data.version, 1)
  const conflictReply = await send('POST', '/api/notes', lucia(), { id, ...purchase, title: 'Otra' })
  assert.equal(conflictReply.status, 409); assert.equal((await conflictReply.json()).error, 'conflict')

  const listReply = await send('GET', '/api/notes?search=material', lucia())
  assert.ok((await listReply.json()).data.map((n: { id: string }) => n.id).includes(id))
  assert.equal((await (await send('GET', '/api/notes', lucia())).json()).data.length, countBefore + 1)

  const detail = await send('GET', `/api/notes/${id}`, lucia())
  assert.equal(detail.status, 200); assert.equal((await detail.json()).data.title, 'Comprar material')

  const edited = await send('PUT', `/api/notes/${id}`, lucia(), { version: 1, ...purchase, title: 'Comprar material II' })
  assert.equal(edited.status, 200)
  const editedBody = (await edited.json()).data
  assert.equal(editedBody.title, 'Comprar material II'); assert.equal(editedBody.version, 2)
  const stale = await send('PUT', `/api/notes/${id}`, lucia(), { version: 1, ...purchase, title: 'III' })
  assert.equal(stale.status, 409)

  // La validación dice qué campo falla y nada se guarda.
  const invalid = await send('POST', '/api/notes', lucia(), { id: randomUUID(), title: ' ', body: 7 })
  assert.equal(invalid.status, 422)
  assert.deepEqual((await invalid.json()).errors, { title: 'Obligatorio.', body: 'Valor no válido.' })

  // La otra empresa de la misma persona no la ve ni la edita.
  assert.equal((await send('GET', `/api/notes/${id}`, lucia({ company: '2' }))).status, 404)
  assert.equal((await send('PUT', `/api/notes/${id}`, lucia({ company: '2' }), { version: 2, ...purchase })).status, 404)
  assert.ok(!(await (await send('GET', '/api/notes', lucia({ company: '2' }))).json()).data.map((n: { id: string }) => n.id).includes(id))
})

test('vivo, listo y versión: /readyz comprueba el historial con el rol de ejecución; /api/version dice qué corre', async () => {
  const live = await fetch(`${baseUrl}/healthz`)
  assert.equal(live.status, 200); assert.deepEqual(await live.json(), { status: 'ok' })
  const ready = await fetch(`${baseUrl}/readyz`)
  assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { status: 'ready' }); assert.equal(ready.headers.get('cache-control'), 'no-store')
  const version = await fetch(`${baseUrl}/api/version`)
  assert.equal(version.status, 200)
  assert.deepEqual(await version.json(), { module: 'dvi-base-notes', commit: COMMIT, migrations: [{ version: 1, name: 'notes' }] })
})

test('fuera de su API no existe nada: la portada y lo que un framework desenvolvía responden 404 sin cuerpo', async () => {
  for (const path of ['/', '/instalar', '/auth/login', '/empresas', '/healthz.rsc', '/_next/data/x/healthz.json', '/_next/static/chunks/a.js', '/favicon.ico',
    '/ui-assets/styles', '/api/nada', '/api/notes/x/y/z/w', '/api/notes/']) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', headers: { accept: 'text/html' } })
    assert.equal(response.status, 404, path); assert.equal(await response.text(), '', path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path); assert.equal(response.headers.get('set-cookie'), null, path); assert.equal(response.headers.get('location'), null, path)
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'", path); assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path)
  }
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200)
})
