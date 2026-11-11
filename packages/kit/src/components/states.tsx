import type { ReactNode } from 'react'
import { CloudOff, Inbox, Lock, RotateCw, ShieldX } from 'lucide-react'
import { Button } from './button'
import { cn } from '../cn'
/**
 * Los estados de una pantalla que no son «hay datos»: vacío, cargando y los errores del módulo con su texto. Cada error
 * dice qué pasa y qué se puede hacer (contrato embebido §8); el código queda a la vista, en pequeño, para soporte.
 */
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('grid justify-items-center gap-2.5 rounded-lg border border-dashed border-border px-6 py-16 text-center', className)}>
      <span className="grid size-10 place-items-center rounded-[10px] border border-border text-muted-foreground [&_svg]:size-[18px]" aria-hidden>
        {icon ?? <Inbox />}
      </span>
      <h2 className="mt-1.5 text-base font-medium">{title}</h2>
      {description && <p className="max-w-[46ch] text-muted-foreground text-pretty">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Mientras carga: la forma de la tabla, sin datos inventados. */
export function LoadingState({ rows = 4, label = 'Cargando…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="overflow-hidden rounded-lg border border-border">
      <span className="sr-only">{label}</span>
      <div className="h-9 border-b border-border bg-secondary" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-14 items-center gap-6 border-b border-border px-3.5 last:border-b-0">
          <div className="h-3 w-2/5 animate-pulse rounded-sm bg-muted" style={{ animationDelay: `${index * 120}ms` }} />
          <div className="h-3 w-20 animate-pulse rounded-sm bg-muted" style={{ animationDelay: `${index * 120 + 60}ms` }} />
        </div>
      ))}
    </div>
  )
}

/** Un error que el módulo sabe nombrar (`ModuleApiError.code`), o cualquier otro. */
export interface ErrorLike { status?: number; code?: string }

const COPY: Record<string, { icon: ReactNode; title: string; description: string; retry: boolean }> = {
  not_in_plan: { icon: <Lock />, title: 'Esta empresa no tiene este módulo', description: 'El plan de la instancia no lo incluye. Si crees que debería tenerlo, habla con quien gestiona tu cuenta de Pimia.', retry: false },
  forbidden: { icon: <ShieldX />, title: 'No tienes acceso con esta empresa', description: 'Tu usuario de Pimia no pertenece a la empresa activa. Cambia de empresa en el panel e inténtalo de nuevo.', retry: false },
  company_required: { icon: <ShieldX />, title: 'Falta la empresa', description: 'El panel no ha indicado con qué empresa trabajas. Elige una empresa en el panel.', retry: false },
  tenant_required: { icon: <ShieldX />, title: 'Falta la instancia', description: 'El panel no ha indicado la instancia de Pimia. Vuelve a abrir el módulo desde el panel.', retry: false },
  tenant_mismatch: { icon: <ShieldX />, title: 'Este módulo sirve a otra instancia', description: 'Lo has abierto desde una instancia de Pimia que no es la suya.', retry: false },
  pimia_unavailable: { icon: <CloudOff />, title: 'No se pudo comprobar tu sesión con Pimia', description: 'Pimia no ha contestado. Suele ser pasajero: vuelve a intentarlo en unos segundos.', retry: true },
  unavailable: { icon: <CloudOff />, title: 'El módulo no está disponible ahora mismo', description: 'Vuelve a intentarlo en unos segundos. Si sigue igual, avisa a quien mantiene el módulo.', retry: true },
  network: { icon: <CloudOff />, title: 'No se pudo conectar con el módulo', description: 'Comprueba la conexión y vuelve a intentarlo.', retry: true },
}
const FALLBACK = { icon: <CloudOff />, title: 'Algo ha fallado', description: 'No se ha podido completar. Vuelve a intentarlo; si sigue igual, avisa a quien mantiene el módulo.', retry: true }

export function ModuleErrorState({ error, onRetry, className }: { error: ErrorLike; onRetry?: () => void; className?: string }) {
  const copy = (error.code && COPY[error.code]) || FALLBACK
  return (
    <EmptyState className={className} icon={copy.icon} title={copy.title} description={copy.description}
      action={
        <div className="grid justify-items-center gap-3">
          {copy.retry && onRetry && <Button variant="secondary" icon={<RotateCw />} onClick={onRetry}>Reintentar</Button>}
          {(error.status || error.code) && (
            <span className="font-mono text-2xs text-muted-foreground">{[error.status, error.code].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      } />
  )
}
