import type { DevPerson, IssueSession } from './server'
/**
 * Las personas del anfitrión de desarrollo y sus tokens de módulo, del doble de Pimia (`/dev/people` y `/dev/tokens`).
 * El doble hace de emisor como lo hará Pimia ERP; el anfitrión solo los pide y se los da a la pantalla.
 */
export async function peopleFromDouble(doubleUrl: string): Promise<{ people: DevPerson[]; ids: number[] }> {
  const reply = await fetch(new URL('/dev/people', doubleUrl))
  if (!reply.ok) throw new Error('El doble de Pimia no da sus personas')
  const { data } = await reply.json() as { data: { id: number; name: string; email: string; companies: { id: number; name: string }[] }[] }
  return {
    people: data.map(p => ({ label: p.name, user: { id: String(p.id), name: p.name, email: p.email }, companies: p.companies.map(c => ({ id: String(c.id), name: c.name })) })),
    ids: data.map(p => p.id),
  }
}

/** Pide al doble un token de módulo con todos los permisos que declara el módulo. */
export function issueFromDouble(doubleUrl: string, ids: number[], tenant: string, scopes: string[]): IssueSession {
  return async (person, company) => {
    const reply = await fetch(new URL('/dev/tokens', doubleUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ person: ids[person], company: Number(company), tenant, scopes }),
    })
    if (!reply.ok) return null
    const { data } = await reply.json() as { data: { token: string; expires_at: string } }
    return { token: data.token, expires_at: data.expires_at }
  }
}
