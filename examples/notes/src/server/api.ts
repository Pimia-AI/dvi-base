import {
  createModuleDeps, isUuid, json, modulePool, ModuleHttpError, readJson, readManifest, scopeOf, withModule,
  type Handler, type HandlersFor, type ModuleSession, type RouteDef,
} from '@dvi-base/module'
import moduleJson from '../../module.json' with { type: 'json' }
import { NotesRepository, validateNote } from './notes'
/**
 * La API del módulo de ejemplo: lista, alta, ficha y edición de notas de la empresa. Todo lo demás (servidor, sesión
 * contra Pimia ERP, ámbito, errores, migraciones, pantallas) lo pone la base.
 */
export const manifest = readManifest(moduleJson)

export const routes = [
  { name: 'notes', path: '/api/notes', methods: ['GET', 'POST'] },
  { name: 'note', path: '/api/notes/:noteId', methods: ['GET', 'PUT'] },
] as const satisfies readonly RouteDef[]

const deps = createModuleDeps(manifest)
/** Ver notas pide `notes:read`; crearlas o editarlas, `notes:write` (los da Pimia ERP por rol en el token de módulo). */
const READ = { scope: 'notes:read' }, WRITE = { scope: 'notes:write' }
const repository = (session: ModuleSession) => new NotesRepository(modulePool(), scopeOf(session))
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

export const handlers: HandlersFor<typeof routes> = {
  notes: { GET: listNotes, POST: createNote },
  note: { GET: getNote, PUT: updateNote },
}
