import { MODULE_TOKEN_CONTRACT } from '../token'
/**
 * La suite de contrato de la sesión de módulo: los mismos siete casos contra el doble de Pimia (A, el
 * día a día) y contra el ERP real cuando exista su emisor (D y E). Lo que cambia entre los dos es el **destino**
 * (`ContractTarget`): quién emite los tokens y cómo se revoca, se retira el módulo o se tira una instancia. Los casos y
 * lo que se espera del módulo no cambian.
 *
 * Cada caso usa su propia instancia (`tenantFor`), para que lo que el módulo recuerda de un caso (claves, estado) no
 * tape el siguiente. El informe no lleva tokens ni nada que sirva para entrar: solo estados y códigos.
 */
export interface IssueOptions { tenant: string; scopes?: string[]; audience?: string; ttl_seconds?: number }
export interface ContractTarget {
  /** `double` o `erp`. */
  kind: 'double' | 'erp'
  /** Versión del ERP o del doble que emite. */
  version(): Promise<string>
  /** La instancia de cada caso. Con el doble, una nueva por caso; con el ERP real, las de pruebas que dé el DVI. */
  tenantFor(caseId: string): string
  /** Una empresa de la persona de la suite y otra que no lo es. */
  company: string
  otherCompany: string
  /** La audiencia de este módulo (`owner/key`) y otra que no lo es. */
  audience: string
  otherAudience: string
  issue(options: IssueOptions): Promise<{ token: string; sid: string }>
  revoke(tenant: string, sid: string): Promise<void>
  retireModule(tenant: string): Promise<void>
  takeDown(tenant: string): Promise<void>
}
/** El módulo bajo prueba: dónde está y una ruta que exija un permiso que el token de la suite no lleve. */
export interface ContractModule {
  url: string
  key: string
  commit: string
  scopeProbe: { method: 'GET' | 'POST' | 'PUT'; path: string; scope: string; body?: unknown }
  /** Los permisos que lleva el token de la suite (todos menos `scopeProbe.scope`). */
  baseScopes: string[]
}
export interface CheckResult { label: string; expected: { status: number; error: string | null }; got: { status: number; error: string | null }; ok: boolean }
export interface CaseResult { id: string; title: string; checks: CheckResult[]; ok: boolean }
export interface ContractReport {
  contract: string
  erp: { kind: string; version: string }
  module: { key: string; commit: string }
  ran_at: string
  cases: CaseResult[]
  result: 'ok' | 'error'
}

export const CONTRACT_CASES = [
  { id: 'authorized', title: 'Acceso autorizado' },
  { id: 'foreign-company-or-instance', title: 'Empresa o instancia ajenas' },
  { id: 'wrong-audience', title: 'Audiencia equivocada' },
  { id: 'expired-or-revoked', title: 'Token caducado o revocado' },
  { id: 'module-retired', title: 'Módulo retirado del plan' },
  { id: 'insufficient-scope', title: 'Ámbito insuficiente' },
  { id: 'erp-down', title: 'ERP caído' },
] as const

/** Los códigos de error que el módulo puede devolver y el informe puede llevar (contrato §4.3 y la capa HTTP). */
export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'unauthorized', 'wrong_audience', 'token_expired', 'token_revoked', 'forbidden', 'company_required', 'tenant_required',
  'tenant_mismatch', 'not_in_plan', 'insufficient_scope', 'pimia_unavailable', 'unavailable', 'not_found', 'validation',
  'conflict', 'too_large', 'invalid_json', 'invalid',
])
/** El código de una respuesta, para el informe: `null` si no trae; uno de la lista, tal cual; cualquier otra cosa, `unexpected_error_code`. */
export function responseErrorCode(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value) ? value : 'unexpected_error_code'
}

/** Un código seguro para el informe a partir de cualquier error: el tipo, si es uno conocido; si no, `suite_error`. */
export function suiteErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return ({ TimeoutError: 'suite_timeout', AbortError: 'suite_timeout', TypeError: 'suite_network_error', SyntaxError: 'suite_bad_response' } as Record<string, string>)[name] ?? 'suite_error'
}

export async function runContractSuite(target: ContractTarget, module: ContractModule): Promise<ContractReport> {
  const call = async (token: string, tenant: string, company: string, probe?: ContractModule['scopeProbe']) => {
    const reply = await fetch(new URL(probe?.path ?? '/api/session', module.url), {
      method: probe?.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, company, 'x-pimia-tenant': tenant, ...(probe?.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: probe?.body === undefined ? undefined : JSON.stringify(probe.body),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await reply.json().catch(() => null) as { error?: unknown; data?: unknown } | null
    // Lo que diga la respuesta no se copia: el código pasa por la lista cerrada y el estado tiene que ser un estado HTTP.
    const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data as Record<string, unknown> : null
    return { status: Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599 ? reply.status : 0, error: responseErrorCode(body?.error), data }
  }
  const check = (label: string, got: { status: number; error: string | null }, status: number, error: string | null): CheckResult =>
    ({ label, expected: { status, error }, got: { status: got.status, error: got.error }, ok: got.status === status && got.error === error })
  const scopes = module.baseScopes

  const runs: Record<(typeof CONTRACT_CASES)[number]['id'], () => Promise<CheckResult[]>> = {
    'authorized': async () => {
      const tenant = target.tenantFor('authorized')
      const { token } = await target.issue({ tenant, scopes })
      const reply = await call(token, tenant, target.company)
      const result = check('GET /api/session con su token, su empresa y su instancia', reply, 200, null)
      const same = reply.data?.tenantId === tenant && reply.data?.companyId === target.company
      return [{ ...result, ok: result.ok && same }]
    },
    'foreign-company-or-instance': async () => {
      const tenant = target.tenantFor('foreign-company-or-instance'), other = target.tenantFor('foreign-instance')
      const ours = await target.issue({ tenant, scopes })
      const theirs = await target.issue({ tenant: other, scopes })
      return [
        check('token de una empresa usado con otra', await call(ours.token, tenant, target.otherCompany), 403, 'forbidden'),
        check('token de otra instancia', await call(theirs.token, tenant, target.company), 403, 'tenant_mismatch'),
      ]
    },
    'wrong-audience': async () => {
      const tenant = target.tenantFor('wrong-audience')
      const { token } = await target.issue({ tenant, scopes, audience: target.otherAudience })
      return [check('token emitido para otro módulo', await call(token, tenant, target.company), 401, 'wrong_audience')]
    },
    'expired-or-revoked': async () => {
      const tenant = target.tenantFor('expired-or-revoked')
      const expired = await target.issue({ tenant, scopes, ttl_seconds: -120 })
      const revoked = await target.issue({ tenant, scopes })
      await target.revoke(tenant, revoked.sid)
      return [
        check('caducado hace dos minutos', await call(expired.token, tenant, target.company), 401, 'token_expired'),
        check('sesión de módulo revocada', await call(revoked.token, tenant, target.company), 401, 'token_revoked'),
      ]
    },
    'module-retired': async () => {
      const tenant = target.tenantFor('module-retired')
      const { token } = await target.issue({ tenant, scopes })
      await target.retireModule(tenant)
      return [check('el plan de la instancia ya no lleva el módulo', await call(token, tenant, target.company), 403, 'not_in_plan')]
    },
    'insufficient-scope': async () => {
      const tenant = target.tenantFor('insufficient-scope')
      const { token } = await target.issue({ tenant, scopes })
      const probe = module.scopeProbe
      return [check(`${probe.method} ${probe.path} sin «${probe.scope}»`, await call(token, tenant, target.company, probe), 403, 'insufficient_scope')]
    },
    'erp-down': async () => {
      const tenant = target.tenantFor('erp-down')
      const { token } = await target.issue({ tenant, scopes })
      await target.takeDown(tenant)
      return [check('la instancia no contesta y no hay nada recordado', await call(token, tenant, target.company), 503, 'pimia_unavailable')]
    },
  }

  const cases: CaseResult[] = []
  for (const { id, title } of CONTRACT_CASES) {
    let checks: CheckResult[]
    try { checks = await runs[id]() } catch (error) {
      // Nunca el mensaje del error: puede llevar cabeceras, tokens o respuestas del ERP. Solo un código de una lista cerrada.
      checks = [{ label: 'el caso no pudo ejecutarse', expected: { status: 0, error: null }, got: { status: 0, error: suiteErrorCode(error) }, ok: false }]
    }
    cases.push({ id, title, checks, ok: checks.every(c => c.ok) })
  }
  return {
    contract: MODULE_TOKEN_CONTRACT, erp: { kind: target.kind, version: await target.version() },
    module: { key: module.key, commit: module.commit }, ran_at: new Date().toISOString(), cases,
    result: cases.every(c => c.ok) ? 'ok' : 'error',
  }
}
