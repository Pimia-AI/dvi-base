import { createPimiaDouble } from './double'
/**
 * El doble de Pimia como proceso (compose, servicio `pimia-double`). `MODULE_OWNER` y `MODULE_KEY`: la audiencia de sus
 * tokens; `PIMIA_BASE_URL` y `PIMIA_TENANT_ID`: los mismos que el módulo, para emitir con el emisor que él espera.
 */
const env = (key: string, optional = false) => {
  const value = process.env[key]?.trim()
  if (!value && !optional) { console.error(`Falta ${key}. Arranque cancelado.`); process.exit(1) }
  return value ?? ''
}
const owner = env('MODULE_OWNER'), key = env('MODULE_KEY')
const host = process.env.HOSTNAME?.trim() || '127.0.0.1', port = Number(process.env.PORT || 7162)
const server = createPimiaDouble({ owner, key, baseUrl: env('PIMIA_BASE_URL'), tenantId: env('PIMIA_TENANT_ID', true) || undefined })
server.listen(port, host, () => console.log(`Doble de Pimia (${owner}/${key}) escuchando en ${host}:${port}`))
const stop = () => server.close(() => process.exit(0))
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
