/** Une clases, saltándose las vacías. Sin dependencias: el kit no necesita resolver conflictos de Tailwind. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
