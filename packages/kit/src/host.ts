/**
 * El lado módulo del contrato embebido (`docs/contrato-embebido.md` §5 a §7): la pantalla del módulo vive en un iframe
 * del panel de Pimia ERP y habla con él por `postMessage`. No tiene login: el anfitrión le da un token y el contexto
 * (instancia, empresa, persona), y el backend del módulo lo confirma contra Pimia en cada petición.
 *
 * Reglas que esta pieza hace cumplir:
 * - Solo se conecta dentro de un iframe; abierta suelta, `standalone` (la pantalla dice «Abre este módulo desde Pimia»).
 * - El origen del anfitrión llega en la URL (`pimia_host`) y tiene que estar en la lista del módulo (`allowedOrigins`,
 *   orígenes exactos o patrones `https://{tenant}.dominio`). Los mensajes solo se envían a ese origen, nunca a `*`, y
 *   solo se aceptan de `window.parent` con ese origen y `pimia: 1`.
 * - La sesión tiene que ser de la instancia y la empresa de la URL; si no, se rechaza.
 * - El token vive solo en memoria: ni `localStorage`, ni cookies.
 */
export const PROTOCOL = 1

export interface HostSession {
  token: string
  /** Caducidad del token, en milisegundos desde epoch. */
  expiresAt: number
  tenant: string
  company: { id: string; name: string }
  user: { id: string; name: string }
  locale: string
  theme: 'light' | 'dark'
}
export interface HostContext { hostOrigin: string; tenant: string; companyId: string; locale: string; theme: 'light' | 'dark' }
export type HostErrorCode = 'standalone' | 'protocol' | 'origin' | 'context' | 'session' | 'timeout' | 'closed'
export class HostError extends Error {
  constructor(readonly code: HostErrorCode, message: string) { super(message) }
}

/** Lo que se usa de `window`: así se prueba sin navegador. */
export interface MessageSource { postMessage(message: unknown, targetOrigin: string): void }
export interface WindowLike extends MessageSource {
  parent: MessageSource
  location: { href: string }
  addEventListener(type: 'message', listener: (event: { data: unknown; origin: string; source: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown; origin: string; source: unknown }) => void): void
}
export interface HostOptions {
  allowedOrigins: readonly string[]
  window?: WindowLike
  /** Cuánto se espera una sesión del anfitrión. */
  timeoutMs?: number
  now?: () => number
}
type HostEvent = { go: string; 'context-changed': { tenant: string; companyId: string }; theme: 'light' | 'dark' }
export interface HostConnection {
  readonly context: HostContext
  /** La sesión vigente, o una nueva si falta o caduca en menos de 30 s. */
  getSession(): Promise<HostSession>
  /** Pide una sesión nueva (p. ej. tras un 401). Dos peticiones a la vez comparten respuesta. */
  requestSession(): Promise<HostSession>
  setTitle(title: string, breadcrumbs?: { text: string; path?: string }[]): void
  navigate(path: string, replace?: boolean): void
  open(path: string): void
  notify(kind: 'success' | 'error' | 'info', text: string): void
  reportError(code: string, status: number): void
  on<K extends keyof HostEvent>(type: K, listener: (value: HostEvent[K]) => void): () => void
  close(): void
}

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const COMPANY = /^[1-9][0-9]{0,18}$/
const SKEW_MS = 30_000

/** ¿Está `origin` en la lista? Orígenes exactos (`http://127.0.0.1:7161`) o patrones `https://{tenant}.dominio`. */
export function originAllowed(origin: string, allowed: readonly string[]): boolean {
  let url: URL
  try { url = new URL(origin) } catch { return false }
  if (url.origin !== origin) return false
  return allowed.some(entry => {
    if (!entry.includes('{tenant}')) return entry === origin
    if (!entry.startsWith('https://{tenant}.')) return false
    const suffix = entry.slice('https://{tenant}'.length)
    if (!origin.startsWith('https://') || !origin.endsWith(suffix)) return false
    return SLUG.test(origin.slice('https://'.length, origin.length - suffix.length))
  })
}

/** El contexto que el anfitrión pone en la URL del iframe. Lo que no cuadra, error: nunca un valor por defecto inventado. */
export function readHostContext(href: string, allowedOrigins: readonly string[]): HostContext {
  const params = new URL(href).searchParams
  if (params.get('pimia_protocol') !== String(PROTOCOL)) throw new HostError('protocol', 'El anfitrión no habla la versión 1 del protocolo.')
  const hostOrigin = params.get('pimia_host') ?? ''
  if (!originAllowed(hostOrigin, allowedOrigins)) throw new HostError('origin', 'El anfitrión no está entre los orígenes permitidos.')
  const tenant = params.get('pimia_tenant') ?? '', companyId = params.get('pimia_company') ?? ''
  if (!SLUG.test(tenant) || !COMPANY.test(companyId)) throw new HostError('context', 'Faltan la instancia o la empresa, o no son válidas.')
  const theme = params.get('pimia_theme') === 'dark' ? 'dark' : 'light'
  return { hostOrigin, tenant, companyId, locale: params.get('pimia_locale') || 'es-ES', theme }
}

function readSession(data: unknown, context: HostContext): HostSession {
  const value = data as Record<string, unknown> | null
  const company = value?.company as Record<string, unknown> | undefined, user = value?.user as Record<string, unknown> | undefined
  const expiresAt = typeof value?.expires_at === 'string' ? Date.parse(value.expires_at) : NaN
  if (!value || typeof value.token !== 'string' || !value.token || !Number.isFinite(expiresAt) || !company || !user) throw new HostError('session', 'La sesión del anfitrión no tiene la forma del contrato.')
  if (value.tenant !== context.tenant || String(company.id) !== context.companyId) throw new HostError('context', 'La sesión es de otra instancia o de otra empresa.')
  return {
    token: value.token, expiresAt, tenant: context.tenant,
    company: { id: context.companyId, name: typeof company.name === 'string' ? company.name : '' },
    user: { id: String(user.id ?? ''), name: typeof user.name === 'string' ? user.name : '' },
    locale: typeof value.locale === 'string' ? value.locale : context.locale,
    theme: value.theme === 'dark' ? 'dark' : 'light',
  }
}

/** 96 bits aleatorios en base64url (Web Crypto: navegador y Node). */
function connectionId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function connectHost(options: HostOptions): HostConnection {
  const win = options.window ?? (globalThis as unknown as { window: WindowLike }).window
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!win || win.parent === (win as unknown)) throw new HostError('standalone', 'La pantalla se ha abierto fuera del panel de Pimia.')
  const context = readHostContext(win.location.href, options.allowedOrigins)
  const post = (type: string, data?: unknown, id?: string) => win.parent.postMessage({ pimia: PROTOCOL, type, ...(id === undefined ? {} : { id }), ...(data === undefined ? {} : { data }) }, context.hostOrigin)
  const listeners: { [K in keyof HostEvent]: Set<(value: HostEvent[K]) => void> } = { go: new Set(), 'context-changed': new Set(), theme: new Set() }
  let session: HostSession | null = null
  /**
   * La petición de sesión en curso. Lleva un `id` que el anfitrión devuelve en `session` (contrato §6): solo se acepta
   * la `session` con el `id` exacto de la petición en curso. Sin `id`, o con otro, es de una petición anterior o no
   * pedida, y se ignora.
   *
   * `context-changed` retira la conexión: su contexto (instancia y empresa de la URL) ya no es el del anfitrión, y todo
   * lo que se le pida rechaza con `context` hasta que el anfitrión recargue la pantalla con la URL nueva.
   */
  let waiting: { id: string; promise: Promise<HostSession>; resolve(s: HostSession): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> } | null = null
  let closed = false, retired = false, sequence = 0
  // Un identificador aleatorio por conexión: si la pantalla se reconecta en la misma ventana, una respuesta tardía a
  // la conexión anterior no casa con ninguna petición de esta (los ids son `<conexión>.<secuencia>`).
  const connection = connectionId()
  /** El `id` de la petición en curso (función: el compilador no ve que `wait()` lo cambia). */
  const pendingId = (): string | undefined => waiting?.id
  const closedError = () => new HostError('closed', 'La conexión con el anfitrión está cerrada.')
  const retiredError = () => new HostError('context', 'Ha cambiado la empresa activa: hace falta recargar la pantalla.')
  const unusable = (): HostError | null => (closed ? closedError() : retired ? retiredError() : null)

  const wait = (): Promise<HostSession> => {
    const dead = unusable()
    if (dead) return Promise.reject(dead)
    if (waiting) return waiting.promise
    let resolve!: (s: HostSession) => void, reject!: (e: Error) => void
    const promise = new Promise<HostSession>((ok, ko) => { resolve = ok; reject = ko })
    const timer = setTimeout(() => settle(new HostError('timeout', 'El anfitrión no ha dado sesión a tiempo.')), timeoutMs)
    waiting = { id: `${connection}.${++sequence}`, promise, resolve, reject, timer }
    return promise
  }
  const settle = (result: HostSession | Error) => {
    const current = waiting
    if (!current) return
    waiting = null
    clearTimeout(current.timer)
    if (result instanceof Error) current.reject(result)
    else current.resolve(result)
  }

  const onMessage = (event: { data: unknown; origin: string; source: unknown }) => {
    if (event.source !== win.parent || event.origin !== context.hostOrigin) return
    const message = event.data as { pimia?: unknown; type?: unknown; data?: unknown } | null
    if (!message || message.pimia !== PROTOCOL) return
    if (message.type === 'session') {
      // Sin petición en curso, sin `id` o con otro: tardía o no pedida. No toca nada.
      if (!waiting || (message as { id?: unknown }).id !== waiting.id) return
      try { session = readSession(message.data, context); settle(session) }
      catch (error) { session = null; settle(error as Error) }
    } else if (message.type === 'go') {
      const path = (message.data as { path?: unknown } | undefined)?.path
      if (typeof path === 'string' && path.startsWith('/app/')) listeners.go.forEach(listener => listener(path))
    } else if (message.type === 'context-changed') {
      // Lo que se tenía y lo que se esperaba era de la empresa anterior: la conexión queda retirada.
      session = null
      retired = true
      settle(retiredError())
      const data = message.data as { tenant?: unknown; company?: unknown } | undefined
      listeners['context-changed'].forEach(listener => listener({ tenant: String(data?.tenant ?? ''), companyId: String(data?.company ?? '') }))
    } else if (message.type === 'theme') {
      const theme = (message.data as { theme?: unknown } | undefined)?.theme === 'dark' ? 'dark' : 'light'
      listeners.theme.forEach(listener => listener(theme))
    }
  }
  win.addEventListener('message', onMessage)
  // El primer mensaje: el anfitrión contesta con la sesión.
  const first = wait()
  first.catch(() => {})
  post('ready', { protocols: [PROTOCOL] }, pendingId())

  const requestSession = () => {
    const pending = waiting?.promise
    if (pending) return pending
    const promise = wait()
    const id = pendingId()
    if (id) post('request-session', undefined, id)
    return promise
  }

  return {
    context,
    getSession: () => (unusable() ? Promise.reject(unusable()!) : session && session.expiresAt - now() > SKEW_MS ? Promise.resolve(session) : waiting ? waiting.promise : requestSession()),
    requestSession,
    setTitle: (title, breadcrumbs = []) => post('title', { title, breadcrumbs }),
    navigate: (path, replace = false) => { if (path.startsWith('/app/')) post('navigate', { path, replace }) },
    open: path => { if (path.startsWith('/')) post('open', { target: 'pimia', path }) },
    notify: (kind, text) => post('notice', { kind, text }),
    reportError: (code, status) => post('error', { code, status }),
    on: (type, listener) => { listeners[type].add(listener as never); return () => listeners[type].delete(listener as never) },
    close: () => {
      closed = true
      session = null
      win.removeEventListener('message', onMessage)
      settle(closedError())
    },
  }
}
