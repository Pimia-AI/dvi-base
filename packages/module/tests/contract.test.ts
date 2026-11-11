/**
 * La suite de contrato de la sesión de módulo contra el doble de Pimia: el bundle de desarrollo del
 * módulo de ejemplo, en modo vertical (`https://{tenant}.…`), y el doble como emisor. Los siete casos tienen que salir
 * como dice el contrato. Con `CONTRACT_REPORT=<fichero>`, escribe el informe saneado (sin tokens) para las evidencias.
 * La misma suite correrá contra el ERP real con otro destino cuando exista el emisor (criterio 3, pendiente).
 */
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createPimiaDouble } from '@dvi-base/pimia-double'
import { doubleTarget } from '@dvi-base/pimia-double/contract-target'
import { runContractSuite, CONTRACT_CASES } from '../src/testing/contract'
import { build, cleanup, server, unusedPort, live, assert, MIGRATIONS_DIR, BUNDLE_DEV, type Instance } from './bundle-process'
import { manifest } from './example/module'

const BASE_URL = 'https://{tenant}.pimia.test.invalid'
let moduleUrl = '', doubleUrl = '', instance: Instance | undefined
const double = createPimiaDouble({ owner: manifest.owner, key: manifest.key, baseUrl: BASE_URL })
before(async () => {
  await build()
  await new Promise<void>(resolve => double.listen(0, '127.0.0.1', resolve))
  doubleUrl = `http://127.0.0.1:${(double.address() as AddressInfo).port}`
  const port = await unusedPort()
  instance = server({ PATH: process.env.PATH, NODE_ENV: 'test', PIMIA_DOUBLE_URL: doubleUrl, PIMIA_BASE_URL: BASE_URL,
    DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/notas', MIGRATIONS_DIR, HOSTNAME: '127.0.0.1', PORT: String(port) }, BUNDLE_DEV)
  assert.equal(await live(port), true)
  moduleUrl = `http://127.0.0.1:${port}`
})
after(async () => { await instance?.stop(); double.close(); cleanup() })

test('suite de contrato contra el doble: los siete casos', async () => {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'desconocido'
  const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim().length > 0
  const report = await runContractSuite(doubleTarget(doubleUrl, { owner: manifest.owner, key: manifest.key }), {
    url: moduleUrl, key: manifest.key, commit: dirty ? `${commit}+cambios` : commit,
    scopeProbe: { method: 'POST', path: '/api/notes', scope: 'notes:write', body: { id: '00000000-0000-4000-8000-000000000000', title: 'x', body: '' } },
    baseScopes: ['notes:read'],
  })
  if (process.env.CONTRACT_REPORT) writeFileSync(process.env.CONTRACT_REPORT, JSON.stringify(report, null, 2) + '\n')
  assert.deepEqual(report.cases.map(c => c.id), CONTRACT_CASES.map(c => c.id))
  for (const result of report.cases) assert.ok(result.ok, `${result.title}: ${JSON.stringify(result.checks)}`)
  assert.equal(report.result, 'ok')
  assert.doesNotMatch(JSON.stringify(report), /eyJ/, 'el informe no lleva tokens')
})
