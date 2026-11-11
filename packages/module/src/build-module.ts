import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildBundle } from './build'
/**
 * `node --import tsx build-module.ts <carpeta del módulo> <salida>`: los bundles de un módulo para su imagen.
 * - `server.cjs`: el módulo en producción (sin el desvío al doble de Pimia).
 * - `server-dev.cjs`: el mismo, compilado para desarrollo (acepta `PIMIA_DOUBLE_URL` y `seed`).
 * - `pimia-double.cjs` y `dev-host.cjs`: las herramientas del arranque local, que nunca van a la imagen de producción.
 * La entrada del módulo es, por convención, `src/server/main.ts`.
 */
const [moduleDir, outDir] = process.argv.slice(2).map(path => resolve(path))
if (!moduleDir || !outDir) {
  console.error('Uso: build-module.ts <carpeta del módulo> <salida>')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const packages = resolve(import.meta.dirname, '..', '..')
const entry = join(moduleDir, 'src', 'server', 'main.ts')
await Promise.all([
  buildBundle(entry, join(outDir, 'server.cjs'), 'production'),
  buildBundle(entry, join(outDir, 'server-dev.cjs'), 'development'),
  buildBundle(join(packages, 'pimia-double', 'src', 'main.ts'), join(outDir, 'pimia-double.cjs'), 'development'),
  buildBundle(join(packages, 'dev-host', 'src', 'main.ts'), join(outDir, 'dev-host.cjs'), 'development'),
])
console.log(JSON.stringify({ step: 'bundles', status: 'ok', out: outDir }))
