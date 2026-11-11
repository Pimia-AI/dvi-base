import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChevronsUpDown, CircleAlert, CircleCheck, FileText, House, Info, LayoutGrid, Moon, NotebookPen, PanelLeft, Sun, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@dvi-base/kit'
import './styles.css'
import { createSessionRelay, type SessionTarget } from './session-relay'
/**
 * La cáscara del anfitrión de desarrollo: el aspecto del panel de Pimia ERP y el lado anfitrión del contrato embebido
 * (`docs/contrato-embebido.md` §5, §6 y §8). Da la sesión a la pantalla del módulo, pinta su título, lleva su ruta en la
 * URL (`/m/{key}/…`) y enseña sus avisos. Las personas y empresas son las del doble de Pimia.
 */
interface Screen { id: string; title: string; path: string; menu?: { group: string; icon: string; order?: number } }
interface Person { label: string; user: { id: string; name: string; email: string }; note?: string; companies: { id: string; name: string }[] }
interface Config { tenant: string; module: { key: string; name: string; origin: string; screens: Screen[] }; people: Person[] }
interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }

const ICONS: Record<string, LucideIcon> = { 'notebook-pen': NotebookPen, notebook: NotebookPen, 'file-text': FileText, users: Users }
const PIMIA_MENU: { label: string; icon: LucideIcon }[] = [{ label: 'Inicio', icon: House }, { label: 'Clientes', icon: Users }, { label: 'Facturas', icon: FileText }]
const PROTOCOL = 1

function Host({ config }: { config: Config }) {
  const { module, people, tenant } = config
  const prefix = `/m/${module.key}/`
  const toModulePath = (hostPath: string) => (hostPath.startsWith(prefix) ? `/app/${hostPath.slice(prefix.length)}` : module.screens[0].path)
  const toHostPath = (modulePath: string) => `${prefix}${modulePath.replace(/^\/app\//, '')}`

  const [personIndex, setPersonIndex] = useState(0)
  const person = people[personIndex]
  const [companyId, setCompanyId] = useState(person.companies[0]?.id ?? '')
  const company = person.companies.find(c => c.id === companyId) ?? person.companies[0]
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  // El botón de la barra, como en el panel: en escritorio reduce el menú a una columna de iconos; en pantallas estrechas
  // lo saca por encima de la página o lo esconde.
  const desktop = useDesktop()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const rail = desktop && collapsed
  // Dónde arranca el iframe: cambia al elegir una pantalla del menú o al cambiar de persona o de empresa (se recarga).
  const [frame, setFrame] = useState(() => ({ path: toModulePath(window.location.pathname), nonce: 0 }))
  const [modulePath, setModulePath] = useState(frame.path)
  const [title, setTitle] = useState<{ title: string; breadcrumbs: { text: string }[] }>({ title: module.name, breadcrumbs: [] })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [blocked, setBlocked] = useState<{ code: string; status: number } | null>(null)
  const iframe = useRef<HTMLIFrameElement>(null)
  const relay = useRef(createSessionRelay()).current
  // Cada persona, empresa o recarga es una generación nueva: una sesión pedida antes ya no se entrega (`session-relay.ts`).
  useEffect(() => () => relay.invalidate(), [relay, personIndex, company?.id, frame.nonce])
  const live = useRef({ person, personIndex, company, theme })
  live.current = { person, personIndex, company, theme }

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts(current => [...current, { id, kind, text }])
    setTimeout(() => setToasts(current => current.filter(t => t.id !== id)), 3500)
  }, [])
  const post = useCallback((type: string, data?: unknown) => {
    iframe.current?.contentWindow?.postMessage({ pimia: PROTOCOL, type, ...(data === undefined ? {} : { data }) }, module.origin)
  }, [module.origin])

  useEffect(() => { document.title = `${title.title} · Pimia` }, [title.title])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    post('theme', { theme })
  }, [theme, post])

  useEffect(() => {
    window.history.replaceState(null, '', toHostPath(frame.path))
    const onMessage = (event: MessageEvent) => {
      // Solo la pantalla del módulo, desde su origen y con el protocolo 1.
      if (event.source !== iframe.current?.contentWindow || event.origin !== module.origin) return
      const message = event.data as { pimia?: number; type?: string; id?: unknown; data?: Record<string, unknown> } | null
      if (!message || message.pimia !== PROTOCOL) return
      const { person: who, personIndex: index, company: where, theme: look } = live.current
      switch (message.type) {
        case 'ready':
        case 'request-session':
          // Un token de módulo nuevo para esta persona y esta empresa; la cáscara no guarda ninguno (contrato §11).
          void relay.answer(
            { source: event.source as unknown as SessionTarget, origin: event.origin, id: typeof message.id === 'string' ? message.id.slice(0, 64) : undefined },
            async () => {
              const reply = await fetch(`/dev/session?person=${index}&company=${encodeURIComponent(where.id)}`)
              if (!reply.ok) throw new Error(String(reply.status))
              const issued = await reply.json() as { token: string; expires_at: string }
              return { token: issued.token, expires_at: issued.expires_at, tenant, company: { id: where.id, name: where.name }, user: who.user, locale: 'es-ES', theme: look }
            },
          ).catch(() => toast('error', 'Pimia no ha dado sesión de módulo para esta persona y esta empresa.'))
          break
        case 'title':
          setTitle({ title: String(message.data?.title ?? module.name), breadcrumbs: (message.data?.breadcrumbs as { text: string }[]) ?? [] })
          break
        case 'navigate': {
          const path = String(message.data?.path ?? '')
          if (!path.startsWith('/app/')) break
          setModulePath(path)
          window.history[message.data?.replace ? 'replaceState' : 'pushState'](null, '', toHostPath(path))
          break
        }
        case 'notice':
          toast((message.data?.kind as Toast['kind']) ?? 'info', String(message.data?.text ?? ''))
          break
        case 'error':
          setBlocked({ code: String(message.data?.code ?? ''), status: Number(message.data?.status ?? 0) })
          break
        case 'open':
          toast('info', `En el panel real se abriría ${String(message.data?.path ?? '')} de Pimia.`)
          break
      }
    }
    const onPop = () => { const path = toModulePath(window.location.pathname); setModulePath(path); post('go', { path }) }
    window.addEventListener('message', onMessage)
    window.addEventListener('popstate', onPop)
    return () => { window.removeEventListener('message', onMessage); window.removeEventListener('popstate', onPop) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (path: string) => { setBlocked(null); setModulePath(path); setFrame(current => ({ path, nonce: current.nonce + 1 })); window.history.pushState(null, '', toHostPath(path)) }
  const reload = () => { setBlocked(null); setFrame(current => ({ path: modulePath, nonce: current.nonce + 1 })) }

  const src = useMemo(() => {
    const query = new URLSearchParams({ pimia_protocol: '1', pimia_host: window.location.origin, pimia_tenant: tenant, pimia_company: company?.id ?? '', pimia_locale: 'es-ES', pimia_theme: theme })
    return `${module.origin}${frame.path}?${query}`
  }, [frame, company?.id, tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const byGroup = new Map<string, Screen[]>()
    for (const screen of [...module.screens].sort((a, b) => (a.menu?.order ?? 0) - (b.menu?.order ?? 0))) {
      const group = screen.menu?.group ?? module.name
      byGroup.set(group, [...(byGroup.get(group) ?? []), screen])
    }
    return [...byGroup]
  }, [module])

  return (
    <div className={cn('grid h-dvh grid-cols-1 bg-secondary', rail ? 'md:grid-cols-[4rem_1fr]' : 'md:grid-cols-[15rem_1fr]')}>
      {drawer && !desktop && <div className="fixed inset-0 z-10 bg-foreground/20" onClick={() => setDrawer(false)} aria-hidden />}
      <aside id="menu-lateral" aria-label="Panel de Pimia"
        className={cn('flex-col gap-5 overflow-y-auto bg-secondary py-3.5', rail ? 'items-center px-2' : 'px-2.5',
          desktop ? 'flex' : cn('fixed inset-y-0 left-0 z-20 w-60', drawer ? 'flex' : 'hidden'))}>
        <label title={rail ? `${company?.name} · instancia ${tenant}` : `Instancia ${tenant}`}
          className={cn('relative flex cursor-pointer items-center gap-2.5 rounded-lg transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground',
            rail ? 'p-0' : 'border border-border bg-background py-1.5 pr-2 pl-1.5 hover:border-ring')}>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand text-sm font-semibold text-background" aria-hidden>P</span>
          <span className={cn('min-w-0 flex-1 leading-tight', rail && 'sr-only')}>
            <span className="block text-[13px] font-semibold">Pimia</span>
            <span className="block truncate text-[13px] text-muted-foreground">{company?.name}</span>
          </span>
          {!rail && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="sr-only">Empresa activa</span>
          <select value={company?.id} onChange={event => { setCompanyId(event.target.value); reload() }}
            className="absolute inset-0 size-full cursor-pointer opacity-0">
            {person.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <nav className={cn('grid', rail ? 'gap-3' : 'gap-4')} aria-label="Menú">
          <div className="grid gap-0.5">
            <p className={cn('mb-1 px-2.5 text-xs font-medium text-muted-foreground', rail && 'sr-only')}>General</p>
            {PIMIA_MENU.map(item => (
              <span key={item.label} title={`${item.label}: pantalla de Pimia ERP, no está en el anfitrión de desarrollo`}
                className={cn('flex cursor-default items-center gap-2.5 rounded-md py-1.5 text-[13.5px] text-muted-foreground', rail ? 'size-9 justify-center' : 'px-2.5')}>
                <item.icon className="size-4 shrink-0" aria-hidden /><span className={cn(rail && 'sr-only')}>{item.label}</span>
              </span>
            ))}
          </div>
          {groups.map(([group, screens]) => (
            <div key={group} className="grid gap-0.5">
              <p className={cn('mb-1 px-2.5 text-xs font-medium text-muted-foreground', rail && 'sr-only')}>{group}</p>
              {screens.map(screen => {
                const Icon = ICONS[screen.menu?.icon ?? ''] ?? LayoutGrid
                const current = modulePath === screen.path || modulePath.startsWith(`${screen.path}/`)
                return (
                  <a key={screen.id} href={toHostPath(screen.path)} aria-current={current ? 'page' : undefined} title={rail ? screen.title : undefined}
                    onClick={event => { event.preventDefault(); open(screen.path); setDrawer(false) }}
                    className={cn('flex items-center gap-2.5 rounded-md py-1.5 text-[13.5px] transition-colors hover:bg-foreground/5', rail ? 'size-9 justify-center' : 'px-2.5', current && 'bg-foreground/[0.07] font-medium')}>
                    <Icon className="size-4 shrink-0" aria-hidden /><span className={cn(rail && 'sr-only')}>{screen.title}</span>
                  </a>
                )
              })}
            </div>
          ))}
        </nav>
        <label title={rail ? `${person.user.name} · ${person.note ?? person.user.email}` : undefined}
          className={cn('relative mt-auto flex cursor-pointer items-center gap-2.5 rounded-lg transition-colors hover:bg-foreground/5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground', rail ? 'p-0.5' : 'px-2 py-2')}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-background text-[13px] text-muted-foreground" aria-hidden>{person.user.name.slice(0, 1)}</span>
          <span className={cn('min-w-0 flex-1 leading-tight', rail && 'sr-only')}>
            <span className="block truncate text-[13.5px] font-medium">{person.user.name}</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">{person.note ?? person.user.email}</span>
          </span>
          {!rail && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="sr-only">Entrar como</span>
          <select value={personIndex} onChange={event => { const next = Number(event.target.value); setPersonIndex(next); setCompanyId(people[next].companies[0]?.id ?? ''); reload() }}
            className="absolute inset-0 size-full cursor-pointer opacity-0">
            {people.map((p, index) => <option key={`${p.user.id}-${index}`} value={index}>{p.label}</option>)}
          </select>
        </label>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col md:p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-border bg-background md:rounded-xl md:border">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <button type="button" onClick={() => (desktop ? setCollapsed(!collapsed) : setDrawer(!drawer))} aria-controls="menu-lateral"
              aria-expanded={desktop ? !collapsed : drawer} aria-label={desktop ? (collapsed ? 'Ampliar el menú' : 'Reducir el menú') : (drawer ? 'Cerrar el menú' : 'Abrir el menú')}
              className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <PanelLeft className="size-[18px]" />
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span title="Hace en local el papel del panel de Pimia; no es Pimia." className="rounded-md border border-dashed border-border px-2 py-1 text-[11.5px] text-muted-foreground">Anfitrión de desarrollo</span>
              <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
                className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
              </button>
            </div>
          </header>
          {blocked && (
            <div role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[13px]">
              <Info className="size-4 shrink-0 text-info" aria-hidden />
              <span>El módulo avisa al panel: <span className="font-mono text-[12px]">{blocked.status} · {blocked.code}</span>. En el panel real, Pimia podría esconder la entrada del menú.</span>
            </div>
          )}
          <main className="relative flex-1">
            <iframe key={`${personIndex}-${company?.id}-${frame.nonce}`} ref={iframe} src={src} title={title.title}
              referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              className="absolute inset-0 size-full border-0" />
          </main>
        </div>
      </div>

      <div className="pointer-events-none fixed right-4 bottom-4 z-10 grid gap-2" aria-live="polite">
        {toasts.map(t => {
          const Icon = t.kind === 'success' ? CircleCheck : t.kind === 'error' ? CircleAlert : Info
          return (
            <div key={t.id} className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-border bg-background px-3.5 py-2.5 text-[13.5px] shadow-lg shadow-foreground/5">
              <Icon className={cn('size-4', t.kind === 'success' ? 'text-success' : t.kind === 'error' ? 'text-destructive' : 'text-info')} aria-hidden />
              {t.text}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** ¿Pantalla de escritorio? Sigue los cambios de tamaño. */
function useDesktop(): boolean {
  const query = '(min-width: 768px)'
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return matches
}

function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { fetch('/dev/config').then(r => r.json()).then(setConfig, () => setFailed(true)) }, [])
  if (failed) return <p className="p-8 text-muted-foreground">No se pudo leer la configuración del anfitrión de desarrollo.</p>
  return config ? <Host config={config} /> : null
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
