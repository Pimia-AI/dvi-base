import { readFileSync } from 'node:fs'
import { createDevHost } from './server'
import { issueFromDouble, peopleFromDouble } from './people'
/**
 * El anfitrión de desarrollo como proceso (compose, servicio `dev-host`). Variables: `MODULE_ORIGIN` (dónde lo ve el
 * navegador), `MODULE_MANIFEST` (su `module.json`), `PIMIA_DOUBLE_URL`, `TENANT`, `UI_DIR`, `HOSTNAME`, `PORT`.
 */
const env = (key: string) => {
  const value = process.env[key]?.trim()
  if (!value) { console.error(`Falta ${key}. Arranque cancelado.`); process.exit(1) }
  return value
}
const manifest = JSON.parse(readFileSync(env('MODULE_MANIFEST'), 'utf8')) as { key: string; name: string; scopes?: string[]; ui?: { screens: { id: string; title: string; path: string; menu?: { group: string; icon: string; order?: number } }[] } }
async function main() {
  const doubleUrl = env('PIMIA_DOUBLE_URL'), tenant = env('TENANT')
  const { people, ids } = await peopleFromDouble(doubleUrl)
  const server = createDevHost({
    moduleOrigin: env('MODULE_ORIGIN'), module: { key: manifest.key, name: manifest.name, screens: manifest.ui?.screens ?? [] }, tenant, people,
    issue: issueFromDouble(doubleUrl, ids, tenant, manifest.scopes ?? []), uiDir: env('UI_DIR'),
  })
  const host = process.env.HOSTNAME?.trim() || '127.0.0.1', port = Number(process.env.PORT || 7161)
  server.listen(port, host, () => console.log(`Anfitrión de desarrollo escuchando en ${host}:${port}`))
  const stop = () => server.close(() => process.exit(0))
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'El anfitrión de desarrollo no arrancó')
  process.exit(1)
})
