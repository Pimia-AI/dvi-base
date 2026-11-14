/**
 * Regresión de la prueba limpia del 14/11: el primer push de un módulo recién creado desde la plantilla tiene que
 * construir sin tocar nada a mano. Antes fallaba en `dvi-image` con `npm ci` → «Missing: @dvi-modules/<clave>@0.1.0 from
 * lock file», porque la CI mete el módulo en `examples/<clave>` sobre dvi-base recién clonado y el lock de la base solo
 * conoce sus ejemplos. Y el `.gitignore` de la plantilla ignoraba `.dvi/` entero, también `.dvi/documentos.yml`.
 *
 * Se hace lo mismo que el README y la CI de la plantilla, en carpetas temporales:
 *   1. un clon de dvi-base (el del integrador) donde `new-module` crea el módulo;
 *   2. el repositorio de la vertical: solo la carpeta del módulo, con su `.gitignore`;
 *   3. otro clon de dvi-base, intacto, con el módulo dentro como lo pone `dvi-image.yml` (`git archive HEAD`);
 *   4. lo que hace la etapa `build` del Dockerfile (`module-lock`, `npm ci`, pantallas y bundles), las pruebas del módulo y
 *      el typecheck; con `DVI_CHECK_IMAGE=1`, además, la imagen `module` con Docker, como `dvi-image.yml`.
 *
 * Necesita red (npm) y tarda: va aparte de `npm test`, con `npm run test:new-module`.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readModuleConfig } from '../packages/module/src/config'
import { jsonLines, snapshot } from './helpers'

const KEY = 'smoke-tasks'
const PACKAGE = `@dvi-modules/${KEY}`
const work = mkdtempSync(join(tmpdir(), 'dvi-first-push-'))
after(() => rmSync(work, { recursive: true, force: true }))

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  assert.equal(result.status, 0, `${command} ${args.join(' ')} (en ${cwd}):\n${output.trim().split('\n').slice(-15).join('\n')}`)
  return result.stdout
}
const lockPins = (lock: { packages: Record<string, Record<string, unknown>> }) => Object.fromEntries(Object.entries(lock.packages)
  .filter(([key]) => key !== '' && !key.startsWith('examples/') && !key.startsWith('node_modules/@dvi-modules/'))
  .map(([key, entry]) => [key, { version: entry.version, resolved: entry.resolved, integrity: entry.integrity, link: entry.link }]))
const git = ['-c', 'user.name=dvi-base', '-c', 'user.email=ci@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false']

// 1 y 2: el módulo se crea en un clon de dvi-base y su carpeta pasa a ser la raíz del repositorio de la vertical.
const dev = snapshot(join(work, 'dev'))
const created = jsonLines(run(process.execPath, ['packages/module/bin/new-module.mjs', KEY, '--owner', 'acme', '--name', 'Tareas de prueba', '--no-install'], dev))
const vertical = join(dev, 'examples', KEY)
mkdirSync(join(vertical, '.dvi'))
writeFileSync(join(vertical, '.dvi', 'documentos.yml'), 'schema_version: 1\nvertical: smoke\ndocumentos:\n  - carpeta: docs\n    tipo: otro\n')
writeFileSync(join(vertical, '.dvi', 'local.env'), 'DVI_POSTGRES_PASSWORD=solo-local\n')
writeFileSync(join(vertical, '.env'), 'DVI_RUNTIME_PASSWORD=solo-servidor\n')
run('git', [...git, 'init', '-q'], vertical)
run('git', [...git, 'add', '-A'], vertical)
run('git', [...git, 'commit', '-q', '-m', 'Módulo nuevo desde la plantilla'], vertical)
const tracked = run('git', ['ls-files'], vertical).trim().split('\n')
const revision = run('git', ['rev-parse', 'HEAD'], vertical).trim()

// 3: la base intacta, con el módulo en la carpeta que dice su dvi-image.yml.
const base = snapshot(join(work, 'base'))
const moduleDir = /^\s*MODULE_DIR: (\S+)$/m.exec(readFileSync(join(vertical, '.github', 'workflows', 'dvi-image.yml'), 'utf8'))?.[1] ?? ''
const pristineLock = JSON.parse(readFileSync(join(base, 'package-lock.json'), 'utf8'))
mkdirSync(join(base, moduleDir), { recursive: true })
run('git', ['archive', '--output', join(work, 'vertical.tar'), 'HEAD'], vertical)
run('tar', ['-xf', join(work, 'vertical.tar'), '-C', join(base, moduleDir)], base)

test('new-module crea el módulo en la carpeta en la que lo pone su CI', () => {
  assert.equal(created.at(-1).result, 'ok')
  assert.equal(moduleDir, `examples/${KEY}`)
  assert.equal(JSON.parse(readFileSync(join(base, moduleDir, 'package.json'), 'utf8')).name, PACKAGE)
  // Lo que provocaba el fallo: la base recién clonada no tiene el módulo en su lock.
  assert.equal(pristineLock.packages[moduleDir], undefined)
  // Y lo que lo resuelve en la imagen: la etapa build del Dockerfile del módulo añade el módulo al lock antes de `npm ci`
  // (la última prueba ejecuta esas mismas órdenes sin Docker).
  assert.match(readFileSync(join(base, moduleDir, 'Dockerfile'), 'utf8'), /^RUN .* node packages\/module\/bin\/module-lock\.mjs && npm ci --no-audit --no-fund$/m)
})

test('el compose del servidor admite el patrón de la guía del SaaS: con https://{tenant}.<dominio>, sin PIMIA_TENANT_ID', () => {
  const compose = readFileSync(join(base, moduleDir, 'deploy', 'compose.server.yaml'), 'utf8')
  assert.match(compose, /^\s+PIMIA_TENANT_ID: \$\{PIMIA_TENANT_ID:-\}$/m)
  const env = Object.fromEntries(readFileSync(join(base, moduleDir, '.env.example'), 'utf8').split('\n')
    .filter(text => /^[A-Z_]+=/.test(text)).map(text => [text.slice(0, text.indexOf('=')), text.slice(text.indexOf('=') + 1)]))
  assert.equal(env.PIMIA_TENANT_ID, '')
  assert.ok(readModuleConfig(env).tenantPattern, 'el .env.example arranca con el patrón')
})

test('el repositorio de la vertical versiona .dvi/documentos.yml y deja fuera los secretos locales', () => {
  assert.ok(tracked.includes('.dvi/documentos.yml'), tracked.join(', '))
  assert.ok(!tracked.includes('.dvi/local.env'))
  assert.ok(!tracked.includes('.env'))
  assert.ok(tracked.includes('.env.example'))
})

test('con DVI_CHECK_IMAGE=1, la imagen de producción construye sobre la base recién clonada, como dvi-image.yml', { skip: process.env.DVI_CHECK_IMAGE !== '1' }, () => {
  const tag = `dvi-first-push-${KEY}:${revision.slice(0, 12)}`
  run('docker', ['build', '--target', 'module', '--build-arg', `BUILD_REVISION=${revision}`, '-f', `${moduleDir}/Dockerfile`, '-t', tag, '.'], base, { DOCKER_BUILDKIT: '1' })
  try {
    assert.equal(run('docker', ['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', tag], base).trim(), revision)
  } finally {
    spawnSync('docker', ['image', 'rm', '-f', tag])
  }
})

test('la etapa build del Dockerfile pasa sin tocar nada: module-lock, npm ci, pantallas y bundles; y las pruebas del módulo', () => {
  const first = jsonLines(run(process.execPath, ['packages/module/bin/module-lock.mjs'], base)).at(-1)
  assert.equal(first.status, 'ok'); assert.equal(first.changed, true); assert.deepEqual(first.workspaces, [moduleDir])
  const lock = JSON.parse(readFileSync(join(base, 'package-lock.json'), 'utf8'))
  assert.ok(lock.packages[moduleDir]); assert.equal(lock.packages[`node_modules/${PACKAGE}`]?.link, true)
  // Lo que la base fija no se mueve: cada entrada conserva versión, origen, integridad y enlace.
  const before = lockPins(pristineLock), now = lockPins(lock)
  for (const [key, pins] of Object.entries(before)) assert.deepEqual(now[key], pins, key)
  // Con el lock ya al día no hace nada.
  assert.equal(jsonLines(run(process.execPath, ['packages/module/bin/module-lock.mjs'], base)).at(-1).changed, false)

  run('npm', ['ci', '--no-audit', '--no-fund'], base)
  run('npm', ['run', '-s', 'build:ui', '--workspace', PACKAGE], base)
  run('npm', ['run', '-s', 'build', '--workspace', '@dvi-base/dev-host'], base)
  const bundles = jsonLines(run(process.execPath, ['--import', 'tsx', 'packages/module/src/build-module.ts', moduleDir, join(work, 'out')], base)).at(-1)
  assert.equal(bundles.status, 'ok')
  for (const file of ['server.cjs', 'server-dev.cjs']) assert.ok(existsSync(join(work, 'out', file)), file)
  run('npm', ['test', '--workspace', PACKAGE], base)
  run('npm', ['run', '-s', 'typecheck'], base)
})
