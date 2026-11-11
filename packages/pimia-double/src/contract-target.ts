import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractTarget } from '@dvi-base/module/testing/contract'
import { LUCIA } from './double'
/**
 * El doble de Pimia como destino de la suite de contrato (`@dvi-base/module/testing/contract`): todo por su HTTP
 * (`/dev/*`), así que vale igual para el doble en proceso de las pruebas y para el del `compose`. Una instancia nueva
 * por caso (`<prefijo>-<caso>`), que el módulo no ha visto todavía.
 */
export function doubleTarget(doubleUrl: string, options: { owner: string; key: string; prefix?: string }): ContractTarget {
  const post = async (path: string, body: unknown) => {
    const reply = await fetch(new URL(path, doubleUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!reply.ok) throw new Error(`El doble respondió ${reply.status} a ${path}`)
    return (await reply.json() as { data: Record<string, unknown> }).data
  }
  const prefix = options.prefix ?? `c${Date.now().toString(36)}`
  return {
    kind: 'double',
    version: async () => `pimia-double@${(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version}`,
    tenantFor: caseId => `${prefix}-${caseId}`.slice(0, 63).replace(/-+$/, ''),
    company: String(LUCIA.companies[0].id),
    otherCompany: String(LUCIA.companies[1].id),
    audience: `${options.owner}/${options.key}`,
    otherAudience: `${options.owner}/otro-modulo`,
    issue: async ({ tenant, scopes, audience, ttl_seconds }) => {
      const data = await post('/dev/tokens', { person: LUCIA.id, company: LUCIA.companies[0].id, tenant, scopes, audience, ttl_seconds })
      return { token: String(data.token), sid: String(data.sid) }
    },
    revoke: async (tenant, sid) => { await post('/dev/revoke', { tenant, sid }) },
    retireModule: async tenant => { await post(`/dev/tenants/${tenant}`, { in_plan: false }) },
    takeDown: async tenant => { await post(`/dev/tenants/${tenant}`, { down: true }) },
  }
}
