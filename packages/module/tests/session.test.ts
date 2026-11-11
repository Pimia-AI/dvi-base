/**
 * La sesión del módulo con el token de módulo (`docs/contrato-embebido.md` §4). Sustituye a la portada
 * de la prueba de sesión de una vertical anterior, que probaba el reenvío del token de la persona a `/me` y la memo del
 * plan por origen sin la clave del módulo: los dos defectos que encontró la revisión. Se conservan sus casos de instancia
 * (patrón y dirección fija), de empresa y de Pimia caído, ahora sobre el token firmado.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moduleKeyPair, signModuleToken } from '@dvi-base/pimia-double'
import { moduleSession, readBearer, ModuleAuthError, type ModuleState, type SessionConfig } from '../src/session'
import type { KeyCache } from '../src/token'
import { readModuleConfig } from '../src/config'

const OWNER = 'dvi-base', KEY = 'dvi-base-notes', AUD = `${OWNER}/${KEY}`
const apiOrigin = 'https://demo.pimia.test'
const signer = moduleKeyPair('k1')
const now = () => Math.floor(Date.now() / 1000)

/** Un token de módulo como lo emitiría la instancia `tenant`; `extra` cambia lo que haga falta. */
function token(extra: Record<string, unknown> = {}, keys = signer, header: Record<string, unknown> = {}) {
  const tenant = (extra.tenant as string) ?? 'demo'
  return signModuleToken(keys.privateKey, keys.kid, {
    iss: tenant === 'demo' ? apiOrigin : `https://${tenant}.pimia.test`, sub: '7', name: 'Lucía García', aud: AUD, tenant, company: '1',
    scope: 'notes:read', sid: 'ms_1', jti: 'j1', iat: now(), exp: now() + 600, ...extra,
  }, header)
}

/** Una instancia de Pimia de prueba: claves y estado del módulo por origen. Anota cada llamada. */
function erp(options: { inPlan?: boolean; revoked?: string[]; down?: boolean; maxAge?: number; jwks?: unknown } = {}) {
  const calls: { url: string; auth: string | null }[] = []
  const state = { inPlan: options.inPlan ?? true, revoked: options.revoked ?? [], down: options.down ?? false, jwks: options.jwks ?? signer.jwks }
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers)
    calls.push({ url: url.toString(), auth: headers.get('authorization') })
    assert.equal(init?.redirect, 'error')
    if (state.down) return new Response('gateway', { status: 502 })
    if (url.pathname === '/.well-known/pimia-module-keys') return Response.json(state.jwks)
    if (url.pathname === `/api/v1/modules/${KEY}/state` || /^\/api\/v1\/modules\/[^/]+\/state$/.test(url.pathname)) {
      return Response.json({ data: { in_plan: state.inPlan, revoked_sessions: state.revoked, ...(options.maxAge === undefined ? {} : { max_age: options.maxAge }) } })
    }
    return Response.json({ message: 'Not Found' }, { status: 404 })
  }
  return { transport, calls, state }
}
const config = (transport: typeof fetch, extra: Partial<SessionConfig> = {}): SessionConfig => ({
  apiOrigin, tenantId: 'demo', moduleOwner: OWNER, moduleKey: KEY, fetch: transport,
  stateMemo: new Map<string, ModuleState>(), keyCache: new Map() as KeyCache, ...extra,
} as SessionConfig)
const headers = (bearer: string | null, extra: Record<string, string> = {}) => new Headers({ ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), company: '1', ...extra })
const rejects = (promise: Promise<unknown>, status: number, code: string, label = code) =>
  assert.rejects(promise, (e: unknown) => e instanceof ModuleAuthError && e.status === status && e.code === code, label)

test('readBearer solo admite la forma Bearer', () => {
  assert.equal(readBearer('Bearer abc'), 'abc')
  assert.equal(readBearer('bearer abc'), 'abc')
  assert.equal(readBearer('Basic abc'), null)
  assert.equal(readBearer('Bearer'), null)
  assert.equal(readBearer(null), null)
  assert.equal(readBearer('Bearer ' + 'x'.repeat(4097)), null)
})

test('la sesión sale del token de módulo firmado; el token no se reenvía a /me ni a ninguna API de la persona', async () => {
  const { transport, calls } = erp()
  const session = await moduleSession(headers(token({ act: { sub: 'dvi:agent:42' }, scope: 'notes:read notes:write' }), { 'x-pimia-tenant': 'demo' }), config(transport))
  assert.deepEqual(session, { userId: '7', userName: 'Lucía García', tenantId: 'demo', companyId: '1', scopes: ['notes:read', 'notes:write'], actor: 'dvi:agent:42' })
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/.well-known/pimia-module-keys', `/api/v1/modules/${KEY}/state`])
  assert.equal(calls[0].auth, null, 'las claves públicas se piden sin token')
  assert.ok(calls.every(c => new URL(c.url).origin === apiOrigin))
})

test('sin token, mal formado, sin firma o firmado por otra clave: 401 unauthorized', async () => {
  const { transport } = erp()
  await rejects(moduleSession(headers(null), config(transport)), 401, 'unauthorized', 'sin token')
  await rejects(moduleSession(headers('no-es-un-jwt'), config(transport)), 401, 'unauthorized', 'opaco')
  const [h, p] = token().split('.')
  await rejects(moduleSession(headers(`${h}.${p}.`), config(transport)), 401, 'unauthorized', 'sin firma')
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'pimia-module+jwt', kid: 'k1' })).toString('base64url')}.${p}.x`
  await rejects(moduleSession(headers(none), config(transport)), 401, 'unauthorized', 'alg none')
  await rejects(moduleSession(headers(token({}, signer, { typ: 'JWT' })), config(transport)), 401, 'unauthorized', 'otro typ')
  const stranger = moduleKeyPair('k1')
  await rejects(moduleSession(headers(token({}, stranger)), config(transport)), 401, 'unauthorized', 'misma kid, otra clave')
  await rejects(moduleSession(headers(token({}, moduleKeyPair('k9'))), config(transport)), 401, 'unauthorized', 'kid desconocida')
  await rejects(moduleSession(headers(token({ exp: now() + 3600 })), config(transport)), 401, 'unauthorized', 'vida de más de 10 minutos')
})

test('audiencia: solo owner/key de este módulo, y una sola', async () => {
  const { transport } = erp()
  for (const aud of [`${OWNER}/otro-modulo`, `otro-integrador/${KEY}`, KEY, 'pimia-erp']) {
    await rejects(moduleSession(headers(token({ aud })), config(transport)), 401, 'wrong_audience', aud)
  }
  await rejects(moduleSession(headers(token({ aud: [AUD, `${OWNER}/otro`] })), config(transport)), 401, 'wrong_audience', 'varias audiencias')
})

test('caducado: 401 token_expired (con 30 s de holgura de reloj)', async () => {
  const { transport } = erp()
  await rejects(moduleSession(headers(token({ iat: now() - 700, exp: now() - 100 })), config(transport)), 401, 'token_expired')
  assert.equal((await moduleSession(headers(token({ iat: now() - 610, exp: now() - 10 })), config(transport))).userId, '7')
})

test('empresa: la cabecera tiene que ser la del token; cambiar de empresa es pedir otro token', async () => {
  const { transport } = erp()
  await rejects(moduleSession(headers(token(), { company: '2' }), config(transport)), 403, 'forbidden')
  await rejects(moduleSession(headers(token(), { company: 'uno' }), config(transport)), 403, 'company_required')
  await rejects(moduleSession(new Headers({ authorization: `Bearer ${token()}` }), config(transport)), 403, 'company_required')
})

test('instancia ajena: un token de otra instancia es tenant_mismatch y no se le pregunta a la nuestra', async () => {
  const { transport, calls } = erp()
  await rejects(moduleSession(headers(token({ tenant: 'otra' })), config(transport)), 403, 'tenant_mismatch', 'emisor de otra instancia')
  await rejects(moduleSession(headers(token({ tenant: 'otra', iss: apiOrigin })), config(transport)), 403, 'tenant_mismatch', 'tenant de otra con nuestro emisor')
  await rejects(moduleSession(headers(token(), { 'x-pimia-tenant': 'otra' }), config(transport)), 403, 'tenant_mismatch', 'cabecera de otra')
  assert.equal(calls.length, 0, 'sin salir a la red')
})

test('plan y revocación: módulo retirado → not_in_plan; sesión revocada → token_revoked', async () => {
  await rejects(moduleSession(headers(token()), config(erp({ inPlan: false }).transport)), 403, 'not_in_plan')
  await rejects(moduleSession(headers(token({ sid: 'ms_cerrada' })), config(erp({ revoked: ['ms_cerrada'] }).transport)), 401, 'token_revoked')
  assert.equal((await moduleSession(headers(token({ sid: 'ms_viva' })), config(erp({ revoked: ['ms_cerrada'] }).transport))).userId, '7')
})

test('el estado se recuerda por instancia + módulo, como mucho un minuto, y nunca se comparte entre módulos', async () => {
  const { transport, calls, state } = erp()
  const shared = config(transport)
  await moduleSession(headers(token()), shared)
  await moduleSession(headers(token({ sid: 'ms_2' })), shared)
  assert.equal(calls.filter(c => c.url.endsWith('/state')).length, 1, 'misma instancia y módulo: una pregunta')
  // Otro módulo en el mismo proceso y la misma instancia: su propia pregunta, aunque comparta memo.
  const other = { ...shared, moduleKey: 'otro-modulo' } as SessionConfig
  await moduleSession(headers(token({ aud: `${OWNER}/otro-modulo` })), other)
  assert.equal(calls.filter(c => c.url.endsWith('/state')).length, 2)
  assert.ok(calls.some(c => c.url.endsWith('/api/v1/modules/otro-modulo/state')))
  assert.deepEqual([...shared.stateMemo!.keys()].sort(), [`${apiOrigin}|${AUD}`, `${apiOrigin}|${OWNER}/otro-modulo`])
  // Una revocación se ve en cuanto caduca lo recordado.
  state.revoked = ['ms_1']
  for (const value of shared.stateMemo!.values()) value.until = Date.now() - 1
  await rejects(moduleSession(headers(token()), shared), 401, 'token_revoked')
  // `max_age` del ERP manda hacia abajo, nunca por encima de 60 s.
  const short = erp({ maxAge: 0 }), short_ = config(short.transport)
  await moduleSession(headers(token()), short_); await moduleSession(headers(token()), short_)
  assert.equal(short.calls.filter(c => c.url.endsWith('/state')).length, 2)
  const long = erp({ maxAge: 3600 }), long_ = config(long.transport)
  await moduleSession(headers(token()), long_)
  assert.ok([...long_.stateMemo!.values()][0].until <= Date.now() + 60_000)
})

test('claves: se recuerdan por instancia; una kid nueva (rotación) las vuelve a pedir', async () => {
  const rotated = moduleKeyPair('k2')
  const { transport, calls, state } = erp()
  const shared = config(transport)
  await moduleSession(headers(token()), shared)
  await moduleSession(headers(token()), shared)
  assert.equal(calls.filter(c => c.url.endsWith('pimia-module-keys')).length, 1)
  state.jwks = { keys: [...signer.jwks.keys, ...rotated.jwks.keys] }
  shared.keyCache!.get(apiOrigin)!.fetchedAt = Date.now() - 31_000
  assert.equal((await moduleSession(headers(token({}, rotated)), shared)).userId, '7')
  assert.equal(calls.filter(c => c.url.endsWith('pimia-module-keys')).length, 2)
})

test('ERP caído: 503 pimia_unavailable y ninguna sesión inventada; con claves y estado recientes, sigue', async () => {
  await rejects(moduleSession(headers(token()), config(erp({ down: true }).transport)), 503, 'pimia_unavailable', 'sin nada recordado')
  await rejects(moduleSession(headers(token()), config(erp({ jwks: { nada: 1 } }).transport)), 503, 'pimia_unavailable', 'claves ilegibles')
  const { transport, state } = erp()
  const shared = config(transport)
  await moduleSession(headers(token()), shared)
  state.down = true
  assert.equal((await moduleSession(headers(token()), shared)).userId, '7', 'dentro del minuto, con lo recordado')
  for (const value of shared.stateMemo!.values()) value.until = Date.now() - 1
  await rejects(moduleSession(headers(token()), shared), 503, 'pimia_unavailable', 'el estado caducó y el ERP no contesta')
})

test('con patrón, la instancia la dice la cabecera y la dirección del emisor se construye, nunca se acepta', async () => {
  const { transport, calls } = erp()
  const pattern = config(transport, { tenantPattern: { prefix: 'https://', suffix: '.pimia.test' } } as Partial<SessionConfig>)
  const session = await moduleSession(headers(token({ tenant: 'demo-sol' }), { 'x-pimia-tenant': 'demo-sol' }), pattern)
  assert.equal(session.tenantId, 'demo-sol')
  assert.ok(calls.every(c => c.url.startsWith('https://demo-sol.pimia.test/')), calls.map(c => c.url).join(' '))
  const before = calls.length
  await rejects(moduleSession(headers(token({ tenant: 'demo-sol' })), pattern), 403, 'tenant_required', 'sin cabecera')
  for (const bad of ['', 'Demo', 'a.evil.example', 'con_guion', '-x', 'x-', 'x'.repeat(64)]) {
    await rejects(moduleSession(headers(token({ tenant: 'demo-sol' }), { 'x-pimia-tenant': bad }), pattern), 403, 'tenant_required', bad)
  }
  assert.equal(calls.length, before, 'sin salir a la red')
})

test('la sesión usa lo que da readModuleConfig: patrón de la vertical o dirección fija con su slug', async () => {
  const { transport } = erp()
  const base = { moduleOwner: OWNER, moduleKey: KEY, fetch: transport, stateMemo: new Map(), keyCache: new Map() as KeyCache }
  const vertical = { ...readModuleConfig({ PIMIA_BASE_URL: 'https://{tenant}.pimia.test' }), ...base } as SessionConfig
  assert.equal((await moduleSession(headers(token({ tenant: 'demo-sol' }), { 'x-pimia-tenant': 'demo-sol' }), vertical)).tenantId, 'demo-sol')
  const single = { ...readModuleConfig({ PIMIA_BASE_URL: apiOrigin, PIMIA_TENANT_ID: 'demo' }), ...base } as SessionConfig
  assert.equal((await moduleSession(headers(token(), { 'x-pimia-tenant': 'demo' }), single)).tenantId, 'demo')
  assert.equal((await moduleSession(headers(token()), single)).tenantId, 'demo')
  await rejects(moduleSession(headers(token(), { 'x-pimia-tenant': 'otra' }), single), 403, 'tenant_mismatch')
})
