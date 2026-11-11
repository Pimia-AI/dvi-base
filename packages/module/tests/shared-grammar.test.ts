/**
 * La gramática común de ámbitos y pantallas con Pimia ERP (`docs/contrato-embebido.md` §2). Lee los ficheros de casos
 * que publica el ERP (copiados en `docs/contrato/`, con su procedencia en el README de esa carpeta) y comprueba caso a
 * caso `readManifest` (y con él `readUi`). La columna que manda es `erp`: con los topes ya en `readManifest`, los dos
 * lados aceptan y rechazan lo mismo. La columna `manifest` es la foto de dvi-base `087acee`, de antes de los topes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readManifest, isScope, SCOPE, SCOPE_MAX_LENGTH, SCOPES_MAX } from '../src/manifest'

const DIR = join(import.meta.dirname, '..', '..', '..', 'docs', 'contrato')
/** Las huellas de los ficheros tal como están en Pimia ERP: si cambian, cambia también el README. */
const SOURCES = {
  'module-scope-grammar.json': 'f484bf6c5d4fb8ca011f43fa76d6aac3dfd0bd15af90f6e27767b27ff2322d34',
  'module-ui-grammar.json': '148f53389951277da4437e7d1ee34e78bfeae79b89ba5e9582e0836e44c2018b',
}
const read = (name: keyof typeof SOURCES) => {
  const bytes = readFileSync(join(DIR, name))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SOURCES[name], `${name} no es la copia del ERP`)
  return JSON.parse(bytes.toString('utf8'))
}
const scopeGrammar = read('module-scope-grammar.json') as {
  pattern: string; max_length: number; max_count: number; cases: { value: string; erp: boolean; manifest: boolean; note?: string }[]
}
const uiGrammar = read('module-ui-grammar.json') as {
  limits: { max_screens: number; id: string; title_max: number; path: string; path_max: number; menu_group_max: number; menu_icon: string; menu_order: [number, number] }
  cases: { screen: Record<string, unknown>; erp: boolean; manifest: boolean; note?: string }[]
}

const base = { owner: 'dvi-base', key: 'dvi-base-notes', name: 'Notas', schema: 'notes' }
const accepts = (input: unknown) => { try { readManifest(input); return true } catch { return false } }
const label = (value: unknown, note?: string) => `${JSON.stringify(value)}${note ? ` (${note})` : ''}`

test('ámbitos: los casos compartidos con el ERP, uno a uno, dan lo mismo que el ERP', () => {
  assert.equal(scopeGrammar.cases.length, 20)
  for (const { value, erp, note } of scopeGrammar.cases) {
    assert.equal(accepts({ ...base, scopes: [value] }), erp, `readManifest ${label(value, note)}`)
    assert.equal(isScope(value), erp, `isScope ${label(value, note)}`)
  }
})

test('ámbitos: el patrón y los topes del fichero son los de manifest.ts', () => {
  assert.equal(SCOPE.source, scopeGrammar.pattern)
  assert.equal(SCOPE.flags, '', 'sin la bandera m: $ es fin absoluto')
  assert.equal(SCOPE_MAX_LENGTH, scopeGrammar.max_length)
  assert.equal(SCOPES_MAX, scopeGrammar.max_count)
  const many = (n: number) => Array.from({ length: n }, (_, i) => `scope-${i}:read`)
  assert.equal(accepts({ ...base, scopes: many(scopeGrammar.max_count) }), true, `${scopeGrammar.max_count} ámbitos`)
  assert.equal(accepts({ ...base, scopes: many(scopeGrammar.max_count + 1) }), false, `${scopeGrammar.max_count + 1} ámbitos`)
})

test('pantallas: los casos compartidos con el ERP, uno a uno, dan lo mismo que el ERP', () => {
  assert.equal(uiGrammar.cases.length, 19)
  for (const { screen, erp, note } of uiGrammar.cases) {
    assert.equal(accepts({ ...base, ui: { screens: [screen] } }), erp, `readManifest ${label(screen, note)}`)
  }
})

test('pantallas: los topes del fichero, justo en el límite y uno más', () => {
  const { limits } = uiGrammar
  const screen = (extra: Record<string, unknown> = {}, menu?: Record<string, unknown>) =>
    ({ id: 'notes', title: 'Notas', path: '/app/notes', ...(menu ? { menu: { group: 'Ejemplo', icon: 'notebook', ...menu } } : {}), ...extra })
  const ok = (screens: unknown[]) => accepts({ ...base, ui: { screens } })
  const path = (length: number) => `/app/${'a'.repeat(length - '/app/'.length)}`
  const screens = (n: number) => Array.from({ length: n }, (_, i) => screen({ id: `s${i}`, path: `/app/s${i}` }))

  assert.equal(ok(screens(limits.max_screens)), true, `${limits.max_screens} pantallas`)
  assert.equal(ok(screens(limits.max_screens + 1)), false, `${limits.max_screens + 1} pantallas`)
  // El título se cuenta en caracteres, como `mb_strlen` del ERP: 60 notas musicales (dos unidades UTF-16 cada una) caben.
  assert.equal(ok([screen({ title: '𝄞'.repeat(limits.title_max) })]), true, 'título de 60 caracteres fuera del plano básico')
  assert.equal(ok([screen({ title: 'T'.repeat(limits.title_max + 1) })]), false, 'título de 61')
  assert.equal(ok([screen({ path: path(limits.path_max) })]), true, 'ruta de 200')
  assert.equal(ok([screen({ path: path(limits.path_max + 1) })]), false, 'ruta de 201')
  assert.equal(ok([screen({}, { group: 'G'.repeat(limits.menu_group_max) })]), true, 'grupo de 40')
  assert.equal(ok([screen({}, { group: 'G'.repeat(limits.menu_group_max + 1) })]), false, 'grupo de 41')
  const [min, max] = limits.menu_order
  for (const order of [min, max]) assert.equal(ok([screen({}, { order })]), true, `order ${order}`)
  for (const order of [min - 1, max + 1]) assert.equal(ok([screen({}, { order })]), false, `order ${order}`)
  assert.equal(ok([screen({}, { icon: 'i'.repeat(40) })]), true, 'icono de 40')
  assert.equal(ok([screen({}, { icon: 'i'.repeat(41) })]), false, 'icono de 41')
})

test('pantallas: los patrones del fichero son los de readUi, y solo admite sus campos (como el ERP)', () => {
  const { limits } = uiGrammar
  const screen = { id: 'notes', title: 'Notas', path: '/app/notes' }
  // Los patrones del fichero, probados contra readUi con valores que los separan de los vecinos.
  for (const [id, expected] of [['a', true], ['a'.repeat(41), true], ['a'.repeat(42), false], ['a-1', true], ['a_1', false]] as const) {
    assert.equal(new RegExp(limits.id).test(id), expected, `patrón id ${id}`)
    assert.equal(accepts({ ...base, ui: { screens: [{ ...screen, id }] } }), expected, `readUi id ${id}`)
  }
  assert.equal(accepts({ ...base, ui: { screens: [screen], menu: [] } }), false, 'ui con algo más que screens')
  assert.equal(accepts({ ...base, ui: { screens: [{ ...screen, url: 'https://x.test' }] } }), false, 'pantalla con url')
  assert.equal(accepts({ ...base, ui: { screens: [{ ...screen, origin: 'https://x.test' }] } }), false, 'pantalla con origin')
  assert.equal(accepts({ ...base, ui: { screens: [{ ...screen, menu: { group: 'G', icon: 'notebook', color: 'red' } }] } }), false, 'menú con color')
  assert.equal(accepts({ ...base, ui: [] }), false, 'ui: []')
})
