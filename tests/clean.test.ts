import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
/**
 * El nombre del backend que salió del ecosistema no aparece en el repo (los documentos internos que lo nombraban se
 * retiraron antes de publicarlo). El patrón se compone para que
 * esta prueba no se cuente a sí misma.
 */
const FORBIDDEN = new RegExp(['ins', 'forge'].join(''), 'i')
const EXCEPTIONS = new Set<string>()

function repoFiles(): string[] {
  const outfile = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  return outfile.split('\0').filter(Boolean)
}

test('nada del backend retirado en el repo', () => {
  const files = repoFiles()
  assert.ok(files.length > 0)
  const found = files
    .filter(file => !EXCEPTIONS.has(file))
    .filter(file => FORBIDDEN.test(file) || FORBIDDEN.test(readFileSync(file, 'utf8')))
  assert.deepEqual(found, [])
})
