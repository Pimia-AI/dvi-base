import { createServer, STATUS_CODES, type IncomingMessage, type Server, type ServerOptions, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { MODULE_HEADERS, createRouteTable, type Method, type RouteDef, type RouteParams, type RouteTable } from './routes'
import { json, jsonError } from './http'
import { NO_DIAGNOSTICS } from './diagnostics'
import type { Ui } from './ui'
/**
 * El servidor HTTP de un módulo: Node, sin Next. Extraído de una vertical anterior en producción; la tabla y los
 * handlers ya no son los de la clínica: los pone el dominio, y la base añade los suyos.
 *
 * Resuelve la ruta en la tabla cerrada; solo en POST y PUT lee el cuerpo, con un tope contado sobre el stream; pasa al
 * handler un `Request` estándar con las cabeceras que usa el módulo y ninguna más, y escribe la respuesta con las
 * cabeceras del módulo y `content-length`. Lo inesperado sale como 503 sin detalles. Lo que Node contestaría o
 * cortaría por su cuenta (falta de `Host`, un `Expect` que no es `100-continue`, CONNECT, lo que no llega a entender)
 * también sale con las cabeceras del módulo.
 */
export type Handler = (request: Request, params: RouteParams) => Promise<Response>
type MethodHandlers<R extends RouteDef> = { [M in R['methods'][number]]: Handler }
/** Un handler por cada ruta y método de la tabla, ni más ni menos: lo comprueba el tipo y, al arrancar, el servidor. */
export type HandlersFor<R extends readonly RouteDef[]> = { [K in R[number] as K['name']]: MethodHandlers<K> }
export interface ModuleDefinition<R extends readonly RouteDef[] = readonly RouteDef[]> { routes: R; handlers: HandlersFor<R> }
/** Los handlers de las rutas de la base. El arranque pone `/readyz` y `/api/version` con su base; las pruebas pueden sustituirlos. */
export interface BaseHandlers { healthz: { GET: Handler }; readyz: { GET: Handler }; version: { GET: Handler }; session: { GET: Handler } }

export const MAX_BODY_BYTES = 64 * 1024
/** Lo único que el módulo lee de la petición: ni cookies, ni `host`, ni `x-forwarded-*`. */
const FORWARDED_HEADERS = ['authorization', 'company', 'x-pimia-tenant', 'content-type'] as const
/** Del handler no se copian el tamaño ni la conexión (los pone este servidor), ni nunca `X-Powered-By`. */
const DROPPED_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'x-powered-by'])
const EMPTY = Buffer.alloc(0)

/** `/healthz` solo dice que el proceso responde. */
export const healthz: Handler = async () => json({ status: 'ok' })

type AnyHandlers = Record<string, Partial<Record<Method, Handler>>>

export function createModuleServer<const R extends readonly RouteDef[]>(definition: ModuleDefinition<R>, options: { baseHandlers?: Partial<BaseHandlers>; ui?: Ui } = {}): Server {
  const table = createRouteTable(definition.routes)
  const handlers: AnyHandlers = { healthz: { GET: healthz }, ...NO_DIAGNOSTICS, ...options.baseHandlers, ...(definition.handlers as AnyHandlers) }
  checkHandlers(table, handlers)
  // Sin el 400 desnudo de Node cuando falta `Host`: lo contesta `serve`.
  const serverOptions: ServerOptions & { requireHostHeader: boolean } = { requireHostHeader: false }
  const server = createServer(serverOptions, (req, res) => { void serve(req, res, table, handlers, options.ui) })
  // Tiempos acotados: las cabeceras, la petición entera y la espera entre peticiones de una misma conexión.
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  // Un `Expect` que no es `100-continue`: 417 y se cierra, como Node, pero con las cabeceras del módulo.
  server.on('checkExpectation', (req, res) => write(res, missingHost(req) ? 400 : 417, { Connection: 'close' }))
  server.on('clientError', rejectMalformed)
  // CONNECT no llega nunca a 'request', y sin este escuchador Node cortaría la conexión sin responder.
  server.on('connect', (req: IncomingMessage, socket: Duplex) => rejectConnect(req, socket, table))
  return server
}

/** Cada ruta con un handler por método, y ningún handler sin ruta. Si no, el módulo no arranca. */
function checkHandlers(table: RouteTable, handlers: AnyHandlers) {
  const names = new Set(table.routes.map(route => route.name))
  for (const name of Object.keys(handlers)) if (!names.has(name)) throw new Error(`Handler sin ruta: ${name}`)
  for (const route of table.routes) {
    const methods = handlers[route.name] ?? {}
    const declared = Object.keys(methods).sort().join(',')
    if (declared !== [...route.methods].sort().join(',') || route.methods.some(m => typeof methods[m] !== 'function')) {
      throw new Error(`La ruta ${route.name} necesita exactamente un handler por método (${route.methods.join(', ')})`)
    }
  }
}

/** HTTP/1.1 sin `Host`: 400 (RFC 9112, §3.2), lo mismo que haría Node. */
function missingHost(req: IncomingMessage): boolean {
  return req.httpVersionMajor === 1 && req.httpVersionMinor === 1 && req.headers.host === undefined
}

async function serve(req: IncomingMessage, res: ServerResponse, table: RouteTable, handlers: AnyHandlers, ui?: Ui) {
  try {
    if (missingHost(req)) return write(res, 400, { Connection: 'close' })
    // Las pantallas (`/app/*`): su propia superficie cerrada y sus propias cabeceras (`ui.ts`).
    const target = req.url ?? ''
    const screen = ui?.serve(req.method ?? '', target.split('?')[0])
    if (screen?.status === 200) return write(res, 200, screen.headers, screen.body, {})
    if (screen?.status === 405) return write(res, 405, { Allow: screen.allow })
    if (screen?.status === 404) return write(res, 404)
    const route = table.resolve(req.method ?? '', target)
    if (route.status === 404) return write(res, 404)
    if (route.status === 405) return write(res, 405, { Allow: route.allow })
    let body: Buffer | undefined
    if (route.method === 'POST' || route.method === 'PUT') {
      const read = await readBody(req, MAX_BODY_BYTES)
      // Se corta aquí: la conexión se cierra al responder y lo que quede del cuerpo no se llega a guardar.
      if (!read) return await respond(res, jsonError(413, 'too_large', 'El cuerpo es demasiado grande.'), { Connection: 'close' })
      body = read
    }
    const headers = new Headers()
    for (const name of FORWARDED_HEADERS) {
      const value = req.headers[name]
      if (typeof value === 'string') headers.set(name, value)
    }
    const request = new Request(`http://modulo.invalid${route.path}${route.search}`, { method: route.method, headers, body })
    const handler = handlers[route.route]?.[route.method]
    if (!handler) throw new Error('Ruta sin handler')
    await respond(res, await handler(request, route.params))
  } catch {
    if (res.headersSent) { res.destroy(); return }
    await respond(res, jsonError(503, 'unavailable', 'El módulo no está disponible ahora mismo.')).catch(() => res.destroy())
  }
}

/** El cuerpo, contado sobre el stream (`content-length` puede faltar o mentir). Pasado el tope, `null` y se deja de guardar. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const settle = (finish: () => void) => {
      req.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose)
      finish()
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) settle(() => resolve(null))
      else chunks.push(chunk)
    }
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks)))
    const onError = (error: Error) => settle(() => reject(error))
    const onClose = () => settle(() => reject(new Error('Petición cortada')))
    req.on('data', onData).once('end', onEnd).once('error', onError).once('close', onClose)
  })
}

async function respond(res: ServerResponse, response: Response, extra: Record<string, string> = {}) {
  const body = Buffer.from(await response.arrayBuffer())
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => { if (!DROPPED_HEADERS.has(name)) headers[name] = value })
  write(res, response.status, { ...headers, ...extra }, body)
}

/** Estado, cabeceras del handler (p. ej. `WWW-Authenticate`), las del módulo por encima y el cuerpo con su tamaño. */
function write(res: ServerResponse, status: number, headers: Record<string, string> = {}, body: Buffer = EMPTY, base: Readonly<Record<string, string>> = MODULE_HEADERS) {
  if (res.headersSent || res.destroyed) return
  res.statusCode = status
  for (const [name, value] of Object.entries({ ...headers, ...base })) res.setHeader(name, value)
  res.setHeader('Content-Length', body.length)
  res.end(body)
}

/**
 * Lo que Node no llega a entender (petición mal formada, cabeceras de más, tiempo agotado) también sale con las
 * cabeceras del módulo. Como Node: si ya hay una respuesta a medias en esa conexión, solo se corta.
 */
function rejectMalformed(error: Error, socket: Duplex) {
  const code = (error as NodeJS.ErrnoException).code
  const pending = (socket as Duplex & { _httpMessage?: ServerResponse })._httpMessage
  if (code === 'ECONNRESET' || !socket.writable || pending?.headersSent) { socket.destroy(); return }
  rawReply(socket, code === 'HPE_HEADER_OVERFLOW' ? 431 : code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : 400)
}

/**
 * CONNECT: nunca un túnel. Ninguna ruta lo admite, así que es lo que diga la tabla: 405 con `Allow` en una ruta
 * conocida y 404 en lo demás (también la forma `host:puerto`). Lo que venga detrás en la conexión no se procesa.
 */
function rejectConnect(req: IncomingMessage, socket: Duplex, table: RouteTable) {
  // Node ya le ha quitado al socket su escuchador de errores.
  socket.on('error', () => {})
  if (missingHost(req)) return rawReply(socket, 400)
  const route = table.resolve(req.method ?? '', req.url ?? '')
  if (route.status === 405) rawReply(socket, 405, { Allow: route.allow })
  else rawReply(socket, 404)
}

/** Una respuesta escrita directamente en el socket: sin cuerpo, con las cabeceras del módulo, y se cierra la conexión. */
function rawReply(socket: Duplex, status: number, headers: Record<string, string> = {}) {
  const lines = Object.entries({ ...headers, ...MODULE_HEADERS }).map(([name, value]) => `${name}: ${value}\r\n`).join('')
  socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n${lines}Content-Length: 0\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}
