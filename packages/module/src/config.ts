/**
 * La configuración del módulo, y solo esa. Extraído de una vertical anterior en producción, sin
 * nada de la app de veterinaria. Variables:
 *
 * - `PIMIA_BASE_URL`: el patrón de la vertical (`https://{tenant}.taskai.work`), y entonces la instancia la dice cada
 *   petición; o la dirección fija de una sola instancia.
 * - `PIMIA_TENANT_ID`: solo con dirección fija, y entonces obligatoria: el slug de esa instancia.
 * - `DATABASE_URL`: la base del módulo, con el rol de ejecución.
 * - `PIMIA_DOUBLE_URL`: el doble de Pimia, solo en pruebas y desarrollo; nunca en producción.
 */
export type Environment = Record<string, string | undefined>

function required(env: Environment, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Falta configuración: ${key}`)
  return value
}

/** Un origen `https://` sin credenciales, ruta, query ni fragmento, en su forma canónica. */
export function httpsOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Origen no permitido')
  // `new URL` admite llaves en el host, también codificadas (`%7B`), y ningún origen legítimo las lleva.
  if (/[{}]/.test(url.hostname)) throw new Error('Origen no permitido')
  return url.origin
}

/** Llaves en una dirección: en el texto o en el host ya interpretado (`%7Btenant%7D`, llaves de ancho completo). */
function hasBraces(value: string): boolean {
  if (/[{}]/.test(value)) return true
  try { return /[{}]/.test(new URL(value).hostname) } catch { return false }
}

/** Un slug de instancia, con las reglas de una etiqueta de DNS: es lo que se mete en un host, así que ni puntos ni subrayados. */
export const TENANT_SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
export interface TenantPattern { prefix: string; suffix: string }

/**
 * `PIMIA_BASE_URL` con el marcador `{tenant}` en el subdominio (`https://{tenant}.taskai.work`): el mismo despliegue
 * sirve a cualquier instancia de ese Pimia, y la dirección de cada una se CONSTRUYE con el patrón, nunca se acepta
 * de fuera. Sin marcador, `null`: la dirección de una única instancia.
 */
export function readTenantPattern(value: string): TenantPattern | null {
  const text = value.trim()
  if (!text.includes('{tenant}')) return null
  if (!text.startsWith('https://{tenant}.')) throw new Error('PIMIA_BASE_URL: el marcador {tenant} va en el subdominio (https://{tenant}.dominio)')
  const rest = text.slice('https://{tenant}'.length)
  // Un solo marcador; detrás, un dominio fijo, sin más llaves (`https://{tenant}.{tenant}.work` no es un patrón).
  if (/[{}]/.test(rest)) throw new Error('PIMIA_BASE_URL: un solo marcador {tenant}, en el subdominio (https://{tenant}.dominio)')
  const probe = httpsOrigin(`https://probe${rest}`)
  return { prefix: 'https://', suffix: probe.slice('https://probe'.length) }
}

export function tenantOrigin(pattern: TenantPattern, slug: string): string {
  if (!TENANT_SLUG.test(slug)) throw new Error('Instancia no válida')
  return `${pattern.prefix}${slug}${pattern.suffix}`
}

/** A quién sirve el módulo: a toda la vertical (patrón; la instancia la dice cada petición) o a una sola (dirección fija y su slug). */
export type ModuleInstances =
  | { tenantPattern: TenantPattern }
  | { tenantPattern?: null; tenantId: string; apiOrigin: string }

export function readModuleConfig(env: Environment = process.env): ModuleInstances {
  if (env.PIMIA_DOUBLE_URL && (env.NODE_ENV === 'production' || process.env.DVI_BUILD === 'production')) throw new Error('El doble de Pimia no se permite en producción')
  const baseUrl = required(env, 'PIMIA_BASE_URL')
  const tenantPattern = readTenantPattern(baseUrl)
  if (tenantPattern) return { tenantPattern }
  // Sin el marcador exacto es una dirección fija, y una llave ahí es un marcador mal escrito (`{TENANT}`, `%7Btenant%7D`).
  if (hasBraces(baseUrl)) throw new Error('PIMIA_BASE_URL: el marcador es exactamente {tenant}, en el subdominio (https://{tenant}.dominio)')
  const tenantId = env.PIMIA_TENANT_ID?.trim()
  if (!tenantId) throw new Error('Falta configuración: PIMIA_TENANT_ID')
  if (!TENANT_SLUG.test(tenantId)) throw new Error('PIMIA_TENANT_ID no es un slug de instancia válido')
  return { tenantPattern: null, tenantId, apiOrigin: httpsOrigin(baseUrl) }
}

/** `DATABASE_URL`: PostgreSQL, con el nombre de la base en la ruta. Nunca se escribe en los registros. */
export function databaseUrl(env: Environment = process.env): string {
  const connectionString = env.DATABASE_URL?.trim()
  let url: URL
  try { url = new URL(connectionString ?? '') } catch { throw new Error('Falta configuración: DATABASE_URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(url.pathname)) {
    throw new Error('DATABASE_URL tiene que ser postgresql://…/<base>')
  }
  return connectionString!
}
