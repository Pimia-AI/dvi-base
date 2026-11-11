import { startModule } from '../../src/index'
import { handlers, manifest, routes } from './module'
/** El arranque del módulo de ejemplo: lo que hace el `src/main.ts` de cualquier módulo. Lo empaqueta la prueba de arranque. */
startModule({ manifest, routes, handlers })
