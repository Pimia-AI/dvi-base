import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { FilePlus2, Mail, MessageCircle, Moon, Phone, Plus, Sun, UserRound } from 'lucide-react'
import {
  Button, ButtonLink, Checkbox, ChoiceGroup, CountTabs, DataTable, DetailList, EmptyState, Field, LoadingState, ModuleErrorState,
  Notice, PageHeader, Screen, SearchInput, Section, Select, StatusBadge, TableToolbar, TextArea, TextInput, type Tone,
} from '../src/index'
import './showcase.css'
/**
 * La página de muestra del kit: arriba, una pantalla de módulo hecha solo con el kit (lista, ficha y alta de notas, con
 * datos de mentira); debajo, cada pieza por separado. Es lo que se revisa para aprobar el kit.
 */
type NoteState = 'draft' | 'review' | 'shared'
interface DemoNote { id: string; title: string; body: string; author: string; updated: string; state: NoteState }
const STATE: Record<NoteState, { label: string; tone: Tone }> = {
  draft: { label: 'Borrador', tone: 'neutral' }, review: { label: 'Por revisar', tone: 'warning' }, shared: { label: 'Compartida', tone: 'success' },
}
const NOTES: DemoNote[] = [
  { id: 'n1', title: 'Revisar el presupuesto del proveedor', body: 'Comparar las tres ofertas antes del jueves.', author: 'Lucía García', updated: 'hoy, 09:42', state: 'review' },
  { id: 'n2', title: 'Llamar al servicio técnico', body: 'Preguntar por la garantía de la pieza cambiada.', author: 'Marta Ruiz', updated: 'ayer, 18:05', state: 'draft' },
  { id: 'n3', title: 'Acta de la reunión de octubre', body: 'Subida al espacio compartido de la empresa.', author: 'Lucía García', updated: '6 nov, 11:20', state: 'shared' },
  { id: 'n4', title: 'Renovar el seguro del local', body: 'Vence a final de mes; pedir dos presupuestos.', author: 'Luis Ortega', updated: '2 nov, 10:00', state: 'draft' },
]

function DemoScreen() {
  const [view, setView] = useState<'list' | 'new' | { id: string }>('list')
  const [tab, setTab] = useState<'open' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [channel, setChannel] = useState<'whatsapp' | 'phone' | 'email' | 'person'>('whatsapp')
  const rows = useMemo(() => NOTES
    .filter(note => tab === 'all' || note.state !== 'shared')
    .filter(note => !search.trim() || `${note.title} ${note.body}`.toLowerCase().includes(search.trim().toLowerCase())), [tab, search])

  if (view === 'new') {
    return (
      <Screen width="narrow">
        <PageHeader title="Nueva nota" description="Lo mínimo para no perderla. Lo demás se completa después." back={{ label: 'Notas', onClick: () => { setView('list'); setErrors({}) } }} />
        <form className="grid gap-5" noValidate onSubmit={event => {
          event.preventDefault()
          setSaving(true)
          // Lo que contestaría el módulo con un 422: errores campo a campo.
          setTimeout(() => { setSaving(false); setErrors({ title: 'Obligatorio.', body: 'Admite hasta 4000 caracteres.' }) }, 700)
        }}>
          <Field label="Título" hint="Hasta 120 caracteres." error={errors.title}>{props => <TextInput {...props} placeholder="Qué hay que recordar" />}</Field>
          <Field label="Texto" error={errors.body}>{props => <TextArea {...props} placeholder="Los detalles, si hacen falta" />}</Field>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Por dónde llegó</span>
            <ChoiceGroup name="canal" label="Por dónde llegó" value={channel} onChange={setChannel} options={[
              { value: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle /> }, { value: 'phone', label: 'Teléfono', icon: <Phone /> },
              { value: 'email', label: 'Correo', icon: <Mail /> }, { value: 'person', label: 'En persona', icon: <UserRound /> },
            ]} />
          </div>
          <Checkbox label="Compartir con toda la empresa" description="La verán todas las personas de la empresa activa." />
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => { setView('list'); setErrors({}) }}>Cancelar</Button>
            <Button type="submit" loading={saving}>Guardar nota</Button>
          </div>
        </form>
      </Screen>
    )
  }

  if (typeof view === 'object') {
    const note = NOTES.find(n => n.id === view.id)!
    return (
      <Screen width="narrow">
        <PageHeader title={note.title} back={{ label: 'Notas', onClick: () => setView('list') }} aside={<StatusBadge tone={STATE[note.state].tone}>{STATE[note.state].label}</StatusBadge>} />
        <Notice tone="success" className="mb-6">Nota guardada. Ya la ve toda la empresa.</Notice>
        <DetailList items={[
          { label: 'Texto', value: note.body },
          { label: 'Autora', value: note.author },
          { label: 'Actualizada', value: <span className="tabular-nums">{note.updated}</span> },
          { label: 'Referencia', value: <span className="font-mono text-[12.5px] text-muted-foreground">NOTA-{note.id.toUpperCase()}7F3A</span> },
        ]} />
      </Screen>
    )
  }

  return (
    <Screen>
      <PageHeader title="Notas" description="Lo que la empresa apunta para no olvidarlo, de quien sea." actions={<Button icon={<Plus />} onClick={() => setView('new')}>Nueva nota</Button>} />
      <TableToolbar>
        <CountTabs label="Filtrar notas" value={tab} onChange={setTab} tabs={[{ id: 'open', label: 'Abiertas', count: 3 }, { id: 'all', label: 'Todas', count: 4 }]} />
        <SearchInput label="Buscar notas" value={search} onChange={setSearch} placeholder="Buscar por título o texto" />
      </TableToolbar>
      <DataTable caption="Notas de la empresa" rows={rows} rowKey={note => note.id} onRowClick={note => setView({ id: note.id })}
        empty={<EmptyState icon={<FilePlus2 />} title="Ninguna nota coincide" description="Prueba con otras palabras o mira en «Todas»." />}
        columns={[
          { key: 'title', header: 'Nota', cell: note => <div className="min-w-0"><div className="line-clamp-2 max-w-[46ch] font-medium sm:truncate">{note.title}</div><div className="hidden max-w-[46ch] truncate text-[12.5px] text-muted-foreground sm:block">{note.body}</div></div> },
          { key: 'state', header: 'Estado', cell: note => <StatusBadge tone={STATE[note.state].tone}>{STATE[note.state].label}</StatusBadge> },
          { key: 'author', header: 'Autor', cell: note => note.author, secondary: true },
          { key: 'updated', header: 'Actualizada', cell: note => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{note.updated}</span>, secondary: true },
        ]}
        footer={<><span>{rows.length} {rows.length === 1 ? 'nota' : 'notas'}</span><span>Ordenadas por la última actualización</span></>} />
    </Screen>
  )
}

/** Un ejemplo con su nombre, como en una hoja de piezas. */
function Specimen({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex min-h-16 flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-4">{children}</div>
      <p className="mt-1.5 font-mono text-2xs text-muted-foreground">{name}</p>
    </div>
  )
}

const SWATCHES: [string, string][] = [
  ['background', 'Papel'], ['foreground', 'Tinta'], ['primary', 'Acción'], ['muted-foreground', 'Secundario'], ['border', 'Línea fina'],
  ['secondary', 'Gris de cabecera'], ['success', 'Dato: bien'], ['warning', 'Dato: atención'], ['info', 'Dato: en curso'], ['destructive', 'Dato: error'], ['brand', 'Marca'], ['paper', 'Sello'],
]

function Pieces() {
  const [channel, setChannel] = useState<'a' | 'b' | 'c'>('a')
  return (
    <Screen>
      <Section title="Botones" description="Una sola acción negra por pantalla. Las demás, con borde o sin él; el color no destaca nada.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Specimen name="Button primary · secondary · ghost · danger"><Button>Guardar</Button><Button variant="secondary">Exportar</Button><Button variant="ghost">Cancelar</Button><Button variant="danger">Descartar</Button></Specimen>
          <Specimen name="Button size=sm · loading · disabled · ButtonLink"><Button size="sm" variant="secondary">Pequeño</Button><Button loading>Guardando</Button><Button disabled variant="secondary">Sin permiso</Button><ButtonLink href="#piezas" variant="ghost">Enlace</ButtonLink></Specimen>
        </div>
      </Section>
      <Section title="Estados de un dato" description="Se leen por el texto y el punto; el color acompaña. Solo «atención» y «error» tiñen el texto.">
        <Specimen name="StatusBadge tone=neutral · info · success · warning · danger · muted">
          <StatusBadge>Registrada</StatusBadge><StatusBadge tone="info">En curso</StatusBadge><StatusBadge tone="success">Hecha</StatusBadge>
          <StatusBadge tone="warning">Parada</StatusBadge><StatusBadge tone="danger">Rechazada</StatusBadge><StatusBadge tone="muted">Archivada</StatusBadge>
        </Specimen>
      </Section>
      <Section title="Avisos" description="Dentro de la pantalla. Los breves de una acción («Nota guardada») los pinta el anfitrión con «notice».">
        <div className="grid gap-3 sm:grid-cols-2">
          <Notice tone="success" title="Nota guardada">Ya la ve toda la empresa.</Notice>
          <Notice tone="warning" title="La nota cambió mientras la editabas">Otra persona la guardó antes. Recarga para ver su versión.</Notice>
          <Notice tone="info">Los cambios se guardan al pulsar «Guardar nota».</Notice>
          <Notice tone="danger" title="No se pudo guardar" action={<Button size="sm" variant="secondary">Reintentar</Button>}>El módulo no ha contestado a tiempo.</Notice>
        </div>
      </Section>
      <Section title="Campos" description="Etiqueta arriba, ayuda y error debajo, unidos al control para que un lector de pantalla los lea juntos.">
        <div className="grid gap-5 rounded-lg border border-border p-5 sm:grid-cols-2">
          <Field label="Título" hint="Hasta 120 caracteres.">{props => <TextInput {...props} defaultValue="Renovar el seguro del local" />}</Field>
          <Field label="Título" error="Obligatorio.">{props => <TextInput {...props} placeholder="Qué hay que recordar" />}</Field>
          <Field label="Categoría">{props => <Select {...props}><option>General</option><option>Compras</option></Select>}</Field>
          <Field label="Fecha de la nota" hint="La de cuando pasó, no la de ahora.">{props => <TextInput {...props} type="datetime-local" defaultValue="2026-11-08T09:42" />}</Field>
          <Field label="Texto" className="sm:col-span-2">{props => <TextArea {...props} rows={3} placeholder="Los detalles, si hacen falta" />}</Field>
          <div className="grid gap-1.5"><span className="text-[13px] font-medium">Prioridad</span>
            <ChoiceGroup name="prioridad" label="Prioridad" value={channel} onChange={setChannel} options={[{ value: 'a', label: 'Normal' }, { value: 'b', label: 'Alta' }, { value: 'c', label: 'Urgente' }]} />
          </div>
          <Checkbox label="Compartir con toda la empresa" description="La verán todas las personas de la empresa activa." />
        </div>
      </Section>
      <Section title="Estados de una pantalla" description="Vacío, cargando y los errores que el módulo sabe nombrar: cada uno dice qué pasa y qué hacer.">
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState icon={<FilePlus2 />} title="Aún no hay notas" description="Cuando alguien de la empresa apunte algo, aparecerá aquí." action={<Button icon={<Plus />}>Nueva nota</Button>} />
          <LoadingState rows={4} />
          <ModuleErrorState error={{ status: 403, code: 'not_in_plan' }} />
          <ModuleErrorState error={{ status: 503, code: 'pimia_unavailable' }} onRetry={() => {}} />
        </div>
      </Section>
      <Section title="Tokens" description="Los únicos colores literales del kit viven en styles.css; las pantallas usan estos nombres.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map(([token, label]) => (
            <div key={token}>
              <div className="h-14 rounded-lg border border-border" style={{ background: `var(--${token})` }} />
              <p className="mt-1.5 text-[12.5px] font-medium">{label}</p>
              <p className="font-mono text-2xs text-muted-foreground">--{token}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-2 rounded-lg border border-border p-5">
          <p className="text-2xl font-medium tracking-tight">Título de pantalla · Inter 24/500</p>
          <p className="text-[15px] font-medium">Título de bloque · Inter 15/500</p>
          <p>Texto · Inter 14/400. La acción primaria es negra; el color solo va en los datos.</p>
          <p className="text-[13px] text-muted-foreground">Secundario · Inter 13/400</p>
          <p className="font-mono text-[12.5px] text-muted-foreground">Identificador · Geist Mono · NOTA-N17F3A</p>
        </div>
      </Section>
    </Screen>
  )
}

function Showcase() {
  const [dark, setDark] = useState(() => new URLSearchParams(location.search).get('theme') === 'dark')
  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[72rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-6 place-items-center rounded-md bg-brand text-xs font-semibold text-background" aria-hidden>P</span>
            <div>
              <p className="text-[13.5px] font-medium">Kit de interfaz de los módulos</p>
              <p className="text-[12.5px] text-muted-foreground">@dvi-base/kit · estilo taskai.work</p>
            </div>
          </div>
          <nav className="flex items-center gap-1" aria-label="Secciones">
            <ButtonLink href="#pantalla" variant="ghost" size="sm">Pantalla</ButtonLink>
            <ButtonLink href="#piezas" variant="ghost" size="sm">Piezas</ButtonLink>
            <Button variant="secondary" size="sm" icon={dark ? <Sun /> : <Moon />} onClick={() => setDark(!dark)} aria-pressed={dark}>{dark ? 'Claro' : 'Oscuro'}</Button>
          </nav>
        </div>
      </header>
      <div id="pantalla" className="scroll-mt-16 bg-secondary/60 py-8">
        <div className="mx-auto max-w-[72rem] px-4 sm:px-8">
          <p className="mb-3 max-w-[70ch] text-[13px] text-muted-foreground">Una pantalla de módulo hecha solo con el kit, tal como se vería dentro del panel de Pimia. Pulsa una fila para ver la ficha, o «Nueva nota» y «Guardar nota» para ver los errores campo a campo.</p>
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <DemoScreen />
          </div>
        </div>
      </div>
      <div id="piezas" className="scroll-mt-16">
        <Pieces />
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Showcase /></StrictMode>)
