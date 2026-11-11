/** Nueva: la orden `dvi-module` (el arranque local de un módulo). Lo que se puede probar sin Docker. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BIN = join(import.meta.dirname, '..', 'bin', 'dvi-module.mjs')
const dir = mkdtempSync(join(tmpdir(), 'dvi-cli-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const run = (args: string[], cwd = dir) => {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' })
  return { code: result.status, lines: result.stdout.trim().split('\n').filter(Boolean).map(text => JSON.parse(text)) }
}

test('sin orden o con una desconocida: código 2 y el uso, en una línea JSON', () => {
  for (const args of [[], ['arrancar']]) {
    const { code, lines } = run(args)
    assert.equal(code, 2)
    assert.equal(lines[0].status, 'error'); assert.match(lines[0].message, /up \| down \| doctor \| image/)
  }
})

test('fuera de la carpeta de un módulo, up falla en config y no toca Docker; doctor lo dice campo a campo', () => {
  const up = run(['up'])
  assert.equal(up.code, 1)
  assert.deepEqual(up.lines.map(l => [l.step, l.status]), [['config', 'error']])
  writeFileSync(join(dir, 'module.json'), JSON.stringify({ key: 'Mal', schema: 'x' }))
  const bad = run(['up'])
  assert.match(bad.lines[0].message, /key o schema/)
  const doctor = run(['doctor'])
  assert.equal(doctor.code, 1)
  assert.equal(doctor.lines[0].check, 'module.json'); assert.equal(doctor.lines[0].status, 'error')
  assert.deepEqual(doctor.lines.at(-1), { result: 'error' })
})
