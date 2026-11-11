/**
 * Los componentes del kit, pintados a HTML en el servidor (sin navegador): marcado accesible, estados y textos. Y la
 * regla de taskai.work que el kit hace cumplir: ningún color literal fuera de `styles.css`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, DataTable, Field, TextInput, ChoiceGroup, CountTabs, ModuleErrorState, StatusBadge, PageHeader, EmptyState } from '../src/index'

test('el botón primario es la acción negra; ocupado, deshabilitado y con aria-busy', () => {
  const html = renderToStaticMarkup(<Button>Guardar</Button>)
  assert.match(html, /type="button"/); assert.match(html, /bg-primary text-primary-foreground/)
  const busy = renderToStaticMarkup(<Button loading>Guardar</Button>)
  assert.match(busy, /disabled=""/); assert.match(busy, /aria-busy="true"/); assert.match(busy, /animate-spin/)
  assert.match(renderToStaticMarkup(<Button variant="danger">Borrar</Button>), /text-destructive/)
})

test('la cabecera: un h1, la descripción y las acciones', () => {
  const html = renderToStaticMarkup(<PageHeader title="Notas" description="Lo que apunta la empresa." actions={<Button>Nueva nota</Button>} back={{ label: 'Volver', href: '/app/notes' }} />)
  assert.match(html, /<h1[^>]*>Notas<\/h1>/); assert.match(html, /Lo que apunta la empresa\./); assert.match(html, /href="\/app\/notes"/)
})

test('un campo une etiqueta, ayuda y error con su control', () => {
  const html = renderToStaticMarkup(<Field label="Título" hint="Hasta 120 caracteres." error="Obligatorio.">{props => <TextInput {...props} />}</Field>)
  const id = /<label for="([^"]+)"/.exec(html)![1]
  assert.match(html, new RegExp(`<input[^>]*id="${id}"`))
  assert.match(html, new RegExp(`aria-describedby="${id}-hint ${id}-error"`))
  assert.match(html, /aria-invalid="true"/); assert.match(html, /Obligatorio\./)
  assert.doesNotMatch(renderToStaticMarkup(<Field label="Texto">{props => <TextInput {...props} />}</Field>), /aria-invalid="/)
})

test('opciones, pestañas y estado: radios con nombre, tablist con aria-selected y estado con texto', () => {
  const choice = renderToStaticMarkup(<ChoiceGroup name="canal" label="Canal" value="b" onChange={() => {}} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />)
  assert.match(choice, /role="radiogroup"/); assert.equal((choice.match(/type="radio"/g) ?? []).length, 2); assert.match(choice, /checked="" value="b"/)
  const tabs = renderToStaticMarkup(<CountTabs label="Filtrar" value="open" onChange={() => {}} tabs={[{ id: 'open', label: 'Abiertas', count: 4 }, { id: 'all', label: 'Todas', count: 5 }]} />)
  assert.match(tabs, /role="tablist"/); assert.match(tabs, /aria-selected="true"[^>]*>Abiertas/); assert.match(tabs, /tabular-nums">4</)
  assert.match(renderToStaticMarkup(<StatusBadge tone="warning">Parada</StatusBadge>), /text-warning[\s\S]*Parada/)
})

test('la tabla: cabeceras con scope, filas, y el vacío cuando no hay filas', () => {
  const columns = [{ key: 't', header: 'Título', cell: (row: { id: string; t: string }) => row.t }, { key: 'x', header: 'Extra', cell: () => '·', secondary: true }]
  const html = renderToStaticMarkup(<DataTable caption="Notas" columns={columns} rows={[{ id: '1', t: 'Uno' }, { id: '2', t: 'Dos' }]} rowKey={r => r.id} onRowClick={() => {}} />)
  assert.match(html, /<caption class="sr-only">Notas<\/caption>/); assert.match(html, /<th scope="col"/); assert.match(html, /tabindex="0"/)
  assert.equal((html.match(/<tr /g) ?? []).length, 3); assert.match(html, /hidden md:table-cell/)
  const empty = renderToStaticMarkup(<DataTable caption="Notas" columns={columns} rows={[]} rowKey={r => r.id} empty={<EmptyState title="Aún no hay notas" />} />)
  assert.match(empty, /Aún no hay notas/); assert.doesNotMatch(empty, /<table/)
})

test('cada error del módulo dice qué pasa y qué hacer, con su código a la vista', () => {
  const notInPlan = renderToStaticMarkup(<ModuleErrorState error={{ status: 403, code: 'not_in_plan' }} onRetry={() => {}} />)
  assert.match(notInPlan, /Esta empresa no tiene este módulo/); assert.match(notInPlan, /403 · not_in_plan/)
  assert.doesNotMatch(notInPlan, /Reintentar/, 'reintentar no arregla un plan')
  const down = renderToStaticMarkup(<ModuleErrorState error={{ status: 503, code: 'pimia_unavailable' }} onRetry={() => {}} />)
  assert.match(down, /No se pudo comprobar tu sesión con Pimia/); assert.match(down, /Reintentar/)
  assert.match(renderToStaticMarkup(<ModuleErrorState error={{ code: 'raro' }} />), /Algo ha fallado/)
})

test('ningún color literal en los componentes: solo tokens semánticos (los literales viven en styles.css)', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'components')
  const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|shadow|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/
  for (const file of readdirSync(dir)) {
    const source = readFileSync(join(dir, file), 'utf8')
    assert.doesNotMatch(source, literal, file)
  }
})
