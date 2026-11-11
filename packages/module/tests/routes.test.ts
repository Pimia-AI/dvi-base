/**
 * Portada de las pruebas de una vertical anterior en producción. Cambia: la tabla es la del módulo de ejemplo
 * (`/api/notes` en lugar de `/api/clinica/mascotas`), `/readyz` se conserva (ahora mira el historial de migraciones) y la base añade `/api/version`; la
 * prueba de la app (96-103) no se porta. Nueva: una tabla de dominio mal formada no se acepta.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouteTable, MODULE_HEADERS, type RouteDef } from '../src/routes'
import { routes } from './example/module'
import { ID as id, RID as rid } from './helpers'

const table = createRouteTable(routes)
const resolveRoute = table.resolve
const OTHER_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND']
const TABLE: [string, string[], string, Record<string, string>][] = [
  ['/healthz', ['GET'], 'healthz', {}],
  ['/readyz', ['GET'], 'readyz', {}],
  ['/api/version', ['GET'], 'version', {}],
  ['/api/session', ['GET'], 'session', {}],
  ['/api/notes', ['GET', 'POST'], 'notes', {}],
  [`/api/notes/${id}`, ['GET', 'PUT'], 'note', { noteId: id }],
  [`/api/notes/${id}/comments`, ['GET', 'POST'], 'comments', { noteId: id }],
  [`/api/notes/${id}/comments/${rid}`, ['PUT'], 'comment', { noteId: id, itemId: rid }],
  [`/api/notes/${id}/tags`, ['GET', 'POST'], 'tags', { noteId: id }],
  [`/api/notes/${id}/tags/${rid}`, ['PUT'], 'tag', { noteId: id, itemId: rid }],
]

test('la tabla cerrada: cada ruta con sus métodos; con otro método, 405 con Allow', () => {
  assert.deepEqual(table.routes.map(route => [route.path, [...route.methods]]), [
    ['/healthz', ['GET']], ['/readyz', ['GET']], ['/api/version', ['GET']], ['/api/session', ['GET']],
    ['/api/notes', ['GET', 'POST']], ['/api/notes/:noteId', ['GET', 'PUT']],
    ['/api/notes/:noteId/comments', ['GET', 'POST']], ['/api/notes/:noteId/comments/:itemId', ['PUT']],
    ['/api/notes/:noteId/tags', ['GET', 'POST']], ['/api/notes/:noteId/tags/:itemId', ['PUT']],
  ])
  for (const [path, methods, route, params] of TABLE) {
    for (const method of methods) assert.deepEqual(resolveRoute(method, path), { status: 200, route, method, params, path, search: '' }, `${method} ${path}`)
    // HEAD, OPTIONS, TRACE, DELETE, PATCH y cualquier otro: la ruta existe, el método no.
    for (const method of OTHER_METHODS.filter(m => !methods.includes(m))) assert.deepEqual(resolveRoute(method, path), { status: 405, allow: methods.join(', ') }, `${method} ${path}`)
    // Los métodos se comparan tal cual: en minúsculas no son los de la tabla.
    assert.equal(resolveRoute(methods[0].toLowerCase(), path).status, 405, path)
  }
})

test('la query llega intacta al handler; la ruta es lo que va antes del primer ?', () => {
  assert.deepEqual(resolveRoute('GET', '/api/notes?page=2&search=luna'), { status: 200, route: 'notes', method: 'GET', params: {}, path: '/api/notes', search: '?page=2&search=luna' })
  assert.equal((resolveRoute('GET', '/api/notes?') as { search: string }).search, '?')
  // Lo de después del ? no cuenta como ruta, aunque lleve barras o puntos.
  assert.deepEqual(resolveRoute('GET', '/healthz?x=/../api/notes'), { status: 200, route: 'healthz', method: 'GET', params: {}, path: '/healthz', search: '?x=/../api/notes' })
  assert.deepEqual(resolveRoute('GET', '/api/notes/x?/comments'), { status: 200, route: 'note', method: 'GET', params: { noteId: 'x' }, path: '/api/notes/x', search: '?/comments' })
})

test('los segmentos variables se decodifican para el handler, que valida el id', () => {
  // Un id que no es UUID casa: lo rechaza su handler con su 404 en JSON, después de la sesión. `.rsc` no significa nada aquí.
  assert.deepEqual(resolveRoute('GET', '/api/notes/no-es-un-uuid'), { status: 200, route: 'note', method: 'GET', params: { noteId: 'no-es-un-uuid' }, path: '/api/notes/no-es-un-uuid', search: '' })
  assert.deepEqual((resolveRoute('GET', `/api/notes/${id}.rsc`) as { params: unknown }).params, { noteId: `${id}.rsc` })
  const encoded = resolveRoute('PUT', `/api/notes/a%20b/tags/${rid.toUpperCase()}`)
  assert.deepEqual(encoded, { status: 200, route: 'tag', method: 'PUT', params: { noteId: 'a b', itemId: rid.toUpperCase() }, path: `/api/notes/a%20b/tags/${rid.toUpperCase()}`, search: '' })
  // La ruta que ve el handler se recodifica desde lo decodificado, sin barras ni puntos nuevos.
  assert.equal((resolveRoute('GET', '/api/notes/a%2Fb') as { path: string }).path, '/api/notes/a%2Fb')
  assert.deepEqual((resolveRoute('GET', '/api/notes/a%2Fb') as { params: unknown }).params, { noteId: 'a/b' })
})

test('todo lo demás es 404, sin normalizar nada: ni páginas, ni lo que un framework desenvuelve, ni parecidos', () => {
  const notFound = [
    // Lo que un framework web convertiría (RSC, datos, estáticos) y páginas que aquí no existen.
    '/healthz.rsc', '/api/notes.rsc', `/api/notes/${id}/comments.rsc`, '/_next/data/x/healthz.json', '/_next/static/chunks/a.js', '/_next/image',
    '/_next/image?url=%2Fui-assets%2Finter&w=640&q=75', '/favicon.ico', '/ui-assets/styles', '/', '/instalar', '/auth/login', '/auth/callback',
    '/empresas', '/notas/1', '/integraciones/pimia/webhook',
    // Barra final, barras dobles e invertidas.
    '/healthz/', '/readyz/', '/api/version/', '/api/notes/', `/api/notes/${id}/`, `/api/notes/${id}/comments/`, '//instalar', '//healthz',
    '/api\\notas', '/api\\notas\\x', '\\healthz',
    // Segmentos punto, escritos o codificados, y escapes que no se pueden decodificar.
    '/api/notes/.', '/api/notes/..', '/api/notes/%2e%2e', '/api/notes/%2E%2E', '/api/notes/.%2e',
    '/api/notes/%2e', `/api/notes/${id}/comments/..`, '/api/notes/%2e%2e/comments', '/api/./notas', '/api/notes/../notas',
    '/api/notes/%zz', '/api/notes/%', '/api/notes/%e0%a4%a', `/api/notes/${id}/tags/%zz`,
    // Segmentos fijos que no se decodifican para casar.
    '/%68ealthz', '/healthz%2F', '/api/%6Eotas', '/api%2Fnotas',
    // Segmentos vacíos.
    '/api//notas', '/api/notes//comments', `/api/notes/${id}//`, '',
    // Mayúsculas.
    '/HEALTHZ', '/Healthz', '/Listo', '/api/Version', '/API/notas', '/api/Notas', `/api/notes/${id}/Comentarios`, `/api/notes/${id}/ETIQUETAS/${rid}`,
    // Parámetros con punto y coma.
    '/healthz;x', '/api/notes;x', `/api/notes/${id}/comments;x`,
    // Subrutas que no existen.
    '/api', '/api/nada', '/api/notess', '/api/notes/x/y/z/w', `/api/notes/${id}/historial`,
    `/api/notes/${id}/comments/${rid}/extra`, `/api/notes/${id}/tags/${rid}/x`, '/healthz/x', '/readyz/x', '/api/version/x', '/api/versions', '/listo', '/healthzx', '/healthz#x',
    // Ni `*` ni la forma absoluta.
    '*', 'http://evil.example/healthz', 'https://evil.example/api/notes', 'healthz', '?/healthz',
  ]
  for (const path of notFound) for (const method of OTHER_METHODS) assert.deepEqual(resolveRoute(method, path), { status: 404 }, `${method} ${JSON.stringify(path)}`)
})

test('las cabeceras del módulo: sin documentos, sin caché y sin HSTS', () => {
  assert.deepEqual({ ...MODULE_HEADERS }, {
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  })
  assert.ok(Object.isFrozen(MODULE_HEADERS))
})

test('nueva: una tabla de dominio mal formada no se acepta', () => {
  const bad: [string, RouteDef[]][] = [
    ['fuera de /api/', [{ name: 'x', path: '/notas', methods: ['GET'] }]],
    ['ruta de la base', [{ name: 'x', path: '/healthz', methods: ['GET'] }]],
    ['ruta de la base bajo /api/', [{ name: 'x', path: '/api/version', methods: ['GET'] }]],
    ['nombre repetido con la base', [{ name: 'healthz', path: '/api/x', methods: ['GET'] }]],
    ['nombre repetido', [{ name: 'x', path: '/api/a', methods: ['GET'] }, { name: 'x', path: '/api/b', methods: ['GET'] }]],
    ['ruta repetida', [{ name: 'a', path: '/api/a', methods: ['GET'] }, { name: 'b', path: '/api/a', methods: ['POST'] }]],
    ['sin métodos', [{ name: 'x', path: '/api/x', methods: [] }]],
    ['método repetido', [{ name: 'x', path: '/api/x', methods: ['GET', 'GET'] }]],
    ['método no admitido', [{ name: 'x', path: '/api/x', methods: ['DELETE' as 'GET'] }]],
    ['primer segmento variable', [{ name: 'x', path: '/api/:id', methods: ['GET'] }]],
    ['mayúsculas', [{ name: 'x', path: '/api/Notas', methods: ['GET'] }]],
    ['segmento vacío', [{ name: 'x', path: '/api//x', methods: ['GET'] }]],
    ['barra final', [{ name: 'x', path: '/api/x/', methods: ['GET'] }]],
    ['punto', [{ name: 'x', path: '/api/x.json', methods: ['GET'] }]],
    ['parámetro repetido', [{ name: 'x', path: '/api/x/:id/y/:id', methods: ['GET'] }]],
    ['nombre no camelCase', [{ name: 'Mal-Nombre', path: '/api/x', methods: ['GET'] }]],
  ]
  for (const [label, routes] of bad) assert.throws(() => createRouteTable(routes), Error, label)
  assert.doesNotThrow(() => createRouteTable([{ name: 'x', path: '/api/x/:id/y-z', methods: ['GET', 'PUT'] }]))
})
