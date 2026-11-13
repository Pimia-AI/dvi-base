/** Nueva: las pantallas que sirve el propio módulo en `/app/*` (contrato embebido §5 y §9). */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUi, readHostOrigins, frameAncestors } from '../src/ui'
import { createModuleServer } from '../src/server'
import { readManifest } from '../src/manifest'
import { handlers, routes } from './example/module'
import { call, raw, moduleHeaders } from './helpers'

for (const key of Object.keys(process.env)) if (/^(PIMIA_|DATABASE_URL$|TEST_)/.test(key)) delete process.env[key]
Object.assign(process.env, { PIMIA_BASE_URL: 'https://{tenant}.pimia.test.invalid' })
const dir = mkdtempSync(join(tmpdir(), 'dvi-ui-'))
mkdirSync(join(dir, 'assets'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><title>Notas</title></head><body><div id="root"></div><script type="module" src="/app/assets/index-abc.js"></script></body></html>')
writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)')
writeFileSync(join(dir, 'assets', 'index-abc.css'), 'body{}')
writeFileSync(join(dir, 'assets', 'inter.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]))
writeFileSync(join(dir, 'assets', 'nota.txt'), 'tipo no admitido')
const manifest = readManifest({ owner: 'dvi-base', key: 'dvi-base-notes', name: 'Notas', schema: 'notes', ui: { screens: [{ id: 'notes', title: 'Notas', path: '/app/notes' }] } })
const ORIGINS = ['https://{tenant}.taskai.work', 'http://127.0.0.1:7161']
const servers: Server[] = []
after(() => { for (const server of servers) { server.closeAllConnections(); server.close() }; rmSync(dir, { recursive: true, force: true }) })
async function start(): Promise<number> {
  const server = createModuleServer({ routes, handlers }, { ui: loadUi(dir, manifest, ORIGINS) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

test('las rutas de las pantallas devuelven el HTML, que solo puede embeber un anfitrión permitido', async () => {
  const port = await start()
  for (const path of ['/app/notes', '/app/notes/new', '/app/notes/00000000-0000-4000-8000-000000000001', '/app/notes?pimia_protocol=1&pimia_tenant=demo']) {
    const reply = await call(port, 'GET', path)
    assert.equal(reply.status, 200, path)
    assert.equal(reply.headers['content-type'], 'text/html; charset=utf-8', path)
    assert.match(reply.body, /<meta name="pimia-host-origins" content="https:\/\/\{tenant\}\.taskai\.work,http:\/\/127\.0\.0\.1:7161">/, path)
    const csp = String(reply.headers['content-security-policy'])
    assert.match(csp, /frame-ancestors https:\/\/\*\.taskai\.work http:\/\/127\.0\.0\.1:7161/, path)
    assert.match(csp, /default-src 'self'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /base-uri 'none'/)
    assert.equal(reply.headers['cache-control'], 'no-store'); assert.equal(reply.headers['x-content-type-options'], 'nosniff')
    assert.equal(reply.headers['x-frame-options'], undefined, 'lo sustituye frame-ancestors')
  }
})

test('los recursos construidos, con su tipo y caché larga; lo que no es de la lista, 404', async () => {
  const port = await start()
  const js = await call(port, 'GET', '/app/assets/index-abc.js')
  assert.equal(js.status, 200); assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8'); assert.equal(js.body, 'console.log(1)')
  assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable'); assert.equal(js.headers['content-security-policy'], "default-src 'none'")
  assert.equal((await call(port, 'GET', '/app/assets/index-abc.css')).headers['content-type'], 'text/css; charset=utf-8')
  assert.equal((await call(port, 'GET', '/app/assets/inter.woff2')).headers['content-type'], 'font/woff2')
  for (const path of ['/app', '/app/', '/app/assets/nota.txt', '/app/assets/no-existe.js', '/app/assets/../index.html', '/app/assets/%2e%2e/index.html', '/app/notas',
    '/app/notesx', '/app/notes/', '/app/notes//x', '/app/notes/../../etc/passwd', '/app/notes/%2e%2e', '/app/notes/a.b', '/app/index.html', '/app/Notes']) {
    const reply = await call(port, 'GET', path)
    assert.equal(reply.status, 404, path); assert.equal(reply.body, '', path); moduleHeaders(reply, path)
  }
})

test('solo GET en las pantallas; la API sigue con sus cabeceras y sin HTML', async () => {
  const port = await start()
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    const reply = await call(port, method, '/app/notes')
    assert.equal(reply.status, 405, method); assert.equal(reply.headers.allow, 'GET', method)
  }
  const api = await call(port, 'GET', '/api/notes', { company: '1' })
  assert.equal(api.status, 401); moduleHeaders(api, 'API')
  const health = await raw(port, 'GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
  assert.equal(health.status, 200); moduleHeaders(health, '/healthz')
})

test('PIMIA_HOST_ORIGINS: orígenes exactos o con {tenant}; http solo a loopback; y sin pantallas o sin construir, no se carga', () => {
  assert.deepEqual(readHostOrigins(' https://{tenant}.taskai.work , http://127.0.0.1:7161 '), ORIGINS)
  assert.equal(frameAncestors(ORIGINS), 'https://*.taskai.work http://127.0.0.1:7161')
  for (const bad of [undefined, '', 'http://demo.taskai.work', 'https://demo.taskai.work/', 'https://*.taskai.work', 'javascript:alert(1)', "https://a.example 'unsafe-inline'", 'https://a.example;script-src *']) {
    assert.throws(() => readHostOrigins(bad), /PIMIA_HOST_ORIGINS/, String(bad))
  }
  assert.throws(() => loadUi(dir, readManifest({ owner: 'dvi-base', key: 'x', name: 'X', schema: 'x' }), ORIGINS), /pantallas/)
  assert.throws(() => loadUi(join(dir, 'no-existe'), manifest, ORIGINS), /index\.html/)
})

test('PIMIA_HOST_ORIGINS como lista exacta (contrato §9): el panel de Pimia y la app del integrador, tal cual en frame-ancestors y en la meta', async () => {
  const EXACT = readHostOrigins('https://panel.taskai.work, https://app.integrator.example')
  assert.deepEqual(EXACT, ['https://panel.taskai.work', 'https://app.integrator.example'])
  assert.equal(frameAncestors(EXACT), 'https://panel.taskai.work https://app.integrator.example', 'los mismos orígenes, en el mismo orden y sin comodines')
  const server = createModuleServer({ routes, handlers }, { ui: loadUi(dir, manifest, EXACT) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const reply = await call(port, 'GET', '/app/notes?pimia_protocol=1&pimia_host=https%3A%2F%2Fpanel.taskai.work&pimia_tenant=demo&pimia_company=1')
  assert.equal(reply.status, 200)
  const csp = String(reply.headers['content-security-policy'])
  assert.equal(/frame-ancestors ([^;]+)/.exec(csp)?.[1], 'https://panel.taskai.work https://app.integrator.example')
  assert.doesNotMatch(csp, /\*/, 'ni un comodín')
  assert.match(reply.body, /<meta name="pimia-host-origins" content="https:\/\/panel\.taskai\.work,https:\/\/app\.integrator\.example">/)
  // La API no cambia: nadie la embebe.
  moduleHeaders(await call(port, 'GET', '/api/notes', { company: '1' }), 'API')
  // Un HEAD a una pantalla es 405 con las cabeceras de la API: la comprobación de frame-ancestors se hace con un GET.
  const head = await call(port, 'HEAD', '/app/notes')
  assert.equal(head.status, 405); moduleHeaders(head, 'HEAD /app/notes')
})
