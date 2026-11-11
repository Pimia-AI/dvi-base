import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto'
import { isScope, SCOPES_MAX } from './manifest'
/**
 * El token de módulo de Pimia ERP (`docs/contrato-embebido.md` §4): un JWT corto, firmado por la instancia con clave
 * asimétrica, que solo vale para un módulo (`aud` = `owner/key`), una persona (`sub`), una empresa (`company`) y una
 * instancia (`iss` y `tenant`). Lo emite el ERP: en producción y en E, a petición del panel; en automatización (D), a
 * petición del DVI de servidor a servidor. Este validador es el mismo para los dos y para el doble de Pimia.
 *
 * El módulo no reenvía el token a ninguna API de Pimia para saber quién es: lo comprueba aquí, con las claves públicas
 * de la instancia (`/.well-known/pimia-module-keys`). La revocación y el plan los resuelve `session.ts`.
 *
 * Solo `EdDSA` (Ed25519), `ES256` y `RS256`; nunca `none` ni claves simétricas. El `kid` es obligatorio.
 *
 * Las mismas reglas de forma que el ERP al verificar: ninguna clave JSON repetida en la cabecera ni en los claims (con
 * `JSON.parse` ganaría la última), ningún carácter de control en los textos (ni un salto de línea final) y cada ámbito
 * de `scope` con la gramática común de `module.json` (`manifest.ts`).
 */
/** La versión de este contrato (propuesta de `docs/contrato-embebido.md` §4); la suite de contrato la registra. */
export const MODULE_TOKEN_CONTRACT = 'pimia-module-token/0.1'
export const MODULE_TOKEN_TYPE = 'pimia-module+jwt'
export const KEYS_PATH = '/.well-known/pimia-module-keys'
/** Vida máxima de un token de módulo (de `iat` a `exp`) y holgura de reloj. */
export const MAX_TOKEN_LIFE_S = 10 * 60
export const CLOCK_SKEW_S = 30
const KEYS_TTL_MS = 10 * 60_000
/** Un `kid` desconocido vuelve a pedir las claves (rotación), pero no más de una vez cada 30 s por instancia. */
const KEYS_REFETCH_MS = 30_000

export interface ModuleTokenClaims {
  iss: string
  sub: string
  aud: string
  tenant: string
  company: string
  scopes: string[]
  /** Quién lo pidió en nombre de `sub` (`act.sub`): el DVI o un agente en D; el panel no lo pone en E. */
  actor: string | null
  /** La sesión de módulo, lo que se revoca. */
  sid: string
  jti: string
  iat: number
  exp: number
  name: string
}
export type TokenFailure = 'malformed' | 'bad_signature' | 'expired' | 'wrong_audience' | 'keys_unavailable'
export class TokenError extends Error {
  constructor(readonly reason: TokenFailure) { super(reason) }
}

const ALGORITHMS: Record<string, { kty: string; crv?: string; hash: string | null; dsaEncoding?: 'ieee-p1363' }> = {
  EdDSA: { kty: 'OKP', crv: 'Ed25519', hash: null },
  ES256: { kty: 'EC', crv: 'P-256', hash: 'sha256', dsaEncoding: 'ieee-p1363' },
  RS256: { kty: 'RSA', hash: 'sha256' },
}
const B64URL = /^[A-Za-z0-9_-]+$/
const ID = /^[A-Za-z0-9._:-]{1,128}$/
/** Caracteres de control, de formato, sustitutos, privados y sin asignar (`\p{C}`): ninguno cabe en un claim de texto. */
const CONTROL = /\p{C}/u

/**
 * Si algún objeto del JSON (ya válido) repite una clave, comparadas ya decodificadas (`"sub"` y `"\u0073ub"` son la
 * misma). Un recorrido lineal, como el del ERP (`ModuleJws::hasDuplicateKeys`).
 */
export function hasDuplicateKeys(json: string): boolean {
  const stack: { object: boolean; keys: Set<string>; expectKey: boolean }[] = []
  for (let i = 0; i < json.length; i++) {
    const char = json[i]
    if (char === '"') {
      const start = i
      for (i++; i < json.length && json[i] !== '"'; i++) if (json[i] === '\\') i++
      const top = stack[stack.length - 1]
      if (top?.object && top.expectKey) {
        const key = JSON.parse(json.slice(start, i + 1)) as string
        if (top.keys.has(key)) return true
        top.keys.add(key)
        top.expectKey = false
      }
    } else if (char === '{') stack.push({ object: true, keys: new Set(), expectKey: true })
    else if (char === '[') stack.push({ object: false, keys: new Set(), expectKey: false })
    else if (char === '}' || char === ']') stack.pop()
    else if (char === ',') { const top = stack[stack.length - 1]; if (top?.object) top.expectKey = true }
  }
  return false
}

function decodePart(part: string): Record<string, unknown> {
  if (!B64URL.test(part)) throw new TokenError('malformed')
  const json = Buffer.from(part, 'base64url').toString('utf8')
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new TokenError('malformed') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TokenError('malformed')
  // Ya es JSON válido: ahora, ninguna clave repetida en ningún objeto.
  if (hasDuplicateKeys(json)) throw new TokenError('malformed')
  return value as Record<string, unknown>
}

/** Lo que dice el token, SIN comprobar la firma: solo para saber a qué instancia preguntar y detectar la ajena. */
export function peekModuleToken(token: string): { header: Record<string, unknown>; claims: ModuleTokenClaims; signed: string; signature: Buffer } {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[2] || !B64URL.test(parts[2])) throw new TokenError('malformed')
  const header = decodePart(parts[0]), payload = decodePart(parts[1])
  if (header.typ !== MODULE_TOKEN_TYPE || typeof header.alg !== 'string' || !(header.alg in ALGORITHMS) || typeof header.kid !== 'string' || !ID.test(header.kid) || 'crit' in header) {
    throw new TokenError('malformed')
  }
  const text = (key: string) => {
    const value = payload[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && key !== 'iss') return String(value)
    if (typeof value !== 'string' || !value || value.length > 256 || CONTROL.test(value)) throw new TokenError('malformed')
    return value
  }
  const time = (key: string) => {
    const value = payload[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TokenError('malformed')
    return value
  }
  // Una sola audiencia: un token que vale para varios módulos no es un token de módulo.
  if (typeof payload.aud !== 'string') throw new TokenError(Array.isArray(payload.aud) ? 'wrong_audience' : 'malformed')
  if (CONTROL.test(payload.aud)) throw new TokenError('malformed')
  // Ámbitos separados por un solo espacio, sin repetidos, cada uno con la gramática común; vacío es «ninguno».
  const scope = payload.scope ?? ''
  if (typeof scope !== 'string' || scope.length > 2048) throw new TokenError('malformed')
  const scopes = scope === '' ? [] : scope.split(' ')
  if (scopes.length > SCOPES_MAX || !scopes.every(isScope) || new Set(scopes).size !== scopes.length) throw new TokenError('malformed')
  const act = payload.act
  if (act !== undefined && (!act || typeof act !== 'object' || Array.isArray(act) || typeof (act as { sub?: unknown }).sub !== 'string' || !ID.test((act as { sub: string }).sub))) throw new TokenError('malformed')
  if (payload.name !== undefined && (typeof payload.name !== 'string' || CONTROL.test(payload.name))) throw new TokenError('malformed')
  const claims: ModuleTokenClaims = {
    iss: text('iss'), sub: text('sub'), aud: payload.aud, tenant: text('tenant'), company: text('company'),
    scopes, actor: act ? (act as { sub: string }).sub : null,
    sid: text('sid'), jti: text('jti'), iat: time('iat'), exp: time('exp'),
    name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : '',
  }
  if (!ID.test(claims.sid) || !ID.test(claims.jti)) throw new TokenError('malformed')
  if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_TOKEN_LIFE_S) throw new TokenError('malformed')
  return { header, claims, signed: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') }
}

interface KeySet { keys: Map<string, { key: KeyObject; alg: string | null }>; until: number; fetchedAt: number }
/** Las claves públicas por instancia (origen). Las pruebas pasan la suya. */
export type KeyCache = Map<string, KeySet>
const sharedKeys: KeyCache = new Map()

/** Lee un JWKS: solo claves públicas de firma de los tipos admitidos; lo demás se ignora. */
export function readKeySet(body: unknown): Map<string, { key: KeyObject; alg: string | null }> {
  const list = (body as { keys?: unknown } | null)?.keys
  if (!Array.isArray(list)) throw new Error('JWKS sin «keys»')
  const keys = new Map<string, { key: KeyObject; alg: string | null }>()
  for (const jwk of list.slice(0, 20) as (JsonWebKey & { kid?: unknown; use?: unknown; alg?: unknown })[]) {
    if (!jwk || typeof jwk.kid !== 'string' || !ID.test(jwk.kid) || (jwk.use !== undefined && jwk.use !== 'sig') || 'd' in jwk) continue
    if (!['OKP', 'EC', 'RSA'].includes(String(jwk.kty))) continue
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' })
      if (key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) continue
      keys.set(jwk.kid, { key, alg: typeof jwk.alg === 'string' ? jwk.alg : null })
    } catch { /* clave ilegible: fuera */ }
  }
  return keys
}

async function keysOf(origin: string, kid: string, fetchImpl: typeof fetch, cache: KeyCache) {
  const now = Date.now()
  const cached = cache.get(origin)
  if (cached && cached.until > now && (cached.keys.has(kid) || now - cached.fetchedAt < KEYS_REFETCH_MS)) return cached
  let reply: Response
  try {
    reply = await fetchImpl(new URL(KEYS_PATH, origin), { headers: { accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  } catch {
    if (cached && cached.until > now) return cached
    throw new TokenError('keys_unavailable')
  }
  if (!reply.ok) {
    if (cached && cached.until > now) return cached
    throw new TokenError('keys_unavailable')
  }
  let keys: KeySet['keys']
  try { keys = readKeySet(await reply.json()) } catch { throw new TokenError('keys_unavailable') }
  const fresh: KeySet = { keys, until: now + KEYS_TTL_MS, fetchedAt: now }
  if (cache.size >= 1000) cache.clear()
  cache.set(origin, fresh)
  return fresh
}

export interface VerifyOptions {
  /** El origen de la instancia que se espera como emisor (construido por el módulo, nunca leído del token). */
  issuer: string
  /** `owner/key` del módulo. */
  audience: string
  fetch?: typeof fetch
  keyCache?: KeyCache
  now?: () => number
}

/** Comprueba firma, emisor, vida y audiencia. Empresa e instancia las compara `session.ts` con la petición. */
export async function verifyModuleToken(token: string, options: VerifyOptions): Promise<ModuleTokenClaims> {
  const { header, claims, signed, signature } = peekModuleToken(token)
  if (claims.iss !== options.issuer) throw new TokenError('bad_signature')
  const kid = header.kid as string, alg = ALGORITHMS[header.alg as string]
  const set = await keysOf(options.issuer, kid, options.fetch ?? fetch, options.keyCache ?? sharedKeys)
  const entry = set.keys.get(kid)
  if (!entry) throw new TokenError('bad_signature')
  const { key } = entry
  const kty = key.asymmetricKeyType === 'ed25519' ? 'OKP' : key.asymmetricKeyType === 'ec' ? 'EC' : key.asymmetricKeyType === 'rsa' ? 'RSA' : ''
  if (kty !== alg.kty || (entry.alg && entry.alg !== header.alg)) throw new TokenError('bad_signature')
  if (alg.crv && kty === 'EC' && key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new TokenError('bad_signature')
  let ok = false
  try { ok = verify(alg.hash, Buffer.from(signed), alg.dsaEncoding ? { key, dsaEncoding: alg.dsaEncoding } : key, signature) } catch { ok = false }
  if (!ok) throw new TokenError('bad_signature')
  const now = Math.floor((options.now ?? Date.now)() / 1000)
  if (claims.exp + CLOCK_SKEW_S <= now) throw new TokenError('expired')
  if (claims.iat - CLOCK_SKEW_S > now) throw new TokenError('malformed')
  if (claims.aud !== options.audience) throw new TokenError('wrong_audience')
  return claims
}
