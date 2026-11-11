/**
 * La base no contiene nada del dominio clínico ni del de fincas, y no depende de los ejemplos.
 * Se mira el código de `packages/` y `template/`, sin comentarios: los comentarios que dicen de qué fichero de vet sale
 * cada pieza son trazabilidad, no dominio.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DOMAIN = /mascota|paciente|vacun|veterinari|cl[ií]nic|incidencia|comunidad|finca|despacho|gremio|vecino|inmueble/i
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'packages', 'template'], { encoding: 'utf8' })
  .split('\0').filter(file => /\.(ts|tsx|mjs|css|sql|json|sh|html|yaml)$/.test(file) || file.endsWith('Dockerfile'))

/** El código sin comentarios: de línea y de bloque en TypeScript y CSS, `--` en SQL, `#` en shell, YAML y Dockerfile. */
function code(file: string): string {
  const text = readFileSync(file, 'utf8')
  if (/\.(sh|yaml)$/.test(file) || file.endsWith('Dockerfile')) return text.replace(/^\s*#.*$/gm, '')
  if (file.endsWith('.sql')) return text.replace(/--.*$/gm, '')
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1')
}

test('ni el código de packages/ ni el de template/ nombran el dominio clínico o el de fincas', () => {
  assert.ok(files.length > 30)
  const found = files.flatMap(file => code(file).split('\n').filter(text => DOMAIN.test(text)).map(text => `${file}: ${text.trim().slice(0, 100)}`))
  assert.deepEqual(found, [])
})

test('la base no importa nada de examples/', () => {
  const found = files.filter(file => /\.(ts|tsx|mjs)$/.test(file) && /from ['"][^'"]*examples\//.test(readFileSync(file, 'utf8')))
  assert.deepEqual(found, [])
})
