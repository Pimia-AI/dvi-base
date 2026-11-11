/** Nueva: `module.json` (`docs/contrato-embebido.md` §2). La clave del módulo deja de estar fija en el código. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readManifest } from '../src/manifest'

const valid = {
  owner: 'dvi-base', key: 'dvi-base-notes', name: 'Notas', schema: 'notes', scopes: ['notes:read', 'notes:write'],
  ui: { screens: [{ id: 'notes', title: 'Notas', path: '/app/notes', menu: { group: 'Ejemplo', icon: 'notebook', order: 10 } }] },
  needs_from_pimia: [],
}

test('un module.json válido se lee tal cual', () => {
  assert.deepEqual(readManifest(valid), valid)
  assert.deepEqual(readManifest({ owner: 'o', key: 'x', name: 'X', schema: 'x' }), { owner: 'o', key: 'x', name: 'X', schema: 'x' })
})

test('lo que no cuadra no se completa: error con el campo', () => {
  const cases: [string, unknown, RegExp][] = [
    ['no es objeto', [], /objeto/],
    ['sin dueño', { ...valid, owner: undefined }, /owner/],
    ['dueño con mayúsculas', { ...valid, owner: 'Acme' }, /owner/],
    ['sin clave', { ...valid, key: undefined }, /key/],
    ['clave con mayúsculas', { ...valid, key: 'Notas' }, /key/],
    ['clave larga', { ...valid, key: 'x'.repeat(64) }, /key/],
    ['sin nombre', { ...valid, name: ' ' }, /name/],
    ['esquema public', { ...valid, schema: 'public' }, /schema/],
    ['esquema pg_', { ...valid, schema: 'pg_notes' }, /schema/],
    ['esquema con guion', { ...valid, schema: 'my-notes' }, /schema/],
    ['pantallas no lista', { ...valid, ui: { screens: {} } }, /screens/],
    ['ruta fuera de /app/', { ...valid, ui: { screens: [{ id: 'a', title: 'A', path: '/notas' }] } }, /app/],
    ['id repetido', { ...valid, ui: { screens: [{ id: 'a', title: 'A', path: '/app/a' }, { id: 'a', title: 'B', path: '/app/b' }] } }, /id/],
    ['menú incompleto', { ...valid, ui: { screens: [{ id: 'a', title: 'A', path: '/app/a', menu: { group: 'G' } }] } }, /menu/],
    ['permiso sin dos puntos', { ...valid, scopes: ['notes'] }, /scopes/],
    ['permiso repetido', { ...valid, scopes: ['notes:read', 'notes:read'] }, /scopes/],
    ['permisos no lista', { ...valid, scopes: 'notes:read' }, /scopes/],
    ['necesita_de_pimia mal', { ...valid, needs_from_pimia: [{ operation: 'x' }] }, /needs_from_pimia/],
  ]
  for (const [label, input, error] of cases) assert.throws(() => readManifest(input), error, label)
})
