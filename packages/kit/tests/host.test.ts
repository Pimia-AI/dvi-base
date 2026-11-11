/** El lado módulo del contrato embebido (`docs/contrato-embebido.md` §5 a §7), con ventanas de mentira: sin navegador. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectHost, originAllowed, readHostContext, HostError, type WindowLike } from '../src/host'

const HOST = 'https://demo.taskai.work'
const ALLOWED = ['https://{tenant}.taskai.work', 'http://127.0.0.1:7161']
const url = (params: Record<string, string>) => `http://127.0.0.1:7160/app/notes?${new URLSearchParams(params)}`
const CONTEXT = { pimia_protocol: '1', pimia_host: HOST, pimia_tenant: 'demo', pimia_company: '12', pimia_locale: 'es-ES', pimia_theme: 'light' }

/** Un iframe y su padre: lo que el módulo envía al padre queda anotado; `deliver` simula un mensaje del anfitrión. */
function frame(params: Record<string, string> = CONTEXT) {
  const sent: { message: { pimia: number; type: string; data?: unknown }; targetOrigin: string }[] = []
  const parent = { postMessage: (message: unknown, targetOrigin: string) => { sent.push({ message: message as never, targetOrigin }) } }
  const listeners = new Set<(event: { data: unknown; origin: string; source: unknown }) => void>()
  const win: WindowLike = {
    parent, location: { href: url(params) }, postMessage: () => {},
    addEventListener: (_type, listener) => { listeners.add(listener) },
    removeEventListener: (_type, listener) => { listeners.delete(listener) },
  }
  /** El id de la petición de sesión n-ésima (1 = la del ready), tal como la envió el módulo. */
  const requestId = (n: number) => (sent.filter(s => ['ready', 'request-session'].includes(s.message.type))[n - 1]?.message as { id?: string } | undefined)?.id ?? 'ninguna'
  // Una `session` sin id explícito responde a la última petición enviada; con `id: null`, va sin id.
  const deliver = (data: unknown, origin = HOST, source: unknown = parent) => {
    const message = data as { type?: string; id?: string | null } | null
    const filled = message?.type === 'session' && message.id === undefined ? { ...message, id: requestId(sent.filter(s => ['ready', 'request-session'].includes(s.message.type)).length) }
      : message?.type === 'session' && message.id === null ? (({ id: _id, ...rest }) => rest)(message) : data
    listeners.forEach(listener => listener({ data: filled, origin, source }))
  }
  return { win, sent, deliver, listeners, requestId }
}
/** La respuesta del anfitrión: a la petición `id`; sin `id`, a la última enviada (`frame().deliver`); con `null`, sin id. */
const session = (extra: Record<string, unknown> = {}, id?: string | null) => ({
  pimia: 1, type: 'session', ...(id === undefined ? {} : { id }),
  data: { token: 'tok-1', expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), tenant: 'demo', company: { id: 12, name: 'Empresa Doce' }, user: { id: 7, name: 'Lucía' }, locale: 'es-ES', theme: 'light', ...extra },
})

test('orígenes del anfitrión: exactos o con el patrón {tenant}, y nada más', () => {
  assert.equal(originAllowed('https://demo.taskai.work', ALLOWED), true)
  assert.equal(originAllowed('http://127.0.0.1:7161', ALLOWED), true)
  for (const bad of ['https://taskai.work', 'https://a.b.taskai.work', 'https://Demo.taskai.work', 'http://demo.taskai.work', 'https://demo.taskai.work.evil.example',
    'https://evil.example', 'https://demo.taskai.work/', 'https://demo.taskai.work:444', 'http://127.0.0.1:7162', 'null', '']) {
    assert.equal(originAllowed(bad, ALLOWED), false, bad)
  }
})

test('el contexto de la URL: protocolo 1, anfitrión permitido, instancia y empresa válidas', () => {
  assert.deepEqual(readHostContext(url(CONTEXT), ALLOWED), { hostOrigin: HOST, tenant: 'demo', companyId: '12', locale: 'es-ES', theme: 'light' })
  const expect = (params: Record<string, string>, code: string) => assert.throws(() => readHostContext(url(params), ALLOWED), (e: unknown) => e instanceof HostError && e.code === code, JSON.stringify(params))
  expect({ ...CONTEXT, pimia_protocol: '2' }, 'protocol')
  expect({ ...CONTEXT, pimia_host: 'https://evil.example' }, 'origin')
  expect({ ...CONTEXT, pimia_tenant: 'Demo' }, 'context')
  expect({ ...CONTEXT, pimia_company: '0' }, 'context')
})

test('abierta suelta (sin padre), no se conecta: standalone', () => {
  const { win } = frame()
  const alone = { ...win, parent: undefined as never }
  ;(alone as { parent: unknown }).parent = alone
  assert.throws(() => connectHost({ allowedOrigins: ALLOWED, window: alone }), (e: unknown) => e instanceof HostError && e.code === 'standalone')
})

test('al conectar dice «ready» al anfitrión, solo a su origen, y la sesión que llega es la de su instancia y empresa', async () => {
  const { win, sent, deliver, requestId } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win })
  assert.deepEqual(sent, [{ message: { pimia: 1, type: 'ready', id: requestId(1), data: { protocols: [1] } }, targetOrigin: HOST }])
  assert.match(requestId(1), /^[A-Za-z0-9_-]{16}\.1$/, 'conexión aleatoria + secuencia')
  const pending = host.getSession()
  // Lo que no viene del padre, o no viene de su origen, o no es del protocolo, se ignora.
  deliver(session({ token: 'de-otro-origen' }), 'https://evil.example')
  deliver(session({ token: 'de-otra-ventana' }), HOST, {})
  deliver({ ...session({ token: 'otra-version' }), pimia: 2 })
  deliver(session())
  const got = await pending
  assert.equal(got.token, 'tok-1'); assert.equal(got.tenant, 'demo'); assert.deepEqual(got.company, { id: '12', name: 'Empresa Doce' }); assert.deepEqual(got.user, { id: '7', name: 'Lucía' })
  assert.ok(sent.every(entry => entry.targetOrigin === HOST), 'nunca a *')
  // Vigente: no se vuelve a pedir.
  assert.equal((await host.getSession()).token, 'tok-1'); assert.equal(sent.length, 1)
  host.close()
})

test('una sesión de otra empresa u otra instancia, o sin token, se rechaza', async () => {
  for (const [extra, code] of [[{ company: { id: 13, name: 'Otra' } }, 'context'], [{ tenant: 'otra' }, 'context'], [{ token: '' }, 'session'], [{ expires_at: 'mañana' }, 'session']] as const) {
    const { win, deliver } = frame()
    const host = connectHost({ allowedOrigins: ALLOWED, window: win })
    const pending = host.getSession()
    deliver(session(extra))
    await assert.rejects(pending, (e: unknown) => e instanceof HostError && e.code === code, JSON.stringify(extra))
    host.close()
  }
})

test('a punto de caducar o tras un 401 se pide otra; dos peticiones a la vez comparten respuesta', async () => {
  let now = Date.now()
  const { win, sent, deliver } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win, now: () => now })
  const first = host.getSession(); deliver(session({ expires_at: new Date(now + 60_000).toISOString() })); await first
  now += 45_000 // quedan 15 s: menos del margen de 30 s
  const a = host.getSession(), b = host.requestSession()
  assert.deepEqual(sent.map(s => s.message.type), ['ready', 'request-session'])
  deliver(session({ token: 'tok-2', expires_at: new Date(now + 600_000).toISOString() }))
  assert.equal((await a).token, 'tok-2'); assert.equal((await b).token, 'tok-2')
  host.close()
})

test('si el anfitrión no contesta, se rinde a tiempo; cerrada, no espera', async () => {
  const { win } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win, timeoutMs: 20 })
  await assert.rejects(host.getSession(), (e: unknown) => e instanceof HostError && e.code === 'timeout')
  host.close()
  await assert.rejects(host.requestSession(), (e: unknown) => e instanceof HostError && e.code === 'closed')
})

test('lo que el módulo cuenta al anfitrión y lo que el anfitrión le cuenta al módulo', async () => {
  const { win, sent, deliver, listeners } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win })
  host.setTitle('Notas', [{ text: 'Ejemplo' }])
  host.navigate('/app/notes/abc')
  host.navigate('https://evil.example/') // fuera de /app/: no se envía
  host.open('/clientes/15')
  host.notify('success', 'Nota guardada')
  host.reportError('not_in_plan', 403)
  assert.deepEqual(sent.slice(1).map(s => s.message), [
    { pimia: 1, type: 'title', data: { title: 'Notas', breadcrumbs: [{ text: 'Ejemplo' }] } },
    { pimia: 1, type: 'navigate', data: { path: '/app/notes/abc', replace: false } },
    { pimia: 1, type: 'open', data: { target: 'pimia', path: '/clientes/15' } },
    { pimia: 1, type: 'notice', data: { kind: 'success', text: 'Nota guardada' } },
    { pimia: 1, type: 'error', data: { code: 'not_in_plan', status: 403 } },
  ])
  const seen: unknown[] = []
  host.on('go', path => seen.push(['go', path]))
  host.on('theme', theme => seen.push(['theme', theme]))
  host.on('context-changed', value => seen.push(['context', value]))
  deliver({ pimia: 1, type: 'go', data: { path: '/app/notes' } })
  deliver({ pimia: 1, type: 'go', data: { path: 'javascript:alert(1)' } })
  deliver({ pimia: 1, type: 'theme', data: { theme: 'dark' } })
  deliver({ pimia: 1, type: 'context-changed', data: { tenant: 'demo', company: 13 } })
  assert.deepEqual(seen, [['go', '/app/notes'], ['theme', 'dark'], ['context', { tenant: 'demo', companyId: '13' }]])
  host.close()
  assert.equal(listeners.size, 0, 'cerrar quita el escuchador')
})

test('regresión (revisión): cerrada, no devuelve la sesión que tenía ni pide otra', async () => {
  const { win, sent, deliver } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win })
  const first = host.getSession(); deliver(session()); assert.equal((await first).token, 'tok-1')
  host.close()
  await assert.rejects(host.getSession(), (e: unknown) => e instanceof HostError && e.code === 'closed')
  await assert.rejects(host.requestSession(), (e: unknown) => e instanceof HostError && e.code === 'closed')
  deliver(session({ token: 'tras-cerrar' }))
  await assert.rejects(host.getSession(), (e: unknown) => e instanceof HostError && e.code === 'closed')
  assert.equal(sent.length, 1, 'solo el ready inicial')
})

test('regresión (revisión): solo se acepta la sesión con el id exacto de la petición en curso', async () => {
  const { win, deliver, requestId } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win })
  const pending = host.getSession()
  deliver(session({ token: 'sin-id' }, null))
  deliver(session({ token: 'otro-id' }, 's9'))
  deliver(session({ token: 'buena' }, requestId(1)))
  assert.equal((await pending).token, 'buena')
  // Sin petición en curso, una sesión que llega sola (con o sin id) tampoco cambia la vigente.
  deliver(session({ token: 'no-pedida' }, null)); deliver(session({ token: 'no-pedida' }, requestId(1)))
  assert.equal((await host.getSession()).token, 'buena')
  host.close()
})

test('regresión (revisión, 2.ª pasada): tras cambiar de empresa, la conexión queda retirada; una respuesta tardía SIN id no da el token antiguo', async () => {
  const { win, sent, deliver, requestId } = frame()
  const host = connectHost({ allowedOrigins: ALLOWED, window: win })
  const before = host.getSession()
  deliver({ pimia: 1, type: 'context-changed', data: { tenant: 'demo', company: 2 } })
  await assert.rejects(before, (e: unknown) => e instanceof HostError && e.code === 'context')
  // Nueva petición: rechaza sin preguntar; la conexión de la empresa anterior no sirve hasta recrearla.
  await assert.rejects(host.requestSession(), (e: unknown) => e instanceof HostError && e.code === 'context')
  // Llega tarde la respuesta del ready, sin id y con el token de la empresa 1 (la de la URL): no se acepta.
  deliver(session({ token: 'token-empresa-1' }, null))
  deliver(session({ token: 'token-empresa-1' }, requestId(1)))
  await assert.rejects(host.getSession(), (e: unknown) => e instanceof HostError && e.code === 'context')
  assert.deepEqual(sent.map(s => s.message.type), ['ready'], 'no vuelve a pedir')
  host.close()
})

test('regresión (revisión, 3.ª pasada): al reconectar en la misma ventana, una respuesta tardía a la conexión anterior no vale', async () => {
  const { win, sent, deliver, requestId } = frame()
  const first = connectHost({ allowedOrigins: ALLOWED, window: win })
  const old = requestId(1)
  first.close() // la pantalla se desmonta y vuelve a montarse (react.tsx) en la misma ventana
  const second = connectHost({ allowedOrigins: ALLOWED, window: win })
  const fresh = requestId(2)
  assert.notEqual(old, fresh)
  assert.notEqual(old.split('.')[0], fresh.split('.')[0], 'cada conexión, su identificador')
  const pending = second.getSession()
  deliver(session({ token: 'de-la-conexion-anterior' }, old))
  deliver(session({ token: 'de-esta-conexion' }, fresh))
  assert.equal((await pending).token, 'de-esta-conexion')
  assert.deepEqual(sent.map(s => s.message.type), ['ready', 'ready'])
  second.close()
})
