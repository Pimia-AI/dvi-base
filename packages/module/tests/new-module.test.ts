/** Nueva: `new-module` crea un módulo desde `template/` (criterio 2). Aquí, en un repo temporal y sin `npm install`. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { readManifest } from '../src/manifest'

const BIN = join(import.meta.dirname, '..', 'bin', 'new-module.mjs')
const root = mkdtempSync(join(tmpdir(), 'dvi-new-'))
writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'repo', private: true, workspaces: ['packages/*', 'examples/*'] }))
after(() => rmSync(root, { recursive: true, force: true }))
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [BIN, ...args, '--root', root, '--no-install'], { encoding: 'utf8' })
  return { code: result.status, lines: result.stdout.trim().split('\n').filter(Boolean).map(text => JSON.parse(text)) }
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap(entry => statSync(join(dir, entry)).isDirectory() ? walk(join(dir, entry)) : [join(dir, entry)])

test('crea el módulo con todo sustituido: clave, nombre, esquema, carpeta y paquete', () => {
  const { code, lines } = run('gestion-obras', '--name', 'Gestión de obras', '--owner', 'acme')
  assert.equal(code, 0)
  assert.deepEqual(lines[0], { step: 'template', status: 'ok', dir: 'examples/gestion-obras', owner: 'acme', key: 'gestion-obras', name: 'Gestión de obras', schema: 'gestion_obras', files: lines[0].files })
  assert.deepEqual(lines.at(-1), { result: 'ok', next: ['cd examples/gestion-obras', 'npm run up', 'npm run doctor'] })
  const dir = join(root, 'examples', 'gestion-obras')
  const files = walk(dir).map(file => relative(dir, file)).sort()
  for (const expected of ['AGENTS.md', 'README.md', '.mcp.json', '.gitignore', 'module.json', 'package.json', 'Dockerfile', 'compose.yaml', 'migrations/.gitkeep', 'seeds/.gitkeep',
    'src/server/main.ts', 'src/server/api.ts', 'src/ui/main.tsx', 'src/ui/screens.tsx', 'src/ui/index.html', 'src/ui/styles.css', 'src/ui/vite.config.ts', 'tests/module.test.ts']) {
    assert.ok(files.includes(expected), expected)
  }
  for (const file of walk(dir)) assert.doesNotMatch(readFileSync(file, 'utf8'), /__(OWNER|KEY|NAME|SCHEMA|DIR|PACKAGE)__/, file)
  const manifest = readManifest(JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8')))
  assert.equal(manifest.owner, 'acme'); assert.equal(manifest.key, 'gestion-obras'); assert.equal(manifest.schema, 'gestion_obras'); assert.equal(manifest.ui?.screens[0].path, '/app/gestion-obras')
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name, '@dvi-modules/gestion-obras')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers.dvi.headers, { Authorization: 'Bearer ${DVI_TOKEN}' })
  const compose = readFileSync(join(dir, 'compose.yaml'), 'utf8')
  assert.match(compose, /MODULE_OWNER: acme/); assert.match(compose, /^name: gestion-obras$/m); assert.match(compose, /gestion_obras_runtime:/); assert.match(compose, /dockerfile: examples\/gestion-obras\/Dockerfile/)
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /# Reglas para el agente que trabaja en el módulo «Gestión de obras»/)
})

test('no pisa un módulo que ya existe, y los nombres malos no pasan', () => {
  assert.equal(run('gestion-obras').code, 1)
  for (const bad of ['', 'A', 'Mal', '1abc', 'con_guion', 'acaba-', 'x'.repeat(41), '../fuera']) {
    const { code, lines } = run(bad)
    assert.equal(code, 2, bad); assert.equal(lines[0].step, 'name', bad)
  }
  assert.equal(existsSync(join(root, 'fuera')), false)
})

test('el nombre visible cabe en el grupo del menú (40 caracteres, la gramática común con el ERP)', () => {
  const long = run('nombre-largo', '--name', 'N'.repeat(41))
  assert.equal(long.code, 2); assert.equal(long.lines[0].step, 'name')
  assert.equal(existsSync(join(root, 'examples', 'nombre-largo')), false)
  const { code } = run('nombre-justo', '--name', 'ñ'.repeat(40))
  assert.equal(code, 0)
  assert.equal(readManifest(JSON.parse(readFileSync(join(root, 'examples', 'nombre-justo', 'module.json'), 'utf8'))).ui?.screens[0].menu?.group, 'ñ'.repeat(40))
})

test('fuera de la raíz de dvi-base no hace nada', () => {
  const other = mkdtempSync(join(tmpdir(), 'dvi-other-'))
  mkdirSync(join(other, 'x'))
  const result = spawnSync(process.execPath, [BIN, 'prueba', '--root', other, '--no-install'], { encoding: 'utf8' })
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout.trim()).step, 'root')
  assert.equal(existsSync(join(other, 'examples')), false)
  rmSync(other, { recursive: true, force: true })
})
