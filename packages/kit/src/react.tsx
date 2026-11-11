import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MonitorX } from 'lucide-react'
import { connectHost, HostError, type HostConnection, type HostSession } from './host'
import { createModuleApi, type ModuleApi } from './api'
import { EmptyState, LoadingState } from './components/states'
import { Screen } from './components/layout'
/**
 * La raíz de las pantallas de un módulo: conecta con el anfitrión (contrato embebido), espera la sesión y da a las
 * pantallas la API, el título y la navegación. Abierta fuera del panel de Pimia, lo dice y no hace nada más.
 *
 * Los orígenes del anfitrión los pone el servidor del módulo en `<meta name="pimia-host-origins">` (`PIMIA_HOST_ORIGINS`).
 */
export interface ModuleContextValue {
  host: HostConnection
  api: ModuleApi
  session: HostSession
  /** La ruta actual de la pantalla (`/app/…`), sin la query del anfitrión. */
  path: string
  /** Navega dentro del módulo y se lo cuenta al anfitrión, que actualiza su URL. */
  go(path: string, options?: { replace?: boolean }): void
}
const ModuleContext = createContext<ModuleContextValue | null>(null)

export function useModule(): ModuleContextValue {
  const value = useContext(ModuleContext)
  if (!value) throw new Error('useModule fuera de <ModuleApp>')
  return value
}

/** Título y migas de la pantalla en el anfitrión, cada vez que cambian. */
export function useTitle(title: string, breadcrumbs: { text: string; path?: string }[] = []) {
  const { host } = useModule()
  const key = JSON.stringify([title, breadcrumbs])
  useEffect(() => { host.setTitle(title, breadcrumbs) }, [host, key]) // eslint-disable-line react-hooks/exhaustive-deps
}

type State =
  | { kind: 'connecting' }
  | { kind: 'standalone' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; host: HostConnection; api: ModuleApi; session: HostSession }

function allowedOrigins(): string[] {
  const meta = document.querySelector('meta[name="pimia-host-origins"]')?.getAttribute('content') ?? ''
  return meta.split(',').map(origin => origin.trim()).filter(Boolean)
}

export function ModuleApp({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'connecting' })
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    let host: HostConnection
    try {
      host = connectHost({ allowedOrigins: allowedOrigins(), window: window as never })
    } catch (error) {
      setState(error instanceof HostError && error.code === 'standalone' ? { kind: 'standalone' } : { kind: 'error', code: error instanceof HostError ? error.code : 'unknown' })
      return
    }
    let alive = true
    const applyTheme = (theme: 'light' | 'dark') => document.documentElement.classList.toggle('dark', theme === 'dark')
    applyTheme(host.context.theme)
    const offTheme = host.on('theme', applyTheme)
    const offGo = host.on('go', next => { window.history.pushState(null, '', next + window.location.search); setPath(next) })
    // Otra empresa u otra instancia: lo de esta pantalla ya no vale. El anfitrión vuelve a cargar el iframe.
    // La conexión queda retirada (rechaza con `context`): se deja de escucharla hasta que el iframe se recargue.
    const offContext = host.on('context-changed', () => { alive = false; setState({ kind: 'connecting' }) })
    host.getSession().then(
      session => { if (alive) { applyTheme(session.theme); setState({ kind: 'ready', host, api: createModuleApi({ session: host }), session }) } },
      error => { if (alive) setState({ kind: 'error', code: error instanceof HostError ? error.code : 'unknown' }) },
    )
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => { alive = false; offTheme(); offGo(); offContext(); window.removeEventListener('popstate', onPop); host.close() }
  }, [])

  const value = useMemo<ModuleContextValue | null>(() => {
    if (state.kind !== 'ready') return null
    return {
      host: state.host, api: state.api, session: state.session, path,
      go: (next, options = {}) => {
        if (!next.startsWith('/app/')) return
        window.history[options.replace ? 'replaceState' : 'pushState'](null, '', next + window.location.search)
        setPath(next)
        state.host.navigate(next, options.replace)
      },
    }
  }, [state, path])

  if (state.kind === 'standalone') {
    return (
      <Screen width="narrow">
        <EmptyState icon={<MonitorX />} title="Abre este módulo desde Pimia"
          description="Esta pantalla vive dentro del panel de Pimia: es allí donde se sabe quién eres y con qué empresa trabajas. Entra en el panel y ábrela desde su menú." />
      </Screen>
    )
  }
  if (state.kind === 'error') {
    return (
      <Screen width="narrow">
        <EmptyState icon={<MonitorX />} title="No se pudo conectar con el panel de Pimia"
          description="El panel no ha dado la sesión o no es un anfitrión permitido para este módulo. Vuelve a abrir la pantalla desde el menú del panel."
          action={<span className="font-mono text-2xs text-muted-foreground">anfitrión · {state.code}</span>} />
      </Screen>
    )
  }
  if (!value) return <Screen><LoadingState rows={3} label="Conectando con el panel de Pimia…" /></Screen>
  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>
}
