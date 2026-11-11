import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '../cn'
/**
 * El estado de un dato se lee por el texto y el punto; el color acompaña (regla 2 de taskai.work). `warning` colorea
 * también el texto porque pide atención; el resto, solo el punto.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted'

const DOT: Record<Tone, string> = {
  neutral: 'bg-foreground', info: 'bg-info', success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', muted: 'bg-muted-foreground',
}

export function StatusBadge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12.5px] font-medium whitespace-nowrap',
      tone === 'warning' && 'text-warning', tone === 'danger' && 'text-destructive', tone === 'muted' && 'text-muted-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', DOT[tone])} aria-hidden />
      {children}
    </span>
  )
}

const NOTICE_ICON = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert }
const NOTICE_COLOR = { info: 'text-info', success: 'text-success', warning: 'text-warning', danger: 'text-destructive' }

/** Un aviso dentro de la pantalla (p. ej. «Nota guardada»). El fondo no se colorea: solo el icono. */
export function Notice({ tone = 'info', title, children, action, className }: { tone?: keyof typeof NOTICE_ICON; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = NOTICE_ICON[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-lg border border-border bg-background px-3.5 py-3', className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', NOTICE_COLOR[tone])} aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px]">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(Boolean(title) && 'mt-0.5 text-muted-foreground')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
