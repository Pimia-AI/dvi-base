#!/usr/bin/env node
/**
 * `node packages/module/bin/module-lock.mjs` (desde la raíz de dvi-base): pone en el `package-lock.json` de la base los
 * módulos de `examples/` que todavía no están en él, sin mover nada de lo que la base ya fija.
 *
 * Por qué hace falta: el repositorio de una vertical es solo la carpeta de su módulo. Su CI clona dvi-base en el commit
 * fijado (`DVI_BASE_REF`) y mete el módulo en `examples/<clave>`, pero el lock de dvi-base solo conoce sus propios
 * ejemplos, y `npm ci` falla con «Missing: @dvi-modules/<clave>@… from lock file». Lo ejecuta el Dockerfile de la
 * plantilla justo antes de `npm ci`, con el mismo Node fijado de la imagen.
 *
 * Qué comprueba: cada entrada del lock que ya estaba fuera de `examples/` (y fuera de los enlaces `@dvi-modules/*`)
 * conserva su versión, su origen, su integridad y su enlace. npm puede añadir campos informativos (`license`) y entradas
 * nuevas: las dependencias que el módulo añade y las empaquetadas dentro de otra (`inBundle`). Las nuevas se listan en
 * la salida. Una línea JSON por paso; código distinto de 0 si algo falla.
 *
 *   --root <dir>   la raíz de dvi-base (por defecto, la carpeta actual).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const line = data => console.log(JSON.stringify(data))
const fail = (message, extra = {}) => { line({ step: 'lock', status: 'error', message, ...extra }); process.exit(1) }
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const root = rootIndex === -1 ? process.cwd() : args[rootIndex + 1]
const lockFile = join(root, 'package-lock.json')
if (!existsSync(lockFile) || !existsSync(join(root, 'examples'))) fail('Ejecútalo desde la raíz de dvi-base (con package-lock.json y examples/)')

const readLock = () => JSON.parse(readFileSync(lockFile, 'utf8'))
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
/** Lo que npm instala de un workspace: si cambia, el lock ya no casa con su package.json. */
const declared = pkg => JSON.stringify([pkg.name, pkg.version, pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.optionalDependencies ?? {}, pkg.peerDependencies ?? {}])
/** Las entradas que pertenecen a los módulos y no a la base. */
const ownedByModules = key => key === '' || key.startsWith('examples/') || key.startsWith('node_modules/@dvi-modules/')
const PINNED = ['version', 'resolved', 'integrity', 'link']

const before = readLock()
const workspaces = readdirSync(join(root, 'examples'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, 'examples', entry.name, 'package.json')))
  .map(entry => `examples/${entry.name}`)
const stale = workspaces.filter(dir => {
  const entry = before.packages?.[dir]
  return !entry || declared(entry) !== declared(readJson(join(root, dir, 'package.json')))
})
if (stale.length === 0) {
  line({ step: 'lock', status: 'ok', changed: false, workspaces })
  process.exit(0)
}

const install = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8' })
if (install.status !== 0) fail(`npm install --package-lock-only falló: ${(install.stderr || '').trim().split('\n').slice(-3).join(' ')}`)

const after = readLock()
const changed = Object.entries(before.packages ?? {})
  .filter(([key]) => !ownedByModules(key))
  .filter(([key, entry]) => PINNED.some(field => after.packages?.[key]?.[field] !== entry[field]))
  .map(([key]) => key)
if (changed.length) fail('El lock de dvi-base cambiaría más allá de los módulos: no se construye sobre otra base', { changed: changed.slice(0, 20) })
const missing = workspaces.filter(dir => !after.packages?.[dir])
if (missing.length) fail('npm no dejó en el lock estos módulos', { missing })
const added = Object.keys(after.packages ?? {}).filter(key => !ownedByModules(key) && !(key in (before.packages ?? {})))
line({ step: 'lock', status: 'ok', changed: true, workspaces: stale, added })
