/**
 * Portada de las pruebas de una vertical anterior en producción. Cambia: el bundle es el del módulo de ejemplo y lo
 * construye la propia prueba con `buildBundle` (en la vertical anterior hacía falta `npm run build:modulo` antes); la base es
 * `DATABASE_URL` y la instancia fija `PIMIA_TENANT_ID`; el mensaje de arranque lleva la clave del módulo; `/readyz` sin base es
 * 503. Nuevos: `/api/version` sin base es 503, y sin carpeta de migraciones no arranca.
 */
import { test, before, after } from 'node:test'
import { build, cleanup, server, unusedPort, live, assert, MIGRATIONS_DIR } from './bundle-process'
import { raw, rawRequest, moduleHeaders, ID as id } from './helpers'

const moduleEnv = { PATH: process.env.PATH, NODE_ENV: 'production', HOSTNAME: '127.0.0.1',
  PIMIA_BASE_URL: 'https://{tenant}.pimia.test.invalid', DATABASE_URL: 'postgresql://fixture:clave-fixture@127.0.0.1:1/notas', MIGRATIONS_DIR: MIGRATIONS_DIR }
const CANCELLED = 'Configuración del módulo incompleta o no válida. Arranque cancelado.'
before(build)
after(cleanup)

const NOT_FOUND = ['/healthz.rsc', '/api/notes.rsc', '/_next/data/x/healthz.json', '/_next/static/chunks/a.js', '/_next/image', '/_next/image?url=%2Fui-assets%2Finter&w=640&q=75',
  '/favicon.ico', '/ui-assets/styles', '/', '/instalar', '/auth/login', '/empresas', '/notas/1', '/integraciones/pimia/webhook',
  '/healthz/', '/api/notes/', '//instalar', '//healthz', '/api\\notas',
  '/api/notes/.', '/api/notes/..', '/api/notes/%2e%2e', '/api/notes/%zz', '/api/notes/%',
  '/api//notas', '/api/notes//comments', '/HEALTHZ', '/API/notas', '/api/Notas', `/api/notes/${id}/Comentarios`,
  '/healthz;x', '/api/notes;x', '/api', '/api/nada', '/api/notes/x/y/z/w', `/api/notes/${id}/historial`,
  'http://evil.example/healthz']

test('el bundle arranca solo con PIMIA_BASE_URL y la base; fuera de su tabla, 404 vacío con las cabeceras del módulo', { timeout: 30000 }, async () => {
  const port = await unusedPort(), instance = server({ ...moduleEnv, PORT: String(port) })
  try {
    assert.equal(await live(port), true, 'Arranca solo con lo suyo')
    const health = await rawRequest(port, 'GET', '/healthz')
    assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.body), { status: 'ok' }); moduleHeaders(health, '/healthz')
    // La base de la fixture no existe: no está listo, pero sigue vivo.
    const ready = await rawRequest(port, 'GET', '/readyz')
    assert.equal(ready.status, 503); assert.equal(ready.headers['retry-after'], '5'); assert.deepEqual(JSON.parse(ready.body), { status: 'unavailable' }); moduleHeaders(ready, '/readyz')
    const version = await rawRequest(port, 'GET', '/api/version')
    assert.equal(version.status, 503); assert.equal(JSON.parse(version.body).error, 'unavailable'); moduleHeaders(version, '/api/version')
    for (const target of NOT_FOUND) {
      const reply = await rawRequest(port, 'GET', target, { accept: 'text/html', 'x-forwarded-host': 'evil.example' })
      assert.equal(reply.status, 404, target); assert.equal(reply.body, '', target); moduleHeaders(reply, target)
    }
    const api = await rawRequest(port, 'GET', '/api/notes', { company: '1' })
    assert.equal(api.status, 401); assert.equal(api.headers['www-authenticate'], 'Bearer'); assert.equal(api.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(api.body), { error: 'unauthorized', message: 'Hace falta un token de módulo de Pimia válido.' }); moduleHeaders(api, 'API')
    for (const [method, target, allow] of [['TRACE', '/healthz', 'GET'], ['TRACE', '/api/notes', 'GET, POST'], ['HEAD', '/readyz', 'GET'], ['POST', '/api/version', 'GET'], ['DELETE', `/api/notes/${id}`, 'GET, PUT']]) {
      const reply = await rawRequest(port, method, target)
      assert.equal(reply.status, 405, `${method} ${target}`); assert.equal(reply.headers.allow, allow); assert.equal(reply.body, ''); moduleHeaders(reply, `${method} ${target}`)
    }
    const star = await rawRequest(port, 'OPTIONS', '*')
    assert.equal(star.status, 404); assert.equal(star.body, ''); moduleHeaders(star, 'OPTIONS *')
    // Lo que Node contestaría o cortaría por su cuenta: HTTP/1.1 sin Host (400), un Expect desconocido (417) y CONNECT,
    // que nunca abre un túnel (405 con Allow en una ruta de la tabla, 404 en lo demás).
    for (const [text, status, allow] of [['GET /healthz HTTP/1.1\r\n\r\n', 400], ['GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: x\r\n\r\n', 417],
      ['CONNECT /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n', 405, 'GET'], ['CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n', 404]] as const) {
      const reply = await raw(port, text)
      assert.equal(reply.status, status, text); assert.equal(reply.headers.allow, allow, text); assert.equal(reply.headers.connection, 'close', text)
      assert.equal(reply.body, '', text); moduleHeaders(reply, text)
    }
    // El tope del cuerpo son 64 KiB: con 65536 bytes llega al handler (401 sin token); con uno más, 413.
    const post = (size: number) => raw(port, Buffer.concat([Buffer.from(`POST /api/notes HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${size}\r\nConnection: close\r\n\r\n`), Buffer.alloc(size, 'a')]))
    const atLimit = await post(65536)
    assert.equal(atLimit.status, 401); moduleHeaders(atLimit, 'POST 64 KiB')
    const tooLarge = await post(65537)
    assert.equal(tooLarge.status, 413); assert.deepEqual(JSON.parse(tooLarge.body), { error: 'too_large', message: 'El cuerpo es demasiado grande.' }); moduleHeaders(tooLarge, 'POST 413')
    assert.equal((await rawRequest(port, 'GET', '/healthz')).status, 200)
    assert.ok(!instance.output().includes('clave-fixture'), 'la conexión no sale por los registros')
    // SIGTERM: deja de aceptar y sale con 0.
    instance.child.kill('SIGTERM'); assert.equal(await instance.exited, 0)
  } finally { await instance.stop() }
})

test('sin lo suyo, o con un marcador mal escrito, el módulo no arranca y no dice ningún valor', { timeout: 60000 }, async () => {
  const without = (key: keyof typeof moduleEnv) => { const env: Record<string, string | undefined> = { ...moduleEnv }; delete env[key]; return env }
  const cases: [string, Record<string, string | undefined>][] = [['sin PIMIA_BASE_URL', without('PIMIA_BASE_URL')], ['sin DATABASE_URL', without('DATABASE_URL')],
    ['base que no es PostgreSQL', { ...moduleEnv, DATABASE_URL: 'mysql://fixture@127.0.0.1:1/notas' }],
    ['base sin nombre', { ...moduleEnv, DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/' }],
    ['dirección fija sin PIMIA_TENANT_ID', { ...moduleEnv, PIMIA_BASE_URL: 'https://pimia.test.invalid' }],
    ['marcador fuera del subdominio', { ...moduleEnv, PIMIA_BASE_URL: 'https://app.{tenant}.pimia.test.invalid' }],
    ['marcador en mayúsculas', { ...moduleEnv, PIMIA_BASE_URL: 'https://{TENANT}.pimia.test.invalid', PIMIA_TENANT_ID: 'fixture' }],
    ['marcador codificado', { ...moduleEnv, PIMIA_BASE_URL: 'https://%7Btenant%7D.pimia.test.invalid', PIMIA_TENANT_ID: 'fixture' }],
    ['dos marcadores', { ...moduleEnv, PIMIA_BASE_URL: 'https://{tenant}.{tenant}.test.invalid' }],
    ['el doble de Pimia en producción', { ...moduleEnv, PIMIA_DOUBLE_URL: 'http://127.0.0.1:1' }],
    ['el doble en el bundle de producción, aunque NODE_ENV no lo sea', { ...moduleEnv, NODE_ENV: 'development', PIMIA_DOUBLE_URL: 'http://127.0.0.1:1' }],
    ['sin carpeta de migraciones', { ...moduleEnv, MIGRATIONS_DIR: '/no/existe' }],
    ['PORT no válido', { ...moduleEnv, PORT: 'tres mil' }]]
  for (const [name, env] of cases) {
    const instance = server({ PORT: String(await unusedPort()), ...env })
    try {
      assert.equal(await instance.exited, 1, name)
      assert.equal(instance.output().trim(), CANCELLED, name)
    } finally { await instance.stop() }
  }
  // Con dirección fija y su slug sí arranca: una sola instancia. Y SIGINT también la para con 0.
  const port = await unusedPort(), instance = server({ ...moduleEnv, PIMIA_BASE_URL: 'https://pimia.test.invalid', PIMIA_TENANT_ID: 'fixture', PORT: String(port) })
  try {
    assert.equal(await live(port), true)
    instance.child.kill('SIGINT'); assert.equal(await instance.exited, 0)
  } finally { await instance.stop() }
})

test('sin HOSTNAME en el entorno, el módulo escucha en 127.0.0.1', { timeout: 30000 }, async () => {
  const env: Record<string, string | undefined> = { ...moduleEnv }; delete env.HOSTNAME
  const port = await unusedPort(), instance = server({ ...env, PORT: String(port) })
  try {
    assert.equal(await live(port), true)
    const line = `Módulo dvi-base-notes escuchando en 127.0.0.1:${port}`
    for (let i = 0; i < 40 && !instance.output().includes(line); i++) await new Promise(r => setTimeout(r, 50))
    assert.ok(instance.output().split('\n').includes(line), instance.output())
    instance.child.kill('SIGTERM'); assert.equal(await instance.exited, 0)
  } finally { await instance.stop() }
})

test('nueva: el bundle de producción no lleva el desvío al doble de Pimia; el de desarrollo, sí', async () => {
  const { readFileSync } = await import('node:fs')
  const { BUNDLE, BUNDLE_DEV } = await import('./bundle-process')
  const production = readFileSync(BUNDLE, 'utf8'), development = readFileSync(BUNDLE_DEV, 'utf8')
  assert.doesNotMatch(production, /PIMIA_DOUBLE_URL no v/) // esbuild escribe la «á» como \xE1
  assert.match(development, /PIMIA_DOUBLE_URL no v/)
})
