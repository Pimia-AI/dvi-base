/**
 * Portada de las pruebas de una vertical anterior en producción. Cambia: el módulo es el de ejemplo
 * (`/api/notes`), los handlers se pasan a `createModuleServer`, y lo que falta un handler o sobra uno se comprueba al
 * crear el servidor. `/readyz` (238-268) conserva el nombre, pero en vez de columnas de tablas clínicas comprueba el
 * historial de migraciones, y se añade `/api/version`.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest, type Server } from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { join } from 'node:path'
import pg from 'pg'
import { closeModulePool, configureStore, modulePool } from '../src/store'
import { createDiagnostics } from '../src/diagnostics'
import { readMigrations } from '../src/migrations'
import { createModuleServer, MAX_BODY_BYTES, type BaseHandlers, type HandlersFor } from '../src/server'
import { handlers as moduleHandlers, routes } from './example/module'
import { call, raw, moduleHeaders, ID as id, type Reply } from './helpers'
import { moduleKeyPair, signModuleToken } from '@dvi-base/pimia-double'

// Solo lo del módulo: patrón de la vertical. Ni sesión de app, ni orígenes, ni cifrado.
for (const key of Object.keys(process.env)) if (/^(PIMIA_|DATABASE_URL$|TEST_)/.test(key)) delete process.env[key]
Object.assign(process.env, { PIMIA_BASE_URL: 'https://{tenant}.pimia.test.invalid' })

const servers: Server[] = []
after(() => { for (const server of servers) { server.closeAllConnections(); server.close() } })
async function start(handlers: HandlersFor<typeof routes> = moduleHandlers, baseHandlers?: Partial<BaseHandlers>): Promise<number> {
  const server = createModuleServer({ routes, handlers }, { baseHandlers })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

test('un handler por cada ruta y método de la tabla: si falta o sobra uno, el servidor no se crea', () => {
  assert.doesNotThrow(() => createModuleServer({ routes, handlers: moduleHandlers }))
  const { note: _note, ...withoutNote } = moduleHandlers
  assert.throws(() => createModuleServer({ routes, handlers: withoutNote as HandlersFor<typeof routes> }), /note/)
  assert.throws(() => createModuleServer({ routes, handlers: { ...moduleHandlers, note: { GET: moduleHandlers.note.GET } } as unknown as HandlersFor<typeof routes> }), /note/)
  assert.throws(() => createModuleServer({ routes, handlers: { ...moduleHandlers, comment: { ...moduleHandlers.comment, GET: moduleHandlers.note.GET } } as unknown as HandlersFor<typeof routes> }), /comment/)
  assert.throws(() => createModuleServer({ routes, handlers: { ...moduleHandlers, sobra: { GET: moduleHandlers.note.GET } } as unknown as HandlersFor<typeof routes> }), /sobra/)
})

test('vida 200; fuera de la tabla 404 y con otro método 405, sin cuerpo y con las cabeceras del módulo', async () => {
  const port = await start()
  const live = await call(port, 'GET', '/healthz', { cookie: 'sesion=fixture' })
  assert.equal(live.status, 200); assert.deepEqual(JSON.parse(live.body), { status: 'ok' }); assert.equal(live.headers['content-type'], 'application/json')
  moduleHeaders(live, '/healthz')
  for (const path of ['/', '/instalar', '/auth/login', '/healthz.rsc', '/api/notes.rsc', '/_next/data/x/healthz.json', '/_next/static/chunks/a.js', '/favicon.ico',
    '/ui-assets/styles', '/api/nada', '/api/notes/', '//instalar', '/api\\notas', '/api/notes/..', '/api/notes/%2e%2e', '/api/notes/%zz']) {
    const reply = await call(port, 'GET', path, { accept: 'text/html' })
    assert.equal(reply.status, 404, path); assert.equal(reply.body, '', path); assert.equal(reply.headers['content-type'], undefined, path)
    moduleHeaders(reply, path)
  }
  for (const [method, path, allow] of [['DELETE', '/api/notes', 'GET, POST'], ['PATCH', `/api/notes/${id}`, 'GET, PUT'], ['HEAD', '/healthz', 'GET'],
    ['OPTIONS', '/healthz', 'GET'], ['TRACE', '/healthz', 'GET'], ['GET', `/api/notes/${id}/tags/${id}`, 'PUT'], ['TRACE', `/api/notes/${id}/comments`, 'GET, POST']]) {
    const reply = await call(port, method, path)
    assert.equal(reply.status, 405, `${method} ${path}`); assert.equal(reply.headers.allow, allow, `${method} ${path}`); assert.equal(reply.body, '')
    moduleHeaders(reply, `${method} ${path}`)
  }
  // Ni `*` ni la forma absoluta: 404 con las cabeceras, también por socket crudo.
  for (const text of ['OPTIONS * HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n', 'GET http://evil.example/healthz HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n',
    'TRACE * HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n']) {
    const reply = await raw(port, text)
    assert.equal(reply.status, 404, text); assert.equal(reply.body, '', text); assert.equal(reply.headers.location, undefined, text)
    moduleHeaders(reply, text)
  }
  // Lo que Node no entiende también sale con las cabeceras del módulo.
  const malformed = await raw(port, 'GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nsin dos puntos\r\n\r\n')
  assert.equal(malformed.status, 400); moduleHeaders(malformed, 'malformada')
})

test('lo que Node contestaría o cortaría por su cuenta sale con las cabeceras del módulo: sin Host, Expect y CONNECT', async () => {
  const port = await start()
  // HTTP/1.1 sin Host: 400 y se cierra, también en la forma absoluta, con Expect o con CONNECT. HTTP/1.0 no la exige.
  for (const text of ['GET /healthz HTTP/1.1\r\n\r\n', 'GET http://evil.example/healthz HTTP/1.1\r\n\r\n', 'POST /api/notes HTTP/1.1\r\nContent-Length: 0\r\n\r\n',
    'GET /healthz HTTP/1.1\r\nExpect: x\r\n\r\n', 'CONNECT /healthz HTTP/1.1\r\n\r\n']) {
    const reply = await raw(port, text)
    assert.equal(reply.status, 400, text); assert.equal(reply.body, '', text); assert.equal(reply.headers.connection, 'close', text)
    moduleHeaders(reply, text)
  }
  const http10 = await raw(port, 'GET /healthz HTTP/1.0\r\n\r\n')
  assert.equal(http10.status, 200); moduleHeaders(http10, 'HTTP/1.0 sin Host')
  // Un Expect que no es 100-continue: 417 sin llegar al handler, y la conexión se cierra aunque no se pida.
  for (const text of ['GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: x\r\n\r\n', 'GET /api/notes HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect:\r\n\r\n',
    'POST /nada HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: foo\r\nContent-Length: 0\r\nConnection: close\r\n\r\n']) {
    const reply = await raw(port, text)
    assert.equal(reply.status, 417, text); assert.equal(reply.body, '', text); assert.equal(reply.headers.connection, 'close', text)
    moduleHeaders(reply, text)
  }
  // CONNECT nunca abre un túnel: 405 con Allow en una ruta de la tabla y 404 en lo demás. Lo que venga detrás no se procesa.
  for (const [text, status, allow] of [
    ['CONNECT /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\nGET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n', 405, 'GET'],
    ['CONNECT /api/notes HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n', 405, 'GET, POST'],
    ['CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n', 404, undefined],
    ['CONNECT /nada HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n', 404, undefined]] as const) {
    const reply = await raw(port, text)
    assert.equal(reply.status, status, text); assert.equal(reply.headers.allow, allow, text); assert.equal(reply.body, '', text)
    moduleHeaders(reply, text)
  }
  assert.equal((await call(port, 'GET', '/healthz')).status, 200)
})

test('sin token, 401 en JSON sin salir a la red; al handler solo le llegan las cabeceras del módulo y la query', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 599 }) }
  try {
    const port = await start()
    for (const [method, body] of [['GET', undefined], ['POST', JSON.stringify({ id, title: 'Nota' })]] as const) {
      const reply = await call(port, method, '/api/notes', { company: '1', 'content-type': 'application/json' }, body)
      assert.equal(reply.status, 401, method); assert.equal(reply.headers['www-authenticate'], 'Bearer', method)
      assert.deepEqual(JSON.parse(reply.body), { error: 'unauthorized', message: 'Hace falta un token de módulo de Pimia válido.' })
      moduleHeaders(reply, method)
    }
    assert.equal(calls, 0, 'sin token no se llama a Pimia')
  } finally { globalThis.fetch = original }
  const port = await start({ ...moduleHandlers, notes: {
    GET: async (request, params) => Response.json({ url: request.url, method: request.method, params, headers: Object.fromEntries(request.headers) }),
    POST: async request => Response.json({ size: (await request.arrayBuffer()).byteLength }, { status: 201, headers: { 'WWW-Authenticate': 'Bearer', 'X-Powered-By': 'nadie', 'Content-Length': '999', 'Cache-Control': 'public' } }),
  } })
  const sent = { authorization: 'Bearer tok', company: '1', 'x-pimia-tenant': 'demo', 'content-type': 'application/json', cookie: 'sesion=x', 'x-forwarded-host': 'evil.example',
    'x-forwarded-for': '10.0.0.1', 'x-forwarded-proto': 'http', origin: 'https://evil.example', referer: 'https://evil.example/', 'user-agent': 'prueba', 'x-middleware-subrequest': 'x', accept: 'text/html' }
  const echo = await call(port, 'GET', '/api/notes?page=2&search=luna', sent)
  assert.equal(echo.status, 200)
  assert.deepEqual(JSON.parse(echo.body), { url: 'http://modulo.invalid/api/notes?page=2&search=luna', method: 'GET', params: {},
    headers: { authorization: 'Bearer tok', company: '1', 'content-type': 'application/json', 'x-pimia-tenant': 'demo' } })
  // Las cabeceras del handler pasan (WWW-Authenticate); las del módulo mandan, y ni tamaño ni X-Powered-By se copian.
  const created = await call(port, 'POST', '/api/notes', { 'content-type': 'application/json' }, '{"a":1}')
  assert.equal(created.status, 201); assert.deepEqual(JSON.parse(created.body), { size: 7 }); assert.equal(created.headers['www-authenticate'], 'Bearer')
  moduleHeaders(created, 'POST')
})

test('más de 64 KiB por trozos, sin content-length: 413 en JSON y la conexión se cierra; justo en el tope pasa', async () => {
  // El tope documentado, escrito aquí y no sacado de la constante: subirlo tiene que romper la prueba.
  const LIMIT = 64 * 1024
  assert.equal(MAX_BODY_BYTES, LIMIT)
  const port = await start({ ...moduleHandlers, notes: { ...moduleHandlers.notes, POST: async request => Response.json({ size: (await request.arrayBuffer()).byteLength }) } })
  // Con content-length honrado también: se cuenta lo que llega.
  const declared = await call(port, 'PUT', `/api/notes/${id}`, { 'content-type': 'application/json', 'content-length': String(LIMIT + 1) }, Buffer.alloc(LIMIT + 1, 'a'))
  assert.equal(declared.status, 413); moduleHeaders(declared, 'PUT 413')
  const chunked = (size: number, end: boolean) => new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/notes', headers: { 'content-type': 'application/json' }, agent: false }, res => {
      let data = ''
      res.setEncoding('utf8').on('data', part => { data += part }).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }))
    })
    req.on('error', error => { if (!end) return; reject(error) })
    for (let sent = 0; sent < size; sent += 4096) req.write(Buffer.alloc(Math.min(4096, size - sent), 'a'))
    // Sin terminar el cuerpo: el servidor tiene que cortar al pasar el tope, sin esperar al final.
    if (end) req.end()
  })
  const atLimit = await chunked(LIMIT, true)
  assert.equal(atLimit.status, 200); assert.deepEqual(JSON.parse(atLimit.body), { size: LIMIT })
  const tooLarge = await chunked(LIMIT + 1, false)
  assert.equal(tooLarge.status, 413); assert.equal(tooLarge.headers['transfer-encoding'], undefined); assert.equal(tooLarge.headers.connection, 'close')
  assert.deepEqual(JSON.parse(tooLarge.body), { error: 'too_large', message: 'El cuerpo es demasiado grande.' })
  moduleHeaders(tooLarge, '413')
})

test('lo inesperado sale como 503 en JSON, sin detalles y con las cabeceras del módulo', async () => {
  const port = await start(moduleHandlers, { healthz: { GET: async () => { throw new Error('pg://usuario:secreto@base') } } })
  const reply = await call(port, 'GET', '/healthz')
  assert.equal(reply.status, 503); assert.deepEqual(JSON.parse(reply.body), { error: 'unavailable', message: 'El módulo no está disponible ahora mismo.' })
  assert.doesNotMatch(reply.body, /secreto|pg:/); moduleHeaders(reply, '503')
})

/**
 * Un Postgres que acepta la conexión (sin TLS ni contraseña) y después no contesta nada: un nodo congelado, una
 * conexión medio abierta o un proxy cuyo backend murió.
 */
async function frozenPostgres() {
  const stats = { opened: 0, closed: 0 }
  const sockets = new Set<net.Socket>()
  const int32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
  const message = (type: string, payload: Buffer) => Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload])
  const server = net.createServer(socket => {
    stats.opened++; sockets.add(socket)
    let pending = Buffer.alloc(0), ready = false
    socket.on('error', () => {}).on('close', () => { stats.closed++; sockets.delete(socket) }).on('data', data => {
      if (ready) return
      pending = Buffer.concat([pending, data])
      while (!ready && pending.length >= 8 && pending.length >= pending.readInt32BE(0)) {
        const code = pending.readInt32BE(4)
        pending = pending.subarray(pending.readInt32BE(0))
        // SSLRequest: sin TLS. StartupMessage: AuthenticationOk y ReadyForQuery; lo que venga después no se contesta.
        if (code === 80877103) { socket.write('N'); continue }
        socket.write(Buffer.concat([message('R', int32(0)), message('Z', Buffer.from('I'))]))
        ready = true
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, stats, close: () => { for (const socket of sockets) socket.destroy(); server.close() } }
}

test('si la base acepta la conexión y deja de contestar, la consulta se corta: 503 y las plazas vuelven al pool', { timeout: 20_000 }, async () => {
  const frozen = await frozenPostgres()
  const original = globalThis.fetch
  // Pimia dice que sí: token de módulo firmado por la instancia, para la empresa 1, y el plan lleva el módulo. Lo que no contesta es la base.
  const keys = moduleKeyPair(), now = Math.floor(Date.now() / 1000)
  const tok = signModuleToken(keys.privateKey, keys.kid, { iss: 'https://demo.pimia.test.invalid', sub: '7', name: 'Lucía', aud: 'dvi-base/dvi-base-notes', tenant: 'demo', company: '1', scope: 'notes:read', sid: 's1', jti: 'j1', iat: now, exp: now + 600 })
  globalThis.fetch = async input => Response.json(new URL(String(input)).pathname === '/.well-known/pimia-module-keys'
    ? keys.jwks : { data: { in_plan: true, revoked_sessions: [] } })
  await closeModulePool()
  configureStore('notes', { DATABASE_URL: `postgresql://fixture@127.0.0.1:${frozen.port}/notas` })
  try {
    const port = await start()
    const sent = { authorization: `Bearer ${tok}`, company: '1', 'x-pimia-tenant': 'demo' }
    // Tantas como plazas tiene el pool: sin un tope en el cliente se quedarían colgadas y el pool, agotado para siempre.
    const replies = await Promise.all(Array.from({ length: 5 }, () => call(port, 'GET', '/api/notes', sent)))
    for (const reply of replies) {
      assert.equal(reply.status, 503); assert.deepEqual(JSON.parse(reply.body), { error: 'unavailable', message: 'El módulo no está disponible ahora mismo.' })
      moduleHeaders(reply, 'base congelada')
    }
    // Las cinco llegaron a la base; sus conexiones se descartan y se cierran, y el pool queda vacío, no agotado.
    assert.equal(frozen.stats.opened, 5); assert.equal(modulePool().totalCount, 0)
    for (let i = 0; i < 50 && frozen.stats.closed < 5; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(frozen.stats.closed, 5)
  } finally {
    // Primero la base: si algo quedó colgado, al cortarla falla y el pool puede cerrarse.
    globalThis.fetch = original
    frozen.close()
    await closeModulePool()
  }
})

test('/readyz: 200 si el historial coincide con las migraciones del módulo; 503 con Retry-After si no, o si la base falla', async () => {
  const original = { connect: pg.Client.prototype.connect, query: pg.Client.prototype.query, end: pg.Client.prototype.end }
  const migrations = readMigrations(join(import.meta.dirname, 'example', 'migrations'))
  const commit = 'a'.repeat(40)
  const diagnostics = createDiagnostics({ key: 'dvi-base-notes', schema: 'notes', migrations, databaseUrl: () => 'postgresql://fixture@127.0.0.1:1/notas', commit })
  let history: { version: number; name: string; checksum: string }[] | null = migrations.map(({ version, name, checksum }) => ({ version, name, checksum }))
  const queries: string[] = []
  let closed = 0
  try {
    pg.Client.prototype.connect = (async () => {}) as typeof original.connect
    pg.Client.prototype.end = (async () => { closed++ }) as typeof original.end
    pg.Client.prototype.query = (async (sql: string) => {
      queries.push(sql)
      if (sql.startsWith('SELECT to_regclass')) return { rows: [{ table_ref: history ? 'notes.migrations' : null }] }
      if (sql.startsWith('SELECT version')) return { rows: history ?? [] }
      return { rows: [] }
    }) as unknown as typeof original.query
    const port = await start(moduleHandlers, diagnostics)
    const ready = await call(port, 'GET', '/readyz')
    assert.equal(ready.status, 200); assert.deepEqual(JSON.parse(ready.body), { status: 'ready' }); moduleHeaders(ready, '/readyz 200')
    assert.deepEqual(queries, ['BEGIN READ ONLY', 'SELECT to_regclass($1) AS table_ref', 'SELECT version, name, checksum FROM "notes".migrations ORDER BY version', 'COMMIT'])
    assert.equal(closed, 1)
    const version = await call(port, 'GET', '/api/version')
    assert.equal(version.status, 200); moduleHeaders(version, '/api/version')
    assert.deepEqual(JSON.parse(version.body), { module: 'dvi-base-notes', commit, migrations: [{ version: 1, name: 'notes' }] })
    // Un checksum distinto, una migración pendiente o sin historial: no está listo.
    for (const [label, value] of [['checksum distinto', [{ ...history![0], checksum: 'f'.repeat(64) }]], ['pendiente', []], ['sin historial', null]] as const) {
      history = value as unknown as typeof history
      const reply = await call(port, 'GET', '/readyz')
      assert.equal(reply.status, 503, label); assert.equal(reply.headers['retry-after'], '5', label); assert.deepEqual(JSON.parse(reply.body), { status: 'unavailable' }, label)
    }
    pg.Client.prototype.query = (async () => { throw new Error('private-sql-host-password') }) as unknown as typeof original.query
    const down = await call(port, 'GET', '/readyz')
    assert.equal(down.status, 503); assert.equal(down.headers['retry-after'], '5'); assert.deepEqual(JSON.parse(down.body), { status: 'unavailable' })
    moduleHeaders(down, '/readyz 503'); assert.doesNotMatch(down.body, /private/)
    const versionDown = await call(port, 'GET', '/api/version')
    assert.equal(versionDown.status, 503); assert.doesNotMatch(versionDown.body, /private/)
    assert.equal((await call(port, 'GET', '/healthz')).status, 200)
    // Sin diagnóstico configurado (un servidor sin base), /readyz no está listo.
    const bare = await start()
    assert.equal((await call(bare, 'GET', '/readyz')).status, 503)
  } finally {
    Object.assign(pg.Client.prototype, original)
  }
})
