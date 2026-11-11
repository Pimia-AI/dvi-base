/** Regresión (revisión): el informe de la suite de contrato no lleva secretos ni cuando un caso falla con un error que los contiene. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runContractSuite, suiteErrorCode, responseErrorCode, CONTRACT_CASES, type ContractTarget } from '../src/testing/contract'

const MARKER = 'SYNTHETIC_SECRET_MARKER'
const leaky = (): never => { throw new Error(`Authorization: Bearer ${MARKER}`) }
const target: ContractTarget = {
  kind: 'double', version: async () => 'prueba', tenantFor: id => `t-${id}`.slice(0, 63), company: '1', otherCompany: '2',
  audience: 'o/k', otherAudience: 'o/x', issue: async () => leaky(), revoke: async () => leaky(), retireModule: async () => leaky(), takeDown: async () => leaky(),
}

test('un error con un token dentro no llega al informe: solo un código de lista cerrada', async () => {
  const report = await runContractSuite(target, { url: 'http://127.0.0.1:9', key: 'k', commit: 'c', scopeProbe: { method: 'GET', path: '/api/x', scope: 'x:y' }, baseScopes: [] })
  const text = JSON.stringify(report)
  assert.doesNotMatch(text, new RegExp(MARKER)); assert.doesNotMatch(text, /Bearer|Authorization/i)
  assert.equal(report.result, 'error')
  assert.equal(report.cases.length, CONTRACT_CASES.length)
  for (const result of report.cases) assert.deepEqual(result.checks.map(c => c.got.error), ['suite_error'])
})

test('los códigos del informe salen del tipo de error, nunca de su mensaje', () => {
  const timeout = new Error(MARKER); timeout.name = 'TimeoutError'
  assert.equal(suiteErrorCode(timeout), 'suite_timeout')
  assert.equal(suiteErrorCode(new TypeError(MARKER)), 'suite_network_error')
  assert.equal(suiteErrorCode(new Error(MARKER)), 'suite_error')
  assert.equal(suiteErrorCode(MARKER), 'suite_error')
})

test('regresión (revisión, 2.ª pasada): lo que dice la respuesta HTTP tampoco llega al informe si no es un código conocido', async () => {
  // Un «módulo» que contesta 401 con el marcador como código, y otras formas inesperadas.
  const replies = [{ error: MARKER }, { error: { nested: MARKER } }, { error: 42 }, { error: ['unauthorized', MARKER] }, { error: 'unauthorized', message: MARKER }]
  let n = 0
  const server = createServer((_req, res) => { const body = JSON.stringify(replies[n++ % replies.length]); res.writeHead(401, { 'content-type': 'application/json' }); res.end(body) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const honest: ContractTarget = { ...target, issue: async () => ({ token: `tok-${MARKER}`, sid: 's' }), revoke: async () => {}, retireModule: async () => {}, takeDown: async () => {} }
    const report = await runContractSuite(honest, { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key: 'k', commit: 'c', scopeProbe: { method: 'GET', path: '/api/x', scope: 'x:y' }, baseScopes: [] })
    const text = JSON.stringify(report)
    assert.doesNotMatch(text, new RegExp(MARKER))
    const codes = new Set(report.cases.flatMap(c => c.checks.map(k => k.got.error)))
    assert.ok([...codes].every(code => code === 'unexpected_error_code' || code === 'unauthorized'), [...codes].join(','))
    assert.ok(codes.has('unexpected_error_code'))
  } finally { server.close() }
  assert.equal(responseErrorCode(undefined), null); assert.equal(responseErrorCode('token_revoked'), 'token_revoked')
  assert.equal(responseErrorCode(MARKER), 'unexpected_error_code'); assert.equal(responseErrorCode({ code: 'x' }), 'unexpected_error_code')
})
