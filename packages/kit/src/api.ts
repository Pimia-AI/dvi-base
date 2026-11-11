import type { HostSession } from './host'
/**
 * El cliente de la API del módulo desde sus pantallas (contrato embebido §7): mismo origen, `Authorization: Bearer`
 * con el token de la sesión, `company` y `x-pimia-tenant`. Un 401 pide sesión nueva al anfitrión una vez y repite la
 * petición una vez. Los errores salen como `ModuleApiError` con el código del módulo (`not_in_plan`, `validation`…),
 * y los que impiden seguir se avisan al anfitrión.
 */
export class ModuleApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly errors?: Record<string, string>) { super(message) }
}
export interface SessionSource {
  getSession(): Promise<HostSession>
  requestSession(): Promise<HostSession>
  reportError?(code: string, status: number): void
}
export interface ModuleApi {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body: unknown): Promise<T>
  put<T = unknown>(path: string, body: unknown): Promise<T>
}

/** Los códigos con los que la pantalla ya no puede seguir: el anfitrión puede pintar su propio estado. */
const BLOCKING = new Set(['unauthorized', 'wrong_audience', 'token_revoked', 'not_in_plan', 'forbidden', 'company_required', 'tenant_required', 'tenant_mismatch'])

export function createModuleApi(options: { session: SessionSource; fetch?: typeof fetch; baseUrl?: string }): ModuleApi {
  const transport = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? ''

  async function send(method: string, path: string, body: unknown, session: HostSession): Promise<Response> {
    try {
      return await transport(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${session.token}`,
          company: session.company.id,
          'x-pimia-tenant': session.tenant,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch {
      throw new ModuleApiError(0, 'network', 'No se pudo conectar con el módulo.')
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response = await send(method, path, body, await options.session.getSession())
    if (response.status === 401) response = await send(method, path, body, await options.session.requestSession())
    let payload: { error?: unknown; message?: unknown; errors?: unknown } | null = null
    try { payload = await response.json() } catch { payload = null }
    if (response.ok) return payload as T
    const code = typeof payload?.error === 'string' ? payload.error : response.status >= 500 ? 'unavailable' : 'error'
    const message = typeof payload?.message === 'string' ? payload.message : 'El módulo ha respondido con un error.'
    const errors = payload?.errors && typeof payload.errors === 'object' ? payload.errors as Record<string, string> : undefined
    if (BLOCKING.has(code)) options.session.reportError?.(code, response.status)
    throw new ModuleApiError(response.status, code, message, errors)
  }

  return {
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
  }
}
