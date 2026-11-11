import { readModuleConfig, type Environment } from './config'
import { moduleSession } from './session'
import type { ModuleDeps } from './http'
import type { Manifest } from './manifest'
/**
 * Las dependencias reales de los handlers: la sesión contra la instancia, o las instancias, configuradas. Extraído de una vertical
 * anterior en producción.
 *
 * El doble de Pimia (`PIMIA_DOUBLE_URL`), para pruebas y desarrollo: se cambia el destino de las llamadas, no la
 * dirección que se comprueba; el doble recibe la instancia original en `x-pimia-double-host`. Solo `http://` hacia 127.0.0.1 o hacia un nombre de servicio de compose sin puntos
 * (`http://pimia-double:7162`). En el bundle de producción esta rama no existe: `buildBundle` la elimina al
 * compilar (`process.env.DVI_BUILD` = `"production"`), y además la configuración rechaza la variable en producción.
 */
export function pimiaDoubleTarget(value: string | undefined): URL | null {
  if (!value) return null
  const target = new URL(value)
  const hostOk = target.hostname === '127.0.0.1' || /^[a-z][a-z0-9-]{0,62}$/.test(target.hostname)
  if (target.protocol !== 'http:' || !hostOk || target.pathname !== '/' || target.search || target.username) throw new Error('PIMIA_DOUBLE_URL no válida')
  return target
}

export function pimiaTransport(env: Environment = process.env): typeof fetch {
  if (process.env.DVI_BUILD !== 'production' && env.NODE_ENV !== 'production') {
    const target = pimiaDoubleTarget(env.PIMIA_DOUBLE_URL)
    if (target) {
      return (input, init) => {
        const original = new URL(String(input))
        const headers = new Headers(init?.headers)
        headers.set('x-pimia-double-host', original.host)
        return fetch(new URL(original.pathname + original.search, target), { ...init, headers })
      }
    }
  }
  return (input, init) => fetch(input, init)
}

/** Las dependencias de un módulo según su `module.json`. La configuración se lee en cada petición, como en vet. */
export function createModuleDeps(manifest: Pick<Manifest, 'owner' | 'key' | 'scopes'>, env: Environment = process.env): ModuleDeps {
  const transport = pimiaTransport(env)
  return {
    scopes: manifest.scopes ?? [],
    session: headers => moduleSession(headers, { ...readModuleConfig(env), moduleOwner: manifest.owner, moduleKey: manifest.key, fetch: transport }),
  }
}
