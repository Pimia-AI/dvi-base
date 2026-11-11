import { LayoutGrid } from 'lucide-react'
import { EmptyState, PageHeader, Screen, useModule, useTitle } from '@dvi-base/kit'
/**
 * Las pantallas del módulo. `useModule()` da la sesión (persona y empresa, confirmadas por Pimia), la API del módulo y
 * la navegación (`go('/app/…')`). Al crear el módulo hay una sola, de bienvenida; el módulo de ejemplo
 * (`examples/notes`) enseña una lista, un alta y una ficha.
 */
export function Screens() {
  const { session } = useModule()
  useTitle('__NAME__')
  return (
    <Screen>
      <PageHeader title="__NAME__" description={`Módulo de ${session.company.name}, recién creado.`} />
      <EmptyState icon={<LayoutGrid />} title="Aún no hay pantallas"
        description="Este módulo está recién creado: aquí irán sus pantallas. Empieza por AGENTS.md, que dice qué es del dominio y qué pone la base." />
    </Screen>
  )
}
