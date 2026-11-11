import { TENANT_SLUG, tenantOrigin, type ModuleInstances } from './config'
import { peekModuleToken, verifyModuleToken, TokenError, type KeyCache } from './token'
/**
 * Quién llama al módulo, según Pimia ERP (`docs/contrato-embebido.md` §4). Extraído de una vertical
 * anterior en producción, pero ya no reenvía el token de la persona a `/me`: llega un **token de
 * módulo** emitido por la instancia, y aquí se comprueba sin dárselo a nadie:
 *
 * 1. La instancia: con `PIMIA_BASE_URL` de patrón la dice `x-pimia-tenant`; sin patrón es la del despliegue. El emisor
 *    esperado se CONSTRUYE con ella; nunca se toma del token. Un token de otra instancia es `tenant_mismatch`.
 * 2. Firma (claves públicas de esa instancia), vida corta y audiencia `owner/key` de este módulo (`token.ts`).
 * 3. La empresa: la cabecera `company` tiene que ser la del token. Cambiar de empresa es pedir otro token.
 * 4. El estado del módulo en la instancia (`GET /api/v1/modules/{key}/state`): si su plan lo lleva y qué sesiones de
 *    módulo están revocadas. Se recuerda por instancia + módulo, como mucho un minuto (`max_age` del ERP).
 *
 * Quien decide los permisos sigue siendo Pimia: el módulo solo lee los que trae el token (`scopes`) y no puede dar más.
 */
export interface ModuleSession {
  userId: string
  userName: string
  tenantId: string
  companyId: string
  /** Los permisos del módulo que trae el token. Las rutas los exigen con `withModule(…, { scope })`. */
  scopes: string[]
  /** Quién pidió el token en nombre de la persona (el DVI o un agente), o `null` si lo pidió ella desde el panel. */
  actor: string | null
}
export type ModuleAuthCode =
  | 'unauthorized' | 'wrong_audience' | 'token_expired' | 'token_revoked'
  | 'forbidden' | 'company_required' | 'tenant_required' | 'tenant_mismatch' | 'not_in_plan' | 'insufficient_scope'
  | 'pimia_unavailable'
export class ModuleAuthError extends Error {
  constructor(readonly status: 401 | 403 | 503, readonly code: ModuleAuthCode) { super(code) }
}
/** El estado del módulo en una instancia, recordado hasta `until`. */
export interface ModuleState { inPlan: boolean; revoked: Set<string>; until: number }
/** A quién sirve, quién es este módulo, el transporte y las memorias. */
export type SessionConfig = ModuleInstances & {
  /** La cuenta de integrador dueña (`owner` de `module.json`). */
  moduleOwner: string
  /** La clave de este módulo (`key` de `module.json`). */
  moduleKey: string
  fetch?: typeof fetch
  /** Estado por `instancia|owner/key`. Las pruebas pasan el suyo. */
  stateMemo?: Map<string, ModuleState>
  keyCache?: KeyCache
  now?: () => number
}
export const STATE_MAX_AGE_S = 60
const sharedStateMemo = new Map<string, ModuleState>()

/** `Authorization: Bearer <token>`; nada más se acepta. */
export function readBearer(value: string | null): string | null {
  const match = /^Bearer\s+(\S{1,4096})$/i.exec(value ?? '')
  return match ? match[1] : null
}

const TOKEN_ERRORS: Record<string, [401 | 503, ModuleAuthCode]> = {
  malformed: [401, 'unauthorized'],
  bad_signature: [401, 'unauthorized'],
  expired: [401, 'token_expired'],
  wrong_audience: [401, 'wrong_audience'],
  keys_unavailable: [503, 'pimia_unavailable'],
}
const fail = (status: 401 | 403 | 503, code: ModuleAuthCode) => new ModuleAuthError(status, code)
const fromToken = (error: unknown) => error instanceof TokenError ? fail(...TOKEN_ERRORS[error.reason]) : error instanceof ModuleAuthError ? error : fail(503, 'pimia_unavailable')

export async function moduleSession(headers: Headers, config: SessionConfig): Promise<ModuleSession> {
  const token = readBearer(headers.get('authorization'))
  if (!token) throw fail(401, 'unauthorized')
  const companyId = headers.get('company')?.trim() ?? ''
  if (!/^[1-9][0-9]{0,18}$/.test(companyId)) throw fail(403, 'company_required')
  const { tenantId, apiOrigin } = instanceOf(headers, config)
  const audience = `${config.moduleOwner}/${config.moduleKey}`
  const now = config.now ?? Date.now
  // Sin comprobar aún la firma: un token de otra instancia se reconoce y no se le pregunta a la nuestra por él.
  let peeked
  try { peeked = peekModuleToken(token).claims } catch (error) { throw fromToken(error) }
  if (peeked.iss !== apiOrigin || peeked.tenant !== tenantId) throw fail(403, 'tenant_mismatch')
  const transport = guardedTransport(apiOrigin, config.fetch ?? fetch)
  let claims
  try { claims = await verifyModuleToken(token, { issuer: apiOrigin, audience, fetch: transport, keyCache: config.keyCache, now }) }
  catch (error) { throw fromToken(error) }
  if (claims.company !== companyId) throw fail(403, 'forbidden')
  const state = await moduleState(apiOrigin, audience, config.moduleKey, token, transport, config.stateMemo ?? sharedStateMemo, now)
  if (!state.inPlan) throw fail(403, 'not_in_plan')
  if (state.revoked.has(claims.sid)) throw fail(401, 'token_revoked')
  return { userId: claims.sub, userName: claims.name, tenantId, companyId, scopes: claims.scopes, actor: claims.actor }
}

/** Qué instancia es y dónde está su Pimia. Con patrón, la cabecera manda y se valida como etiqueta de DNS antes de construir el host. */
function instanceOf(headers: Headers, config: SessionConfig): { tenantId: string; apiOrigin: string } {
  const hint = headers.get('x-pimia-tenant')?.trim() ?? ''
  if (config.tenantPattern) {
    if (!TENANT_SLUG.test(hint)) throw fail(403, 'tenant_required')
    return { tenantId: hint, apiOrigin: tenantOrigin(config.tenantPattern, hint) }
  }
  if (hint && hint !== config.tenantId) throw fail(403, 'tenant_mismatch')
  return { tenantId: config.tenantId, apiOrigin: config.apiOrigin }
}

/** Solo hacia la instancia, sin redirecciones, sin caché y con tiempo acotado. */
function guardedTransport(apiOrigin: string, transport: typeof fetch): typeof fetch {
  return (input, init) => {
    if (new URL(String(input)).origin !== apiOrigin) throw fail(503, 'pimia_unavailable')
    return transport(input, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  }
}

/**
 * El plan y las revocaciones del módulo en la instancia. La memo va por instancia Y módulo: dos módulos en el mismo
 * proceso, o el mismo módulo en dos instancias, nunca comparten respuesta. Se pregunta con el propio token de módulo,
 * que el ERP acepta solo para esto.
 */
async function moduleState(apiOrigin: string, audience: string, moduleKey: string, token: string, transport: typeof fetch, memo: Map<string, ModuleState>, now: () => number): Promise<ModuleState> {
  const memoKey = `${apiOrigin}|${audience}`
  const cached = memo.get(memoKey)
  if (cached && cached.until > now()) return cached
  let reply: Response
  try {
    reply = await transport(new URL(`/api/v1/modules/${encodeURIComponent(moduleKey)}/state`, apiOrigin), { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  } catch { throw fail(503, 'pimia_unavailable') }
  // Si el ERP ya no acepta el token (revocado antes de que lo supiéramos), es suyo decirlo.
  if (reply.status === 401) throw fail(401, 'token_revoked')
  if (reply.status === 403 || reply.status === 404) throw fail(403, 'not_in_plan')
  if (!reply.ok) throw fail(503, 'pimia_unavailable')
  let body: unknown
  try { body = await reply.json() } catch { throw fail(503, 'pimia_unavailable') }
  const data = (body as { data?: unknown } | null)?.data as { in_plan?: unknown; revoked_sessions?: unknown; max_age?: unknown } | undefined
  if (!data || typeof data.in_plan !== 'boolean' || !Array.isArray(data.revoked_sessions) || data.revoked_sessions.some(s => typeof s !== 'string')) throw fail(503, 'pimia_unavailable')
  const maxAge = typeof data.max_age === 'number' && Number.isFinite(data.max_age) ? Math.min(Math.max(data.max_age, 0), STATE_MAX_AGE_S) : STATE_MAX_AGE_S
  const state: ModuleState = { inPlan: data.in_plan, revoked: new Set(data.revoked_sessions as string[]), until: now() + maxAge * 1000 }
  if (memo.size >= 1000) memo.clear()
  memo.set(memoKey, state)
  return state
}
