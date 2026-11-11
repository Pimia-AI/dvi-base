/** El servidor del anfitrión de desarrollo: su configuración, a quién deja embeber, qué sirve y de dónde saca el token. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDevHost } from '../src/server'

const dir = mkdtempSync(join(tmpdir(), 'dvi-host-'))
mkdirSync(join(dir, 'assets'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Pimia</title>')
writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)')
const people = [{ label: 'Lucía García', user: { id: '7', name: 'Lucía García', email: 'lucia@ejemplo.invalid' }, companies: [{ id: '1', name: 'Empresa Uno' }] }]
const issued: [number, string][] = []
const server = createDevHost({
  moduleOrigin: 'http://127.0.0.1:7160', module: { key: 'dvi-base-notes', name: 'Notas', screens: [{ id: 'notes', title: 'Notas', path: '/app/notes' }] }, tenant: 'demo', people, uiDir: dir,
  issue: async (person, company) => { issued.push([person, company]); return company === '1' ? { token: `tok-${issued.length}`, expires_at: '2026-11-08T00:10:00.000Z' } : null },
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })

test('la configuración: el módulo, dónde corre, la instancia y las personas, sin ningún token', async () => {
  const reply = await fetch(`${base}/dev/config`)
  assert.equal(reply.status, 200)
  const text = await reply.text()
  assert.deepEqual(JSON.parse(text), { tenant: 'demo', module: { key: 'dvi-base-notes', name: 'Notas', screens: [{ id: 'notes', title: 'Notas', path: '/app/notes' }], origin: 'http://127.0.0.1:7160' }, people })
  assert.doesNotMatch(text, /token/)
})

test('/dev/session: un token nuevo en cada petición, para esa persona y esa empresa; si no puede tenerlo, 403', async () => {
  const first = await (await fetch(`${base}/dev/session?person=0&company=1`)).json()
  const second = await (await fetch(`${base}/dev/session?person=0&company=1`)).json()
  assert.notEqual(first.token, second.token)
  assert.deepEqual(issued.slice(0, 2), [[0, '1'], [0, '1']])
  assert.equal((await fetch(`${base}/dev/session?person=0&company=3`)).status, 403)
  for (const query of ['person=9&company=1', 'person=x&company=1', 'person=0', 'person=0&company=0', 'person=0&company=1;x']) {
    assert.equal((await fetch(`${base}/dev/session?${query}`)).status, 400, query)
  }
  assert.equal((await fetch(`${base}/dev/session?person=0&company=1`)).headers.get('cache-control'), 'no-store')
})

test('solo embebe al módulo (frame-src) y a él no lo embebe nadie; la cáscara en / y en /m/…', async () => {
  for (const path of ['/', '/m/dvi-base-notes/notes', '/m/dvi-base-notes/notes/new']) {
    const reply = await fetch(`${base}${path}`)
    assert.equal(reply.status, 200, path); assert.match(await reply.text(), /<title>Pimia<\/title>/)
    const csp = reply.headers.get('content-security-policy') ?? ''
    assert.match(csp, /frame-src http:\/\/127\.0\.0\.1:7160;/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /script-src 'self'/)
  }
  assert.equal((await fetch(`${base}/assets/index-abc.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal((await fetch(`${base}/assets/no-existe.js`)).status, 404)
  assert.equal((await fetch(`${base}/otra-cosa`)).status, 404)
  assert.equal((await fetch(`${base}/dev/config`, { method: 'POST' })).status, 405)
})
