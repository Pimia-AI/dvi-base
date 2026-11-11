import { readManifest, type HandlersFor, type RouteDef } from '@dvi-base/module'
import moduleJson from '../../module.json' with { type: 'json' }
/**
 * La API del módulo: su tabla de rutas (bajo `/api/`) y un handler por cada ruta y método. Vacía al crear el módulo; la
 * base ya sirve `/healthz`, `/readyz` y `/api/version`. Cada handler pasa por `withModule(request, deps, …)` y cada
 * consulta va acotada con `scopeOf(session)` (ver `AGENTS.md` §3 y el módulo de ejemplo `examples/notes`).
 */
export const manifest = readManifest(moduleJson)

export const routes = [] as const satisfies readonly RouteDef[]

export const handlers: HandlersFor<typeof routes> = {}
