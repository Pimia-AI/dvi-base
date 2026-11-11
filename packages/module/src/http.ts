import { ModuleAuthError, type ModuleSession } from './session'
/**
 * La API JSON del módulo: respuestas `{data}`; errores `{error, message}` con el código en `error`, que es lo que el
 * SDK de Pimia compara. Extraído de una vertical anterior en producción, con un `Conflict` genérico en lugar del de
 * pacientes.
 */
export class ModuleHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly errors?: Record<string, string>) { super(message) }
}
/** Una escritura que no puede aplicarse sobre la versión que la persona vio, o un alta repetida con otros datos: 409. */
export class Conflict extends Error {
  constructor(message = 'El registro cambió desde que se cargó. Vuelve a abrirlo.') { super(message) }
}

const NO_STORE = { 'Cache-Control': 'no-store' }
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } })
export const jsonError = (status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ error, message, ...extra }, status, headers)

const MESSAGES: Record<string, string> = {
  unauthorized: 'Hace falta un token de módulo de Pimia válido.',
  wrong_audience: 'El token es de otro módulo.',
  token_expired: 'El token ha caducado.',
  token_revoked: 'La sesión del módulo se ha cerrado.',
  forbidden: 'El token es de otra empresa.',
  company_required: 'Falta la empresa (cabecera `company`).',
  tenant_required: 'Falta la instancia (cabecera `x-pimia-tenant`) o no es un nombre válido.',
  tenant_mismatch: 'Este módulo sirve a otra instancia.',
  not_in_plan: 'El plan de esta instancia no incluye este módulo.',
  insufficient_scope: 'La persona no tiene permiso para esto en el módulo.',
  pimia_unavailable: 'No se pudo comprobar la sesión con Pimia.',
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new ModuleHttpError(413, 'too_large', 'El cuerpo es demasiado grande.')
  let body: unknown
  try { body = await request.json() } catch { throw new ModuleHttpError(400, 'invalid_json', 'El cuerpo no es JSON.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ModuleHttpError(400, 'invalid_json', 'El cuerpo debe ser un objeto.')
  return body as Record<string, unknown>
}
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export interface ModuleDeps {
  session(headers: Headers): Promise<ModuleSession>
  /** Los permisos que declara `module.json`: una ruta no puede exigir uno que no esté aquí. */
  scopes?: readonly string[]
}
export interface RouteRequirements {
  /** El permiso del módulo que tiene que traer el token (`notes:write`). */
  scope?: string
}

/** Comprueba la sesión (y el permiso de la ruta) y traduce cualquier fallo a una respuesta JSON sin interioridades. */
export async function withModule(request: Request, deps: ModuleDeps, handler: (session: ModuleSession) => Promise<Response>, requirements: RouteRequirements = {}): Promise<Response> {
  // Un permiso sin declarar es un error de programación del módulo, no de quien llama: 503 y se ve en las pruebas.
  if (requirements.scope && !deps.scopes?.includes(requirements.scope)) return jsonError(503, 'unavailable', 'El módulo no está disponible ahora mismo.')
  let session: ModuleSession
  try {
    session = await deps.session(request.headers)
    if (requirements.scope && !session.scopes.includes(requirements.scope)) throw new ModuleAuthError(403, 'insufficient_scope')
  } catch (error) {
    if (error instanceof ModuleAuthError) {
      const challenge: Record<string, string> = error.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : error.code === 'insufficient_scope' ? { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${requirements.scope}"` } : {}
      return jsonError(error.status, error.code, MESSAGES[error.code], {}, challenge)
    }
    return jsonError(503, 'pimia_unavailable', MESSAGES.pimia_unavailable)
  }
  try { return await handler(session) }
  catch (error) {
    if (error instanceof ModuleHttpError) return jsonError(error.status, error.code, error.message, error.errors ? { errors: error.errors } : {})
    if (error instanceof Conflict) return jsonError(409, 'conflict', error.message)
    if (error instanceof RangeError) return jsonError(400, 'invalid', 'Parámetros fuera de rango.')
    return jsonError(503, 'unavailable', 'El módulo no está disponible ahora mismo.')
  }
}
