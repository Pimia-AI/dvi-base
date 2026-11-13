import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Manifest } from './manifest'
/**
 * Las pantallas del módulo, servidas por el propio módulo en `/app/*` (`docs/contrato-embebido.md` §5 y §9).
 * Igual que la API, una superficie cerrada:
 *
 * - `/app/assets/<fichero>`: solo los ficheros que hay en `<UI_DIR>/assets` al arrancar (lo que genera Vite), con su
 *   tipo y caché larga (llevan huella en el nombre).
 * - Las rutas de las pantallas de `module.json` (`ui.screens[].path`) y lo que cuelga de ellas: el `index.html`, sin
 *   caché. La navegación dentro de la pantalla es cosa de la propia pantalla.
 * - Todo lo demás bajo `/app` es 404, y un método que no sea GET, 405.
 *
 * El HTML lleva su propia política: puede embeberlo solo un anfitrión permitido (`frame-ancestors`), y solo carga
 * recursos de su origen. Los orígenes del anfitrión van también en una `<meta>` para que la pantalla los compruebe al
 * hablar por `postMessage`.
 */
export interface UiFile { body: Buffer; type: string }
export interface Ui {
  serve(method: string, path: string): { status: 200; headers: Record<string, string>; body: Buffer } | { status: 404 } | { status: 405; allow: string } | null
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json',
}
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/
const HOST_ORIGIN = /^https?:\/\/(\{tenant\}\.)?[a-z0-9.-]+(:\d{1,5})?$/

/** Los orígenes del anfitrión, como los admite `frame-ancestors`: el patrón `{tenant}` pasa a `*`. */
export function frameAncestors(hostOrigins: readonly string[]): string {
  return hostOrigins.map(origin => origin.replace('://{tenant}.', '://*.')).join(' ')
}

/**
 * `PIMIA_HOST_ORIGINS`: la lista exacta de anfitriones, separados por comas (contrato embebido §9): el panel de Pimia y, si
 * existe, la app del producto del integrador. `https://{tenant}.dominio` se admite por compatibilidad, pero está
 * desaconsejado. `http://` solo a loopback.
 */
export function readHostOrigins(value: string | undefined): string[] {
  const origins = (value ?? '').split(',').map(origin => origin.trim()).filter(Boolean)
  if (!origins.length) throw new Error('Falta configuración: PIMIA_HOST_ORIGINS')
  for (const origin of origins) {
    if (!HOST_ORIGIN.test(origin)) throw new Error('PIMIA_HOST_ORIGINS: cada origen es https://dominio, https://{tenant}.dominio o http://127.0.0.1:puerto')
    if (origin.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) throw new Error('PIMIA_HOST_ORIGINS: http:// solo hacia loopback')
  }
  return origins
}

export function loadUi(dir: string, manifest: Manifest, hostOrigins: readonly string[]): Ui {
  const screens = manifest.ui?.screens.map(screen => screen.path) ?? []
  if (!screens.length) throw new Error('module.json no declara pantallas')
  let html: string
  try { html = readFileSync(join(dir, 'index.html'), 'utf8') } catch { throw new Error('Falta la interfaz construida (index.html)') }
  const meta = `<meta name="pimia-host-origins" content="${hostOrigins.join(',').replace(/"/g, '')}">`
  if (!html.includes('</head>')) throw new Error('index.html sin </head>')
  const index = Buffer.from(html.replace('</head>', `  ${meta}\n  </head>`))
  const assets = new Map<string, UiFile>()
  const assetsDir = join(dir, 'assets')
  let names: string[] = []
  try { if (statSync(assetsDir).isDirectory()) names = readdirSync(assetsDir) } catch { names = [] }
  for (const name of names) {
    const type = TYPES[extname(name)]
    if (!ASSET_NAME.test(name) || !type || !statSync(join(assetsDir, name)).isFile()) continue
    assets.set(`/app/assets/${name}`, { body: readFileSync(join(assetsDir, name)), type })
  }
  const htmlHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
      "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "object-src 'none'", `frame-ancestors ${frameAncestors(hostOrigins)}`,
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
  const assetHeaders = (type: string) => ({
    'Content-Type': type,
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  const isScreen = (path: string) => screens.some(screen => {
    if (path === screen) return true
    if (!path.startsWith(`${screen}/`)) return false
    return path.slice(screen.length + 1).split('/').every(segment => SEGMENT.test(segment))
  })
  return {
    serve(method, path) {
      if (path !== '/app' && !path.startsWith('/app/')) return null
      const asset = assets.get(path)
      const known = Boolean(asset) || isScreen(path)
      if (!known) return { status: 404 }
      if (method !== 'GET') return { status: 405, allow: 'GET' }
      if (asset) return { status: 200, headers: assetHeaders(asset.type), body: asset.body }
      return { status: 200, headers: htmlHeaders, body: index }
    },
  }
}
