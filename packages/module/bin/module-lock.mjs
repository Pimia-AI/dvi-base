#!/usr/bin/env node
/**
 * `node packages/module/bin/module-lock.mjs` (desde la raíz de dvi-base): pone en el `package-lock.json` de la base los
 * módulos de `examples/` que todavía no están en él (o cuyo `package.json` cambió), sin mover nada de lo que la base fija.
 *
 * Por qué hace falta: el repositorio de una vertical es solo la carpeta de su módulo. Su CI clona dvi-base en el commit
 * fijado (`DVI_BASE_REF`) y mete el módulo en `examples/<clave>`, pero el lock de dvi-base solo conoce sus propios
 * ejemplos, y `npm ci` falla con «Missing: @dvi-modules/<clave>@… from lock file». Lo ejecuta el Dockerfile de la
 * plantilla justo antes de `npm ci`, con el mismo Node fijado de la imagen.
 *
 * Reglas (si una no se cumple, falla y no se construye):
 *   1. Lo que la base fija no se mueve ni se sombrea: cada entrada que ya estaba conserva versión, origen, integridad y
 *      enlace; ningún paquete `@dvi-base/*` aparece en ninguna entrada nueva; y un paquete que la base fija solo puede
 *      aparecer justo debajo de un módulo (`examples/<clave>/node_modules/<paquete>`, que es lo que resuelve su código)
 *      si es idéntico a una copia de la base.
 *   2. Toda entrada nueva viene del registro público de npm (`https://registry.npmjs.org/`) con su `integrity`; las
 *      únicas excepciones son el workspace del módulo, su enlace `node_modules/@dvi-modules/<clave>` y las dependencias
 *      empaquetadas (`inBundle`) dentro de un paquete que sí viene así. Nada de `file:`, git, otros hosts ni enlaces.
 *   3. La salida lista todas las entradas nuevas, también las anidadas, con su origen; una entrada que no encaja en
 *      ninguno de esos casos es un fallo.
 * Una línea JSON por paso; código distinto de 0 si algo falla.
 *
 *   --root <dir>   la raíz de dvi-base (por defecto, la carpeta actual).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REGISTRY = 'https://registry.npmjs.org/'
const line = data => console.log(JSON.stringify(data))
const fail = (message, extra = {}) => { line({ step: 'lock', status: 'error', message, ...extra }); process.exit(1) }
const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const root = rootIndex === -1 ? process.cwd() : args[rootIndex + 1]
const lockFile = join(root, 'package-lock.json')
if (!existsSync(lockFile) || !existsSync(join(root, 'examples'))) fail('Ejecútalo desde la raíz de dvi-base (con package-lock.json y examples/)')

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
/** Lo que npm instala de un workspace: si cambia, el lock ya no casa con su package.json. */
const declared = pkg => JSON.stringify([pkg.name, pkg.version, pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.optionalDependencies ?? {}, pkg.peerDependencies ?? {}])
/** El nombre del paquete de una entrada del lock: lo que va detrás del último `node_modules/`. */
const packageName = key => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
/** Un origen sin credenciales, para la salida. */
const origin = resolved => { try { const url = new URL(resolved); url.username = ''; url.password = ''; return url.href } catch { return String(resolved) } }
const PINNED = ['version', 'resolved', 'integrity', 'link']
const samePins = (a, b) => PINNED.every(field => a?.[field] === b?.[field])
const fromRegistry = entry => typeof entry?.resolved === 'string' && entry.resolved.startsWith(REGISTRY) && /^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity ?? '') && !entry.link

const before = readJson(lockFile)
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
const names = Object.fromEntries(stale.map(dir => [dir, readJson(join(root, dir, 'package.json')).name]))
const badName = stale.filter(dir => !/^@dvi-modules\/[a-z][a-z0-9-]{1,39}$/.test(names[dir] ?? ''))
if (badName.length) fail('El paquete de un módulo se llama @dvi-modules/<clave> (lo crea así new-module)', { workspaces: badName.map(dir => ({ dir, name: names[dir] })) })

/** Lo que es del módulo que se añade: su workspace, lo que cuelga de él y su enlace en la raíz. */
const moduleOf = key => stale.find(dir => key === dir || key.startsWith(`${dir}/`) || key === `node_modules/${names[dir]}`)

const install = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8' })
if (install.status !== 0) fail(`npm install --package-lock-only falló: ${(install.stderr || '').trim().split('\n').slice(-3).join(' ')}`)
const after = readJson(lockFile)
const beforePackages = before.packages ?? {}, afterPackages = after.packages ?? {}

// Regla 1a: lo que la base ya tenía (fuera del módulo que se añade) no se mueve.
const changed = Object.keys(beforePackages)
  .filter(key => key !== '' && !moduleOf(key))
  .filter(key => !samePins(beforePackages[key], afterPackages[key]))
if (changed.length) fail('El lock de dvi-base cambiaría más allá del módulo: no se construye sobre otra base', { changed: changed.slice(0, 20) })

// Las copias que la base fija, por nombre de paquete: contra ellas se mira lo que aparece justo debajo de un módulo.
const baseCopies = new Map()
for (const [key, entry] of Object.entries(beforePackages)) {
  if (key === '' || moduleOf(key) || !key.includes('node_modules/')) continue
  const name = packageName(key)
  baseCopies.set(name, [...(baseCopies.get(name) ?? []), entry])
}

// Las entradas a explicar: todas las nuevas y todas las del módulo que se añade, existieran antes o no.
const review = Object.keys(afterPackages).filter(key => key !== '' && (!(key in beforePackages) || moduleOf(key)))
const added = [], problems = []
for (const key of review) {
  const entry = afterPackages[key], dir = moduleOf(key)
  if (dir && key === dir) {
    if (entry.name !== names[dir] || entry.resolved || entry.link) problems.push({ key, reason: 'el workspace del módulo no es el de su package.json' })
    else added.push({ key, kind: 'workspace' })
    continue
  }
  if (dir && key === `node_modules/${names[dir]}`) {
    if (entry.link !== true || entry.resolved !== dir) problems.push({ key, reason: `el enlace del módulo tiene que apuntar a ${dir}` })
    else added.push({ key, kind: 'workspace-link' })
    continue
  }
  if (!key.includes('node_modules/')) { problems.push({ key, reason: 'una entrada nueva fuera de node_modules: otro workspace o un enlace' }); continue }
  const name = packageName(key)
  // Regla 1b: el ámbito de la base no lo da nadie más.
  if (name.startsWith('@dvi-base/')) { problems.push({ key, reason: `${name} es de la base: solo puede ser su workspace`, resolved: origin(entry.resolved) }); continue }
  if (name.startsWith('@dvi-modules/')) { problems.push({ key, reason: `${name} es un módulo: no se instala como dependencia`, resolved: origin(entry.resolved) }); continue }
  // Regla 1c: justo debajo del módulo, un paquete que la base fija sombrearía el de la raíz para el código del módulo.
  const nestedInModule = dir && key === `${dir}/node_modules/${name}`
  if (nestedInModule && baseCopies.has(name) && !baseCopies.get(name).some(copy => samePins(copy, entry))) {
    problems.push({ key, reason: `sombrearía ${name}, que la base fija (${baseCopies.get(name).map(copy => copy.version).join(', ')})`, version: entry.version, resolved: origin(entry.resolved) })
    continue
  }
  // Regla 2: del registro público con integridad, o empaquetada dentro de un paquete que viene así.
  if (entry.inBundle === true && !entry.resolved && !entry.link) {
    const parent = key.slice(0, key.lastIndexOf('/node_modules/'))
    const parentEntry = afterPackages[parent]
    if (parent && parentEntry && (fromRegistry(parentEntry) || (parentEntry.inBundle === true && !parentEntry.resolved))) { added.push({ key, kind: 'bundled', in: parent, version: entry.version }); continue }
    problems.push({ key, reason: 'empaquetada dentro de algo que no viene del registro con integridad' })
    continue
  }
  if (fromRegistry(entry)) { added.push({ key, kind: 'registry', version: entry.version, resolved: entry.resolved }); continue }
  problems.push({ key, reason: entry.link ? 'un enlace a una carpeta local' : `origen no admitido (solo ${REGISTRY} con integrity)`, version: entry.version, resolved: origin(entry.resolved) })
}
// Regla 3: nada sin explicar.
if (problems.length) fail('El lock del módulo trae entradas que no se admiten', { problems, added })
const missing = stale.filter(dir => !added.some(item => item.key === dir) || !added.some(item => item.key === `node_modules/${names[dir]}`))
if (missing.length) fail('npm no dejó en el lock el módulo y su enlace', { missing })
line({ step: 'lock', status: 'ok', changed: true, workspaces: stale, added })
