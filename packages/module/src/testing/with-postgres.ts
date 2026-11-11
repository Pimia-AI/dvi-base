import { spawnSync } from 'node:child_process'
import { startPostgres, prepareDatabase } from './postgres'
/**
 * `node --import tsx with-postgres.ts <ficheros de prueba…>`: arranca un PostgreSQL efímero, prepara la base
 * `module_tests` con sus dos roles y ejecuta las pruebas con `node --test`, una tras otra (comparten base), pasándoles las direcciones en
 * `TEST_PG_ADMIN_URL`, `TEST_PG_OWNER_URL` y `TEST_PG_RUNTIME_URL`. Pase lo que pase, borra el contenedor.
 */
const files = process.argv.slice(2)
if (!files.length) {
  console.error('Indica los ficheros de prueba.')
  process.exit(2)
}
let exitCode = 1
const postgres = await startPostgres().catch(error => {
  console.error(error instanceof Error ? error.message : 'No se pudo arrancar PostgreSQL')
  process.exit(1)
})
try {
  const database = await prepareDatabase(postgres.adminUrl, 'module_tests')
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TEST_PG_ADMIN_URL: postgres.adminUrl,
      TEST_PG_OWNER_URL: database.ownerUrl,
      TEST_PG_RUNTIME_URL: database.runtimeUrl,
    },
  })
  exitCode = result.status ?? 1
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Las pruebas de base de datos fallaron')
} finally {
  postgres.stop()
}
process.exit(exitCode)
