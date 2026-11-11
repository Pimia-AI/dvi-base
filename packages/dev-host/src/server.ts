import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
/**
 * El anfitrión de desarrollo: en local hace el papel del panel de Pimia ERP (`docs/contrato-embebido.md` §11). Sirve una
 * cáscara con el aspecto del panel que embebe las pantallas del módulo y habla el contrato con ellas. Solo escucha en
 * 127.0.0.1 y nunca forma parte de una imagen de producción.
 *
 * Las personas son las del doble de Pimia. La cáscara no guarda tokens: cuando la pantalla del módulo pide sesión
 * (`ready`, `request-session`), pide a `/dev/session` un token de módulo nuevo para esa persona y esa empresa, y el
 * doble lo emite como lo haría Pimia ERP. Cambiar de persona o de empresa es pedir otro token.
 */
export interface DevPerson { label: string; user: { id: string; name: string; email: string }; note?: string; companies: { id: string; name: string }[] }
/** Un token de módulo para la persona `person` (índice) en la empresa `company`, o `null` si no puede tenerlo. */
export type IssueSession = (person: number, company: string) => Promise<{ token: string; expires_at: string } | null>
export interface DevHostOptions {
  /** Dónde corre el módulo (`http://127.0.0.1:7160`). */
  moduleOrigin: string
  module: { key: string; name: string; screens: { id: string; title: string; path: string; menu?: { group: string; icon: string; order?: number } }[] }
  tenant: string
  people: DevPerson[]
  issue: IssueSession
  /** La interfaz del anfitrión ya construida (`vite build`). */
  uiDir: string
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

export function createDevHost(options: DevHostOptions): Server {
  const index = readFileSync(join(options.uiDir, 'index.html'))
  const assets = new Map<string, { body: Buffer; type: string }>()
  const assetsDir = join(options.uiDir, 'assets')
  for (const name of readdirSync(assetsDir)) {
    const type = TYPES[extname(name)]
    if (type && statSync(join(assetsDir, name)).isFile()) assets.set(`/assets/${name}`, { body: readFileSync(join(assetsDir, name)), type })
  }
  const config = Buffer.from(JSON.stringify({ tenant: options.tenant, module: { ...options.module, origin: options.moduleOrigin }, people: options.people }))
  const security = {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${options.moduleOrigin}; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://dev-host.invalid'), path = url.pathname
    const send = (status: number, type: string, body: Buffer) => { res.writeHead(status, { ...security, 'Content-Type': type, 'Content-Length': body.length }); res.end(body) }
    const json = (status: number, value: unknown) => send(status, 'application/json', Buffer.from(JSON.stringify(value)))
    if (req.method !== 'GET') return send(405, 'text/plain; charset=utf-8', Buffer.from('Método no permitido'))
    if (path === '/dev/config') return send(200, 'application/json', config)
    if (path === '/dev/session') {
      const person = Number(url.searchParams.get('person')), company = url.searchParams.get('company') ?? ''
      if (!Number.isInteger(person) || !options.people[person] || !/^[1-9][0-9]{0,18}$/.test(company)) return json(400, { error: 'invalid' })
      const issued = await options.issue(person, company)
      return issued ? json(200, issued) : json(403, { error: 'forbidden' })
    }
    const asset = assets.get(path)
    if (asset) return send(200, asset.type, asset.body)
    if (path === '/' || path.startsWith('/m/')) return send(200, 'text/html; charset=utf-8', index)
    send(404, 'text/plain; charset=utf-8', Buffer.from('No existe'))
  }
  return createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) { res.writeHead(503, security); res.end() } }) })
}
