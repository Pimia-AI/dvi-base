import { createServer, type IncomingMessage, type Server } from 'node:http'
import { generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto'
/**
 * Doble de Pimia ERP para pruebas y desarrollo (modo A del contrato embebido, §11): hace de **emisor de tokens de módulo** con el
 * contrato de `docs/contrato-embebido.md` §4, para que el módulo se pruebe con el mismo validador que usará con el ERP
 * real. Nunca forma parte de la imagen de producción.
 *
 * Lo que contesta el ERP (y el módulo pregunta):
 * - `GET /.well-known/pimia-module-keys`: las claves públicas (JWKS, Ed25519).
 * - `GET /api/v1/modules/{key}/state` con el token de módulo: `{data: {in_plan, revoked_sessions, max_age}}`.
 *
 * Lo que solo tiene el doble (`/dev/*`), para el anfitrión de desarrollo y la suite de contrato: emitir un token
 * (`POST /dev/tokens`), revocar una sesión (`POST /dev/revoke`), quitar el módulo del plan o tirar una instancia
 * (`POST /dev/tenants/{tenant}`) y la lista de personas (`GET /dev/people`). En el ERP real, quien pide el token es el
 * panel (E) o el DVI (D); nunca el módulo.
 *
 * La instancia de cada petición la dice `x-pimia-double-host` (la pone el transporte del módulo hacia el doble).
 */
export interface DoublePerson { id: number; name: string; email: string; companies: { id: number; name: string }[] }
export interface PimiaDoubleConfig {
  /** La cuenta de integrador y la clave del módulo (`owner` y `key` de `module.json`): la audiencia es `owner/key`. */
  owner: string
  key: string
  /** El `PIMIA_BASE_URL` del módulo: `https://{tenant}.dominio` o la dirección fija de una instancia. */
  baseUrl: string
  /** Con dirección fija, el slug de esa instancia (`PIMIA_TENANT_ID`). */
  tenantId?: string
  people?: DoublePerson[]
}
export interface IssueRequest {
  person: number
  company: number
  tenant: string
  scopes?: string[]
  /** Solo para la suite: otra audiencia, o una vida negativa (token ya caducado). */
  audience?: string
  ttl_seconds?: number
  actor?: string
}

export const LUCIA: DoublePerson = { id: 7, name: 'Lucía García', email: 'lucia@ejemplo.invalid', companies: [{ id: 1, name: 'Empresa Uno' }, { id: 2, name: 'Empresa Dos' }] }
export const OUTSIDER: DoublePerson = { id: 8, name: 'Otra Persona', email: 'otra@ejemplo.invalid', companies: [{ id: 3, name: 'Empresa Tres' }] }
export const MODULE_TOKEN_TYPE = 'pimia-module+jwt'
const TENANT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** Firma un token de módulo (JWT compacto, EdDSA). Lo usa el doble y las pruebas que necesitan uno a medida. */
export function signModuleToken(privateKey: KeyObject, kid: string, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signed = `${part({ alg: 'EdDSA', typ: MODULE_TOKEN_TYPE, kid, ...header })}.${part(claims)}`
  return `${signed}.${sign(null, Buffer.from(signed), privateKey).toString('base64url')}`
}
/** Un par de claves Ed25519 con su JWKS público. */
export function moduleKeyPair(kid = randomBytes(8).toString('hex')) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { kid, privateKey, publicKey, jwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'EdDSA' }] } }
}

export interface PimiaDouble extends Server {
  /** Emite un token como lo haría el ERP. `null` si la persona no es de esa empresa. */
  issue(request: IssueRequest): { token: string; expires_at: string; sid: string } | null
}

export function createPimiaDouble(config: PimiaDoubleConfig): PimiaDouble {
  const people = config.people ?? [LUCIA, OUTSIDER]
  const keys = moduleKeyPair()
  const audience = `${config.owner}/${config.key}`
  const pattern = config.baseUrl.includes('{tenant}')
  const fixed = pattern ? null : new URL(config.baseUrl)
  if (fixed && !config.tenantId) throw new Error('Con dirección fija, el doble necesita tenantId')
  const issuerOf = (tenant: string) => pattern ? config.baseUrl.replace('{tenant}', tenant) : fixed!.origin
  const tenantOfHost = (host: string): string | null => {
    if (fixed) return host === fixed.host ? config.tenantId! : null
    const suffix = new URL(config.baseUrl.replace('{tenant}', 'x')).host.slice(1)
    if (!host.endsWith(suffix)) return null
    const slug = host.slice(0, -suffix.length)
    return TENANT.test(slug) ? slug : null
  }
  const revoked = new Map<string, Set<string>>()
  const tenants = new Map<string, { inPlan: boolean; down: boolean }>()
  const stateOf = (tenant: string) => tenants.get(tenant) ?? { inPlan: true, down: false }

  function issue(request: IssueRequest) {
    const person = people.find(p => p.id === request.person)
    if (!person || !person.companies.some(c => c.id === request.company) || !TENANT.test(request.tenant)) return null
    const now = Math.floor(Date.now() / 1000)
    const ttl = Math.min(Math.trunc(request.ttl_seconds ?? 600), 600)
    const exp = now + ttl, iat = ttl > 0 ? now : exp - 600
    const sid = `ms_${randomBytes(12).toString('hex')}`
    const token = signModuleToken(keys.privateKey, keys.kid, {
      iss: issuerOf(request.tenant), sub: String(person.id), name: person.name, aud: request.audience ?? audience,
      tenant: request.tenant, company: String(request.company), scope: (request.scopes ?? []).join(' '),
      ...(request.actor ? { act: { sub: request.actor } } : {}), sid, jti: randomBytes(12).toString('hex'), iat, exp,
    })
    return { token, expires_at: new Date(exp * 1000).toISOString(), sid }
  }

  /** El token que trae el módulo al preguntar por su estado: firmado por el doble, vigente y de esta audiencia. */
  function bearerClaims(req: IncomingMessage): Record<string, unknown> | null {
    const token = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature) return null
    try {
      if (!verify(null, Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))) return null
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
      return claims.aud === audience && Number(claims.exp) > Date.now() / 1000 ? claims : null
    } catch { return null }
  }

  const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>(resolve => {
    let text = ''
    req.on('data', chunk => { text += chunk; if (text.length > 16_384) req.destroy() })
    req.on('end', () => { try { const value = JSON.parse(text || '{}'); resolve(value && typeof value === 'object' ? value : {}) } catch { resolve({}) } })
  })

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' })
      res.end(text)
    }
    const url = new URL(req.url ?? '/', 'http://doble.invalid')
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok' })

    if (url.pathname.startsWith('/dev/')) {
      if (req.method === 'GET' && url.pathname === '/dev/people') return send(200, { data: people })
      if (req.method !== 'POST') return send(405, { message: 'Method Not Allowed' })
      const body = await readBody(req)
      if (url.pathname === '/dev/tokens') {
        const issued = issue(body as unknown as IssueRequest)
        return issued ? send(201, { data: issued }) : send(403, { message: 'Esa persona no es de esa empresa.' })
      }
      if (url.pathname === '/dev/revoke' && typeof body.tenant === 'string' && typeof body.sid === 'string') {
        if (!revoked.has(body.tenant)) revoked.set(body.tenant, new Set())
        revoked.get(body.tenant)!.add(body.sid)
        return send(200, { data: { revoked: body.sid } })
      }
      const tenant = /^\/dev\/tenants\/([a-z0-9-]+)$/.exec(url.pathname)?.[1]
      if (tenant && TENANT.test(tenant)) {
        const next = { ...stateOf(tenant), ...(typeof body.in_plan === 'boolean' ? { inPlan: body.in_plan } : {}), ...(typeof body.down === 'boolean' ? { down: body.down } : {}) }
        tenants.set(tenant, next)
        return send(200, { data: { tenant, in_plan: next.inPlan, down: next.down } })
      }
      return send(404, { message: 'Not Found' })
    }

    if (req.method !== 'GET') return send(404, { message: 'Not Found' })
    const tenant = tenantOfHost(String(req.headers['x-pimia-double-host'] ?? ''))
    if (!tenant) return send(404, { message: 'Instancia desconocida' })
    if (stateOf(tenant).down) return send(503, 'down')
    if (url.pathname === '/.well-known/pimia-module-keys') return send(200, keys.jwks)
    if (url.pathname === `/api/v1/modules/${config.key}/state`) {
      const claims = bearerClaims(req)
      if (!claims || claims.tenant !== tenant || claims.iss !== issuerOf(tenant)) return send(401, { message: 'Unauthenticated.' })
      return send(200, { data: { in_plan: stateOf(tenant).inPlan, revoked_sessions: [...(revoked.get(tenant) ?? [])], max_age: 60 } })
    }
    send(404, { message: 'Not Found' })
  }) as PimiaDouble
  server.issue = issue
  return server
}
