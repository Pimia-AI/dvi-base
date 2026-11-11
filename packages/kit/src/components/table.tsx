import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../cn'
/**
 * Listados de consola: pestañas con recuento («Abiertas 4 · Todas 5»), búsqueda y tabla con cabecera gris y filas de
 * 56 px. Las cifras van en tabular-nums.
 */
export interface CountTab<T extends string> { id: T; label: string; count?: number }

export function CountTabs<T extends string>({ tabs, value, onChange, label }: { tabs: CountTab<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-secondary p-[3px]">
      {tabs.map(tab => {
        const selected = tab.id === value
        return (
          <button key={tab.id} type="button" role="tab" aria-selected={selected} onClick={() => onChange(tab.id)}
            className={cn('h-7 rounded-md px-2.5 text-[13px] transition-colors', selected ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
            {tab.label}
            {tab.count !== undefined && <span className="ml-1.5 text-muted-foreground tabular-nums">{tab.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, label, className }: { value: string; onChange: (value: string) => void; placeholder?: string; label: string; className?: string }) {
  return (
    <label className={cn('relative block w-full sm:w-80', className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}
        className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-[13.5px] outline-none placeholder:text-muted-foreground hover:border-ring focus:border-foreground focus:ring-3 focus:ring-foreground/10" />
    </label>
  )
}

/** La barra de encima de una tabla: pestañas a la izquierda, búsqueda a la derecha. */
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-3">{children}</div>
}

export interface Column<Row> {
  key: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  className?: string
  /** Se esconde en pantallas estrechas (lo secundario). */
  secondary?: boolean
}

export interface DataTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  /** Al pulsar una fila (abre la ficha). La fila se puede alcanzar y activar con el teclado. */
  onRowClick?: (row: Row) => void
  /** Lo que se pinta si no hay filas (un `EmptyState`). */
  empty?: ReactNode
  footer?: ReactNode
  caption: string
}

export function DataTable<Row>({ columns, rows, rowKey, onRowClick, empty, footer, caption }: DataTableProps<Row>) {
  if (!rows.length && empty) return <>{empty}</>
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="bg-secondary">
              {columns.map(column => (
                <th key={column.key} scope="col" className={cn('h-9 border-b border-border px-3.5 text-xs font-medium whitespace-nowrap text-muted-foreground', column.secondary && 'hidden md:table-cell', column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={rowKey(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick && (() => onRowClick(row))}
                onKeyDown={onRowClick && (event => { if (event.key === 'Enter') onRowClick(row) })}
                className={cn('border-b border-border last:border-b-0', onRowClick && 'cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none')}>
                {columns.map(column => (
                  <td key={column.key} className={cn('h-14 px-3.5 py-2.5 align-middle', column.secondary && 'hidden md:table-cell', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="flex flex-wrap justify-between gap-2 px-0.5 pt-2.5 text-[12.5px] text-muted-foreground tabular-nums">{footer}</div>}
    </div>
  )
}
