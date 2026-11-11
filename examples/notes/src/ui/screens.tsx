import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { FilePlus2, Pencil, Plus } from 'lucide-react'
import {
  Button, DataTable, DetailList, EmptyState, Field, LoadingState, ModuleApiError, ModuleErrorState, Notice, PageHeader, Screen,
  SearchInput, TableToolbar, TextArea, TextInput, useModule, useTitle,
} from '@dvi-base/kit'
/**
 * Las pantallas del módulo de ejemplo: lista, alta y ficha de notas. Solo usan el kit; la sesión, la empresa y los
 * permisos los da el panel de Pimia (anfitrión) y los confirma el backend del módulo en cada petición.
 */
interface Note { id: string; title: string; body: string | null; created_by: string; updated_at: string; version: number }
interface Page { data: Note[]; meta: { page: number; next_page: number | null } }
const GROUP = [{ text: 'Ejemplo' }]

const FORMAT = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' })
/** La fecha en hora de Madrid; si no se puede leer, tal cual (una fecha rara no tumba la pantalla). */
const when = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? FORMAT.format(time) : value }

export function Screens() {
  const { path } = useModule()
  if (path === '/app/notes/new') return <NewNote />
  const match = /^\/app\/notes\/([0-9a-f-]{36})$/i.exec(path)
  if (match) return <NoteDetail id={match[1]} />
  return <NotesList />
}

function useAuthor() {
  const { session } = useModule()
  return (id: string) => (id === session.user.id ? 'Tú' : `Otra persona (usuario ${id})`)
}

function NotesList() {
  const { api, go } = useModule()
  const author = useAuthor()
  useTitle('Notas', GROUP)
  const [search, setSearch] = useState('')
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; error: ModuleApiError } | { kind: 'ready'; notes: Note[]; next: number | null }>({ kind: 'loading' })

  const load = useCallback(async (page: number, term: string, append: Note[] = []) => {
    try {
      const result = await api.get<Page>(`/api/notes?page=${page}&search=${encodeURIComponent(term)}`)
      setState({ kind: 'ready', notes: [...append, ...result.data], next: result.meta.next_page })
    } catch (error) {
      setState({ kind: 'error', error: error as ModuleApiError })
    }
  }, [api])
  useEffect(() => {
    const timer = setTimeout(() => { void load(1, search) }, search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  return (
    <Screen>
      <PageHeader title="Notas" description="Lo que la empresa apunta para no olvidarlo. Cada empresa ve solo las suyas."
        actions={<Button icon={<Plus />} onClick={() => go('/app/notes/new')}>Nueva nota</Button>} />
      <TableToolbar>
        <span className="text-[13px] text-muted-foreground">{state.kind === 'ready' ? `${state.notes.length}${state.next ? '+' : ''} ${state.notes.length === 1 ? 'nota' : 'notas'}` : ' '}</span>
        <SearchInput label="Buscar notas" value={search} onChange={setSearch} placeholder="Buscar por título o texto" />
      </TableToolbar>
      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'error' && <ModuleErrorState error={state.error} onRetry={() => { setState({ kind: 'loading' }); void load(1, search) }} />}
      {state.kind === 'ready' && (
        <DataTable caption="Notas de la empresa" rows={state.notes} rowKey={note => note.id} onRowClick={note => go(`/app/notes/${note.id}`)}
          empty={search
            ? <EmptyState icon={<FilePlus2 />} title="Ninguna nota coincide" description="Prueba con otras palabras." />
            : <EmptyState icon={<FilePlus2 />} title="Aún no hay notas" description="Cuando alguien de la empresa apunte algo, aparecerá aquí." action={<Button icon={<Plus />} onClick={() => go('/app/notes/new')}>Nueva nota</Button>} />}
          columns={[
            { key: 'title', header: 'Nota', cell: note => (
              <div className="min-w-0">
                <div className="line-clamp-2 max-w-[52ch] font-medium sm:truncate">{note.title}</div>
                {note.body && <div className="hidden max-w-[52ch] truncate text-[12.5px] text-muted-foreground sm:block">{note.body}</div>}
              </div>
            ) },
            { key: 'author', header: 'Autor', cell: note => author(note.created_by), secondary: true },
            { key: 'updated', header: 'Actualizada', cell: note => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{when(note.updated_at)}</span> },
          ]}
          footer={state.next ? <Button variant="secondary" size="sm" onClick={() => { void load(state.next!, search, state.notes) }}>Cargar más</Button> : undefined} />
      )}
    </Screen>
  )
}

function NewNote() {
  const { api, go, host } = useModule()
  useTitle('Nueva nota', GROUP)
  // El id lo elige la pantalla una vez: si el envío se repite, el módulo devuelve la misma nota en vez de duplicarla.
  const id = useRef(crypto.randomUUID())
  const [title, setTitle] = useState(''), [body, setBody] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<ModuleApiError | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setErrors({}); setFailure(null)
    try {
      await api.post('/api/notes', { id: id.current, title, body })
      host.notify('success', 'Nota guardada')
      go(`/app/notes/${id.current}`, { replace: true })
    } catch (error) {
      const apiError = error as ModuleApiError
      if (apiError.code === 'validation' && apiError.errors) setErrors(apiError.errors)
      else setFailure(apiError)
      setSaving(false)
    }
  }

  return (
    <Screen width="narrow">
      <PageHeader title="Nueva nota" description="Lo mínimo para no perderla. Lo demás se completa después." back={{ label: 'Notas', onClick: () => go('/app/notes') }} />
      {failure && <Notice tone="danger" title="No se pudo guardar" className="mb-5">{failure.message}</Notice>}
      <form className="grid gap-5" noValidate onSubmit={submit}>
        <Field label="Título" hint="Hasta 120 caracteres." error={errors.title}>{props => <TextInput {...props} value={title} onChange={event => setTitle(event.target.value)} placeholder="Qué hay que recordar" autoFocus />}</Field>
        <Field label="Texto" error={errors.body}>{props => <TextArea {...props} value={body} onChange={event => setBody(event.target.value)} placeholder="Los detalles, si hacen falta" />}</Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => go('/app/notes')}>Cancelar</Button>
          <Button type="submit" loading={saving}>Guardar nota</Button>
        </div>
      </form>
    </Screen>
  )
}

function NoteDetail({ id }: { id: string }) {
  const { api, go, host } = useModule()
  const author = useAuthor()
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; error: ModuleApiError } | { kind: 'ready'; note: Note }>({ kind: 'loading' })
  const [editing, setEditing] = useState(false)
  useTitle(state.kind === 'ready' ? state.note.title : 'Nota', GROUP)

  const load = useCallback(async () => {
    try { setState({ kind: 'ready', note: (await api.get<{ data: Note }>(`/api/notes/${id}`)).data }) }
    catch (error) { setState({ kind: 'error', error: error as ModuleApiError }) }
  }, [api, id])
  useEffect(() => { void load() }, [load])

  const back = { label: 'Notas', onClick: () => go('/app/notes') }
  if (state.kind === 'loading') return <Screen width="narrow"><PageHeader title="Nota" back={back} /><LoadingState rows={3} /></Screen>
  if (state.kind === 'error') {
    return (
      <Screen width="narrow">
        <PageHeader title="Nota" back={back} />
        {state.error.code === 'not_found'
          ? <EmptyState title="No existe esa nota en esta empresa" description="Puede que sea de otra empresa, o que el enlace esté mal." action={<Button variant="secondary" onClick={() => go('/app/notes')}>Ver las notas</Button>} />
          : <ModuleErrorState error={state.error} onRetry={() => { setState({ kind: 'loading' }); void load() }} />}
      </Screen>
    )
  }
  const note = state.note
  if (editing) {
    return <EditNote note={note} onCancel={() => setEditing(false)} onSaved={saved => { setState({ kind: 'ready', note: saved }); setEditing(false); host.notify('success', 'Cambios guardados') }} />
  }
  return (
    <Screen width="narrow">
      <PageHeader title={note.title} back={back} actions={<Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>Editar</Button>} />
      <DetailList items={[
        { label: 'Texto', value: note.body ?? <span className="text-muted-foreground">Sin texto</span> },
        { label: 'Creada por', value: author(note.created_by) },
        { label: 'Actualizada', value: <span className="tabular-nums">{when(note.updated_at)}</span> },
        { label: 'Versión', value: <span className="tabular-nums">{note.version}</span> },
        { label: 'Referencia', value: <span className="font-mono text-[12.5px] text-muted-foreground">{note.id}</span> },
      ]} />
    </Screen>
  )
}

function EditNote({ note, onCancel, onSaved }: { note: Note; onCancel: () => void; onSaved: (note: Note) => void }) {
  const { api } = useModule()
  const [title, setTitle] = useState(note.title), [body, setBody] = useState(note.body ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<ModuleApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setErrors({}); setFailure(null)
    try { onSaved((await api.put<{ data: Note }>(`/api/notes/${note.id}`, { version: note.version, title, body })).data) }
    catch (error) {
      const apiError = error as ModuleApiError
      if (apiError.code === 'validation' && apiError.errors) setErrors(apiError.errors)
      else setFailure(apiError)
      setSaving(false)
    }
  }
  return (
    <Screen width="narrow">
      <PageHeader title="Editar nota" back={{ label: 'Volver a la nota', onClick: onCancel }} />
      {failure?.code === 'conflict'
        ? <Notice tone="warning" title="La nota cambió mientras la editabas" className="mb-5">Otra persona la guardó antes. Vuelve a la nota para ver su versión y repite el cambio.</Notice>
        : failure && <Notice tone="danger" title="No se pudo guardar" className="mb-5">{failure.message}</Notice>}
      <form className="grid gap-5" noValidate onSubmit={submit}>
        <Field label="Título" hint="Hasta 120 caracteres." error={errors.title}>{props => <TextInput {...props} value={title} onChange={event => setTitle(event.target.value)} />}</Field>
        <Field label="Texto" error={errors.body}>{props => <TextArea {...props} value={body} onChange={event => setBody(event.target.value)} />}</Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" loading={saving}>Guardar cambios</Button>
        </div>
      </form>
    </Screen>
  )
}
