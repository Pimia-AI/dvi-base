/**
 * La superficie del módulo: una tabla cerrada de rutas y métodos, y nada más. Función pura, sin red ni base. Extraído de una vertical
 * anterior en producción; la tabla ya no es fija: la base pone sus rutas y el dominio las suyas.
 *
 * El destino de la petición se casa tal cual llega, sin normalizar: ni se decodifica para casar, ni se resuelven `.` ni
 * `..`, ni se quita la barra final, ni se pasan mayúsculas. Los segmentos fijos casan literal. Los variables son
 * cualquier segmento no vacío salvo `.` y `..` (escritos o codificados) y se decodifican para el handler; si no se
 * pueden decodificar, no casan. La query (lo que va desde el primer `?`) llega intacta al handler. Lo que no casa es 404;
 * una ruta que existe con otro método, 405 con `Allow`. Si dos rutas casan, gana la primera de la tabla.
 */
export type Method = 'GET' | 'POST' | 'PUT'
export const METHODS: readonly Method[] = ['GET', 'POST', 'PUT']
export interface RouteDef { readonly name: string; readonly path: string; readonly methods: readonly Method[] }

/** Las rutas que pone la base en todo módulo, antes que las del dominio. */
export const BASE_ROUTES = [
  { name: 'healthz', path: '/healthz', methods: ['GET'] },
  { name: 'readyz', path: '/readyz', methods: ['GET'] },
  { name: 'version', path: '/api/version', methods: ['GET'] },
  { name: 'session', path: '/api/session', methods: ['GET'] },
] as const satisfies readonly RouteDef[]

/** Los segmentos variables ya decodificados. */
export type RouteParams = Readonly<Record<string, string>>
export type Resolution =
  /** `path` es la ruta con los segmentos variables recodificados; `search`, la query tal cual (`''` o `?…`). */
  | { status: 200; route: string; method: Method; params: RouteParams; path: string; search: string }
  | { status: 405; allow: string }
  | { status: 404 }

/** Las cabeceras de toda respuesta de la API del módulo, también 404, 405, 413 y 503. Sin HSTS: escucha en loopback, detrás de un proxy. */
export const MODULE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
})

export interface RouteTable {
  readonly routes: readonly RouteDef[]
  resolve(method: string, rawTarget: string): Resolution
}

const FIXED = /^[a-z0-9][a-z0-9-]*$/
const PARAM = /^:[a-zA-Z][a-zA-Z0-9]*$/
const NAME = /^[a-z][a-zA-Z0-9]*$/

/** Comprueba la tabla del dominio y la une a la de la base. Una tabla mal formada no arranca. */
export function createRouteTable(domainRoutes: readonly RouteDef[]): RouteTable {
  const routes: readonly RouteDef[] = [...BASE_ROUTES, ...domainRoutes]
  const names = new Set<string>(), paths = new Set<string>()
  for (const route of routes) {
    const where = `Ruta ${JSON.stringify(route.name)}`
    if (!NAME.test(route.name)) throw new Error(`${where}: el nombre va en camelCase`)
    if (names.has(route.name)) throw new Error(`${where}: nombre repetido`)
    if (paths.has(route.path)) throw new Error(`${where}: ruta repetida`)
    names.add(route.name); paths.add(route.path)
    if (!route.methods.length || new Set(route.methods).size !== route.methods.length || route.methods.some(m => !METHODS.includes(m))) {
      throw new Error(`${where}: métodos no válidos`)
    }
    if (domainRoutes.includes(route)) {
      if (!route.path.startsWith('/api/')) throw new Error(`${where}: las rutas del dominio van bajo /api/ y no pueden ser de la base`)
      const segments = route.path.slice(1).split('/')
      if (!FIXED.test(segments[1] ?? '')) throw new Error(`${where}: el primer segmento tras /api/ es fijo`)
      for (const segment of segments) if (!FIXED.test(segment) && !PARAM.test(segment)) throw new Error(`${where}: segmento no válido ${JSON.stringify(segment)}`)
      const params = segments.filter(s => s.startsWith(':'))
      if (new Set(params).size !== params.length) throw new Error(`${where}: parámetro repetido`)
    }
  }
  const table = routes.map(route => ({ ...route, segments: route.path.slice(1).split('/') }))
  return { routes, resolve: (method, rawTarget) => resolve(table, method, rawTarget) }
}

const NOT_FOUND: Resolution = Object.freeze({ status: 404 })

function resolve(table: readonly (RouteDef & { segments: string[] })[], method: string, rawTarget: string): Resolution {
  // Solo la forma de origen (`/…`): ni `*` ni la forma absoluta (`http://host/…`).
  if (!rawTarget.startsWith('/')) return NOT_FOUND
  const query = rawTarget.indexOf('?')
  const path = query === -1 ? rawTarget : rawTarget.slice(0, query)
  const search = query === -1 ? '' : rawTarget.slice(query)
  const segments = path.slice(1).split('/')
  for (const route of table) {
    const params = match(route.segments, segments)
    if (!params) continue
    const methods: readonly string[] = route.methods
    if (!methods.includes(method)) return { status: 405, allow: methods.join(', ') }
    const canonical = route.segments.map(segment => (segment.startsWith(':') ? encodeURIComponent(params[segment.slice(1)]) : segment))
    return { status: 200, route: route.name, method: method as Method, params, path: `/${canonical.join('/')}`, search }
  }
  return NOT_FOUND
}

function match(pattern: readonly string[], segments: readonly string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (const [index, expected] of pattern.entries()) {
    const actual = segments[index]
    if (!expected.startsWith(':')) {
      if (actual !== expected) return null
      continue
    }
    const value = variable(actual)
    if (value === null) return null
    params[expected.slice(1)] = value
  }
  return params
}

/** Un segmento variable: no vacío, decodificable y que no sea `.` ni `..`, ni escrito ni codificado (`%2e%2e`). */
function variable(raw: string): string | null {
  if (!raw || raw === '.' || raw === '..') return null
  let value: string
  try { value = decodeURIComponent(raw) } catch { return null }
  return value === '.' || value === '..' ? null : value
}
