/**
 * Las reglas de `module-lock` frente a lo que puede declarar el `package.json` de un módulo. Regresión de una revisión:
 * un módulo que declaraba `@dvi-base/module` desde otro tarball (`file:` o `http://` ajeno al registro) instalaba una
 * copia anidada en `examples/<clave>/node_modules/@dvi-base/module` que sombreaba el runtime de la base para su código;
 * `module-lock` y `npm ci` salían con 0 y la salida no la mencionaba. Ahora falla. Las dependencias legítimas nuevas,
 * del registro público con integridad, siguen pasando y salen en la lista.
 *
 * Cada caso trabaja sobre su propia copia intacta de la base, con el módulo creado por `new-module` en `examples/`.
 */
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, jsonLines, snapshot } from './helpers'

const KEY = 'lock-review'
const DIR = `examples/${KEY}`
const work = mkdtempSync(join(tmpdir(), 'dvi-module-lock-'))
after(() => rmSync(work, { recursive: true, force: true }))

/** Un paquete de prueba empaquetado con `npm pack`: devuelve la ruta del .tgz. */
function pack(name: string, version: string, marker: string): string {
  const dir = join(work, 'packages', `${name.replace(/[@/]/g, '_')}-${version}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), `module.exports = { reviewMarker: ${JSON.stringify(marker)} }\n`)
  const file = spawnSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: dir, encoding: 'utf8' }).stdout.trim().split('\n').at(-1) ?? ''
  return join(work, file)
}

let cases = 0
/** Una base intacta con el módulo nuevo; `edit` cambia su package.json y puede dejar ficheros en su carpeta. */
function moduleBase(edit: (pkg: Record<string, any>, moduleDir: string) => void): string {
  const base = snapshot(join(work, `base-${++cases}`))
  const created = spawnSync(process.execPath, ['packages/module/bin/new-module.mjs', KEY, '--owner', 'acme', '--no-install'], { cwd: base, encoding: 'utf8' })
  assert.equal(created.status, 0, created.stdout)
  const file = join(base, DIR, 'package.json'), pkg = JSON.parse(readFileSync(file, 'utf8'))
  edit(pkg, join(base, DIR))
  writeFileSync(file, JSON.stringify(pkg, null, 2))
  return base
}

/** `module-lock` sin bloquear el proceso (el caso HTTP necesita que el servidor de prueba responda mientras tanto). */
function moduleLock(base: string): Promise<{ code: number | null, result: any }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['packages/module/bin/module-lock.mjs'], { cwd: base })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.on('close', code => resolve({ code, result: jsonLines(out).at(-1) }))
  })
}
const keys = (items: Array<{ key: string }> = []) => items.map(item => item.key)

let server: Server, port = 0
const served = new Map<string, string>()
before(async () => {
  server = createServer((request, response) => {
    const file = served.get(request.url ?? '')
    if (!file) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as { port: number }).port
})
after(() => server?.close())

test('regresión: @dvi-base/module desde un tarball file: no sombrea el runtime de la base', async () => {
  const tarball = pack('@dvi-base/module', '99.0.0', 'REPLACED_RUNTIME')
  const base = moduleBase((pkg, dir) => {
    writeFileSync(join(dir, 'dvi-base-module-99.0.0.tgz'), readFileSync(tarball))
    pkg.dependencies['@dvi-base/module'] = 'file:./dvi-base-module-99.0.0.tgz'
  })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 1, JSON.stringify(result))
  assert.ok(keys(result.problems).includes(`${DIR}/node_modules/@dvi-base/module`), JSON.stringify(result.problems))
  // Y `npm ci` no llega a ver ese lock: el Dockerfile encadena `module-lock && npm ci`.
})

test('regresión: @dvi-base/module desde un http:// ajeno al registro tampoco pasa', async () => {
  served.set('/dvi-base-module-99.0.0.tgz', pack('@dvi-base/module', '99.0.0', 'REPLACED_RUNTIME'))
  const base = moduleBase(pkg => { pkg.dependencies['@dvi-base/module'] = `http://127.0.0.1:${port}/dvi-base-module-99.0.0.tgz` })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 1, JSON.stringify(result))
  assert.ok(keys(result.problems).includes(`${DIR}/node_modules/@dvi-base/module`), JSON.stringify(result.problems))
})

test('una dependencia nueva desde un http:// ajeno al registro no pasa, aunque no se llame como nada de la base', async () => {
  served.set('/review-helper-1.0.0.tgz', pack('review-helper', '1.0.0', 'FROM_ELSEWHERE'))
  const base = moduleBase(pkg => { pkg.dependencies['review-helper'] = `http://127.0.0.1:${port}/review-helper-1.0.0.tgz` })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 1, JSON.stringify(result))
  const problem = result.problems.find((item: { key: string }) => item.key.endsWith('node_modules/review-helper'))
  assert.match(problem?.reason ?? '', /origen no admitido/)
  assert.match(problem?.resolved ?? '', /^http:\/\/127\.0\.0\.1:\d+\/review-helper-1\.0\.0\.tgz$/)
})

test('una carpeta local (file: a un directorio) no pasa: es un enlace', async () => {
  const base = moduleBase((pkg, dir) => {
    mkdirSync(join(dir, 'local-lib'))
    writeFileSync(join(dir, 'local-lib', 'package.json'), JSON.stringify({ name: 'local-lib', version: '1.0.0' }))
    pkg.dependencies['local-lib'] = 'file:./local-lib'
  })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 1, JSON.stringify(result))
  assert.ok(keys(result.problems).some(key => key.endsWith('local-lib')), JSON.stringify(result.problems))
})

test('otra versión de un paquete que la base fija, aunque venga del registro, no sombrea la de la base', async () => {
  const base = moduleBase(pkg => { pkg.dependencies.react = '19.0.0' })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 1, JSON.stringify(result))
  const problem = result.problems.find((item: { key: string }) => item.key === `${DIR}/node_modules/react`)
  assert.match(problem?.reason ?? '', /sombrearía react/)
})

test('el paquete del módulo se llama @dvi-modules/<clave>: no puede hacerse pasar por uno de la base', async () => {
  const base = moduleBase(pkg => { pkg.name = '@dvi-base/kit' })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 1, JSON.stringify(result))
})

test('una dependencia legítima nueva del registro público pasa, sale en la lista con su origen y npm ci instala', async () => {
  const base = moduleBase(pkg => { pkg.dependencies.ms = '2.1.3' })
  const { code, result } = await moduleLock(base)
  assert.equal(code, 0, JSON.stringify(result))
  assert.deepEqual(result.workspaces, [DIR])
  const ms = result.added.find((item: { key: string }) => item.key === 'node_modules/ms')
  assert.equal(ms?.kind, 'registry'); assert.equal(ms?.version, '2.1.3'); assert.match(ms?.resolved, /^https:\/\/registry\.npmjs\.org\/ms\/-\/ms-2\.1\.3\.tgz$/)
  assert.ok(keys(result.added).includes(DIR)); assert.ok(keys(result.added).includes(`node_modules/@dvi-modules/${KEY}`))
  // Todo lo nuevo del lock sale en la lista: no queda ninguna entrada sin explicar.
  const pristine = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')).packages
  const now = JSON.parse(readFileSync(join(base, 'package-lock.json'), 'utf8')).packages
  assert.deepEqual(Object.keys(now).filter(key => !(key in pristine)).sort(), keys(result.added).sort())
  const ci = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: base, encoding: 'utf8' })
  assert.equal(ci.status, 0, ci.stderr)
})
