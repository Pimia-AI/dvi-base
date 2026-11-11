import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '../cn'
/**
 * La cáscara de una pantalla del módulo y su cabecera. Dentro del panel de Pimia, el menú, la empresa y las migas los
 * pinta el anfitrión; la pantalla del módulo empieza en su título.
 */
export function Screen({ children, className, width = 'wide' }: { children: ReactNode; className?: string; width?: 'wide' | 'narrow' }) {
  return (
    <main className={cn('mx-auto w-full px-4 pt-6 pb-10 sm:px-8 sm:pt-7', width === 'wide' ? 'max-w-[72rem]' : 'max-w-[48rem]', className)}>
      {children}
    </main>
  )
}

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** La acción principal de la pantalla (un `Button` primario) y, si acaso, alguna secundaria. */
  actions?: ReactNode
  /** Encima del título: volver a la pantalla anterior del módulo. */
  back?: { label: string; href?: string; onClick?: () => void }
  /** Junto al título: el estado del registro, por ejemplo. */
  aside?: ReactNode
}

export function PageHeader({ title, description, actions, back, aside }: PageHeaderProps) {
  return (
    <header className="mb-6">
      {back && (
        <a href={back.href ?? '#'} onClick={back.onClick && (event => { event.preventDefault(); back.onClick!() })}
          className="mb-3 inline-flex items-center gap-1 rounded-sm text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </a>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[62ch]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl leading-tight font-medium tracking-tight text-balance">{title}</h1>
            {aside}
          </div>
          {description && <p className="mt-1.5 text-muted-foreground text-pretty">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** Un bloque con título dentro de una pantalla (p. ej. «Historial»). */
export function Section({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-8 first:mt-0', className)}>
      <h2 className="text-[15px] font-medium">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Pares etiqueta-valor de una ficha, con líneas finas. */
export function DetailList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 border-t border-border sm:grid-cols-[10rem_1fr]">
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="pt-3 text-[13px] text-muted-foreground sm:border-b sm:border-border sm:py-3">{item.label}</dt>
          <dd className="border-b border-border pb-3 sm:py-3">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
