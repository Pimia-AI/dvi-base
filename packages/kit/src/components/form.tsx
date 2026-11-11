import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '../cn'
/**
 * Campos de formulario. `Field` une etiqueta, ayuda y error con el control (`htmlFor`, `aria-describedby`,
 * `aria-invalid`), de modo que los errores campo a campo de un 422 del módulo se leen junto a su campo.
 */
const CONTROL = 'w-full rounded-md border border-input bg-background px-3 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground hover:border-ring focus:border-foreground focus:ring-3 focus:ring-foreground/10 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus:ring-destructive/15'

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  /** Recibe los atributos que unen el control con su etiqueta, su ayuda y su error. */
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
  className?: string
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {hint && <p id={hintId} className="text-[12.5px] text-muted-foreground">{hint}</p>}
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-[12.5px] text-destructive">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, 'h-9', className)} {...props} />
}

export function TextArea({ className, rows = 4, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(CONTROL, 'min-h-24 resize-y py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, 'h-9 pr-8', className)} {...props}>{children}</select>
}

export function Checkbox({ label, description, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-foreground" {...props} />
      <span>
        <span className="block text-[13.5px] font-medium">{label}</span>
        {description && <span className="block text-[12.5px] text-muted-foreground">{description}</span>}
      </span>
    </label>
  )
}

export interface ChoiceOption<T extends string> { value: T; label: ReactNode; icon?: ReactNode }

/** Opciones excluyentes visibles de un vistazo (radios con forma de botón). El elegido lleva borde de tinta. */
export function ChoiceGroup<T extends string>({ name, label, options, value, onChange }: { name: string; label: string; options: ChoiceOption<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(option => (
        <label key={option.value}
          className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-[13.5px] transition-colors hover:bg-accent has-checked:border-foreground has-checked:font-medium has-checked:shadow-[inset_0_0_0_1px_var(--foreground)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground [&_svg]:size-4">
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
          {option.icon}
          {option.label}
        </label>
      ))}
    </div>
  )
}
