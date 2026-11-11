/** La configuración del módulo es válida: `module.json`, la tabla de rutas y un handler por cada ruta y método. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModuleServer } from '@dvi-base/module'
import { handlers, manifest, routes } from '../src/server/api'

test('module.json es válido y declara la pantalla de entrada', () => {
  assert.equal(manifest.key, '__KEY__')
  assert.ok(manifest.ui?.screens.length)
})

test('la tabla de rutas y sus handlers casan (si no, el módulo no arrancaría)', () => {
  assert.doesNotThrow(() => createModuleServer({ routes, handlers }))
})
