/**
 * La entrega de sesiones de la cáscara a la pantalla del módulo (contrato §6 y §11). El token se pide al servidor del
 * anfitrión en cada `ready` o `request-session`, y la respuesta llega cuando llega: entretanto la persona puede haber
 * cambiado de persona o de empresa, o la pantalla haberse recargado. Por eso:
 *
 * - cada cambio de contexto abre una **generación** nueva (`invalidate`), y una respuesta de otra generación no se
 *   entrega a nadie;
 * - la respuesta va a la ventana que la pidió (`event.source`), no a la que esté montada al llegar;
 * - y lleva el `id` de la petición, para que el módulo descarte una que no sea la suya.
 */
export interface SessionTarget { postMessage(message: unknown, targetOrigin: string): void }
export interface SessionRequest { source: SessionTarget; origin: string; id?: string }
export interface SessionData { token: string; expires_at: string; [key: string]: unknown }

export function createSessionRelay() {
  let generation = 0
  return {
    /** Al cambiar de persona o de empresa, recargar la pantalla o desmontarla: lo pendiente ya no se entrega. */
    invalidate() { generation++ },
    /** Pide la sesión con `load` y la entrega si sigue siendo de esta generación. Devuelve si la entregó. */
    async answer(request: SessionRequest, load: () => Promise<SessionData>): Promise<boolean> {
      const mine = generation
      const data = await load()
      if (mine !== generation) return false
      request.source.postMessage({ pimia: 1, type: 'session', ...(request.id === undefined ? {} : { id: request.id }), data }, request.origin)
      return true
    },
  }
}
