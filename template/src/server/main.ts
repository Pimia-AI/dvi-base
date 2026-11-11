import { startModule } from '@dvi-base/module'
import { handlers, manifest, routes } from './api'
/**
 * El arranque del módulo: `node server.cjs` en la imagen. `node server.cjs migrate` aplica sus migraciones y, solo en
 * desarrollo, `node server.cjs seed` sus datos de ejemplo. No hace falta tocarlo.
 */
startModule({ manifest, routes, handlers })
