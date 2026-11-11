import {
  scopeOf, createModuleDeps, isUuid, json, modulePool, ModuleHttpError, readJson, readManifest, withModule,
  type Handler, type HandlersFor, type RouteDef,
} from '../../src/index'
import { NotesRepository, validateNote } from './notes'
/**
 * El dominio neutro de las pruebas de la base: «notas», con la misma forma de rutas que tenía la clínica de vet
 * (pacientes → notas, consultas → comentarios, vacunas → etiquetas), para que las pruebas portadas sean fieles. Las
 * notas van a la base, como los pacientes de vet (`pacientes-http.ts`); comentarios y etiquetas solo pasan por la
 * sesión y devuelven lo que ven.
 */
export const manifest = readManifest({ owner: 'dvi-base', key: 'dvi-base-notes', name: 'Notas', schema: 'notes', scopes: ['notes:read', 'notes:write'] })

export const routes = [
  { name: 'notes', path: '/api/notes', methods: ['GET', 'POST'] },
  { name: 'note', path: '/api/notes/:noteId', methods: ['GET', 'PUT'] },
  { name: 'comments', path: '/api/notes/:noteId/comments', methods: ['GET', 'POST'] },
  { name: 'comment', path: '/api/notes/:noteId/comments/:itemId', methods: ['PUT'] },
  { name: 'tags', path: '/api/notes/:noteId/tags', methods: ['GET', 'POST'] },
  { name: 'tag', path: '/api/notes/:noteId/tags/:itemId', methods: ['PUT'] },
] as const satisfies readonly RouteDef[]

const deps = createModuleDeps(manifest)
/** Ver notas pide `notes:read`; crearlas o editarlas, `notes:write` (los da Pimia ERP por rol en el token de módulo). */
const READ = { scope: 'notes:read' }, WRITE = { scope: 'notes:write' }
const repository = (session: Parameters<typeof scopeOf>[0]) => new NotesRepository(modulePool(), scopeOf(session))
const notFound = () => new ModuleHttpError(404, 'not_found', 'No existe esa nota en esta empresa.')
const values = (body: unknown) => {
  const checked = validateNote(body)
  if ('errors' in checked) throw new ModuleHttpError(422, 'validation', 'Revisa los campos indicados.', checked.errors as Record<string, string>)
  return checked.values
}

const listNotes: Handler = request => withModule(request, deps, async session => {
  const params = new URL(request.url).searchParams
  const page = params.has('page') ? Number(params.get('page')) : 1
  const { notes, nextPage } = await repository(session).list(page, params.get('search') ?? '')
  return json({ data: notes, meta: { page, next_page: nextPage } })
}, READ)
const createNote: Handler = request => withModule(request, deps, async session => {
  const body = await readJson(request)
  if (!isUuid(body.id)) throw new ModuleHttpError(422, 'validation', 'Falta el id de la nota.', { id: 'Obligatorio.' })
  return json({ data: await repository(session).create(body.id, values(body), session.userId) }, 201)
}, WRITE)
const getNote: Handler = (request, { noteId }) => withModule(request, deps, async session => {
  if (!isUuid(noteId)) throw notFound()
  const note = await repository(session).get(noteId)
  if (!note) throw notFound()
  return json({ data: note })
}, READ)
const updateNote: Handler = (request, { noteId }) => withModule(request, deps, async session => {
  if (!isUuid(noteId)) throw notFound()
  const body = await readJson(request)
  const version = Number(body.version)
  if (!Number.isSafeInteger(version) || version < 1) throw new ModuleHttpError(422, 'validation', 'Falta la versión de la nota.', { version: 'Obligatorio.' })
  const note = await repository(session).update(noteId, version, values(body))
  if (!note) throw notFound()
  return json({ data: note })
}, WRITE)
const echoWithSession = (route: string): Handler => (request, params) =>
  withModule(request, deps, async session => json({ data: { route, method: request.method, params, session } }))

export const handlers: HandlersFor<typeof routes> = {
  notes: { GET: listNotes, POST: createNote },
  note: { GET: getNote, PUT: updateNote },
  comments: { GET: echoWithSession('comments'), POST: echoWithSession('comments') },
  comment: { PUT: echoWithSession('comment') },
  tags: { GET: echoWithSession('tags'), POST: echoWithSession('tags') },
  tag: { PUT: echoWithSession('tag') },
}
