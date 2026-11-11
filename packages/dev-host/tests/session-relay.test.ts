/** Regresión (revisión): la cáscara no entrega una sesión pedida antes de cambiar de persona o empresa, ni a otra ventana. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionRelay } from '../src/ui/session-relay'

const ORIGIN = 'http://127.0.0.1:7160'
const window_ = () => { const got: { message: unknown; origin: string }[] = []; return { got, postMessage: (message: unknown, origin: string) => { got.push({ message, origin }) } } }
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(ok => { resolve = ok }); return { promise, resolve } }

test('respuesta a tiempo: a la ventana que la pidió, a su origen y con el id de la petición', async () => {
  const relay = createSessionRelay(), frame = window_()
  assert.equal(await relay.answer({ source: frame, origin: ORIGIN, id: 's1' }, async () => ({ token: 't1', expires_at: 'x' })), true)
  assert.deepEqual(frame.got, [{ message: { pimia: 1, type: 'session', id: 's1', data: { token: 't1', expires_at: 'x' } }, origin: ORIGIN }])
})

test('respuesta tardía tras cambiar de persona o empresa: no se entrega a nadie', async () => {
  const relay = createSessionRelay(), old = window_(), current = window_()
  const slow = deferred<{ token: string; expires_at: string }>()
  const late = relay.answer({ source: old, origin: ORIGIN, id: 's1' }, () => slow.promise)
  relay.invalidate() // la persona cambia de empresa: se monta otra pantalla
  const fresh = relay.answer({ source: current, origin: ORIGIN, id: 's1' }, async () => ({ token: 'de-la-empresa-nueva', expires_at: 'x' }))
  slow.resolve({ token: 'de-la-empresa-vieja', expires_at: 'x' })
  assert.equal(await late, false); assert.equal(await fresh, true)
  assert.deepEqual(old.got, [])
  assert.deepEqual(current.got.map(g => (g.message as { data: { token: string } }).data.token), ['de-la-empresa-nueva'])
})

test('si el servidor del anfitrión falla, no se entrega nada y el error sube', async () => {
  const relay = createSessionRelay(), frame = window_()
  await assert.rejects(relay.answer({ source: frame, origin: ORIGIN }, async () => { throw new Error('403') }))
  assert.deepEqual(frame.got, [])
})
