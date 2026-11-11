import { startModule } from '@dvi-base/module'
import { handlers, manifest, routes } from './api'
/**
 * El arranque del módulo de ejemplo: `node server.cjs` en la imagen, o `node --import tsx src/server/main.ts` en
 * desarrollo. `node server.cjs migrate` aplica sus migraciones.
 */
startModule({ manifest, routes, handlers })
