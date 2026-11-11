/**
 * Portada de las pruebas de una vertical anterior en producción. Cambia: `VET_TENANT_ID` pasa a
 * `PIMIA_TENANT_ID` (y tiene que ser un slug), y la base del módulo ya no es por fuerza `vet_app`: `DATABASE_URL`
 * es cualquier PostgreSQL con nombre de base. Lo de la app (8-24, 43-88) no se porta.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readModuleConfig, databaseUrl, httpsOrigin, readTenantPattern, tenantOrigin, TENANT_SLUG } from '../src/config'

test('PIMIA_BASE_URL con {tenant}: un patrón del que se construye la dirección de cada instancia', () => {
  assert.equal(readTenantPattern('https://tenant.example'), null)
  assert.deepEqual(readTenantPattern(' https://{tenant}.taskai.work/ '), { prefix: 'https://', suffix: '.taskai.work' })
  assert.deepEqual(readTenantPattern('https://{tenant}.pimia.test:8443'), { prefix: 'https://', suffix: '.pimia.test:8443' })
  for (const bad of ['http://{tenant}.taskai.work', 'https://app.{tenant}.taskai.work', 'https://{tenant}.taskai.work/api', 'https://{tenant}taskai.work', 'https://{tenant}.taskai.work?x=1',
    // Un solo marcador y, detrás, un dominio fijo sin llaves, ni escritas ni codificadas.
    'https://{tenant}.{tenant}.work', 'https://{tenant}.{x}.work', 'https://{tenant}.taskai}.work', 'https://{tenant}.%7Btenant%7D.work']) assert.throws(() => readTenantPattern(bad), bad)
  assert.throws(() => readTenantPattern('https://{tenant}.{tenant}.work'), /un solo marcador/)
  const pattern = readTenantPattern('https://{tenant}.taskai.work')!
  assert.equal(tenantOrigin(pattern, 'demo-sol'), 'https://demo-sol.taskai.work')
  for (const bad of ['', 'Demo', 'a.b', 'con_guion', '-x', 'x'.repeat(64)]) { assert.equal(TENANT_SLUG.test(bad), false, bad); assert.throws(() => tenantOrigin(pattern, bad)) }
})

test('ningún origen lleva llaves: ni escritas, ni codificadas, ni de ancho completo', () => {
  // `new URL` las admite en el host (y pasa `%7B` y `｛` a `{`), así que se rechazan a mano.
  for (const bad of ['https://{tenant}.taskai.work', 'https://{x}.taskai.work', 'https://{TENANT}.taskai.work', 'https://%7Btenant%7D.taskai.work', 'https://%7b.taskai.work',
    'https://｛tenant｝.taskai.work', 'https://a.{b}.work']) assert.throws(() => httpsOrigin(bad), /Origen no permitido/, bad)
  assert.equal(httpsOrigin('https://Demo-Sol.TaskAI.work'), 'https://demo-sol.taskai.work')
})

test('el módulo lee solo lo suyo: PIMIA_BASE_URL y, con dirección fija, PIMIA_TENANT_ID', () => {
  const pattern = { prefix: 'https://', suffix: '.taskai.work' }
  const vertical = { PIMIA_BASE_URL: 'https://{tenant}.taskai.work', NODE_ENV: 'production' }
  assert.deepEqual(readModuleConfig(vertical), { tenantPattern: pattern })
  // Con patrón, PIMIA_TENANT_ID no se lee: la instancia la dice cada petición. Y nada de otras apps.
  assert.deepEqual(readModuleConfig({ ...vertical, PIMIA_TENANT_ID: 'demo', APP_URL: 'https://attacker.example', SESSION_SECRET: '' }), { tenantPattern: pattern })
  // Con dirección fija hay una sola instancia y hay que decir cuál: PIMIA_TENANT_ID obligatoria, y un slug.
  const single = { PIMIA_BASE_URL: 'https://demo.pimia.test', PIMIA_TENANT_ID: ' demo ', NODE_ENV: 'production' }
  assert.deepEqual(readModuleConfig(single), { tenantPattern: null, tenantId: 'demo', apiOrigin: 'https://demo.pimia.test' })
  assert.throws(() => readModuleConfig({ ...single, PIMIA_TENANT_ID: '' }), /PIMIA_TENANT_ID/)
  assert.throws(() => readModuleConfig({ ...single, PIMIA_TENANT_ID: 'Con.Punto' }), /PIMIA_TENANT_ID/)
  // Un marcador mal escrito no pasa por dirección fija, con PIMIA_TENANT_ID o sin ella: el marcador es exactamente {tenant}.
  for (const url of ['https://{TENANT}.taskai.work', 'https://{x}.taskai.work', 'https://%7Btenant%7D.taskai.work', 'https://%7btenant%7d.taskai.work',
    'https://｛tenant｝.taskai.work', 'https://{tenant.taskai.work', 'https://tenant}.taskai.work']) {
    for (const PIMIA_TENANT_ID of ['demo', undefined]) assert.throws(() => readModuleConfig({ ...single, PIMIA_BASE_URL: url, PIMIA_TENANT_ID }), /exactamente \{tenant\}/, `${url} ${PIMIA_TENANT_ID}`)
  }
  for (const PIMIA_TENANT_ID of ['demo', undefined]) {
    assert.throws(() => readModuleConfig({ ...single, PIMIA_BASE_URL: 'https://{tenant}.{tenant}.work', PIMIA_TENANT_ID }), /un solo marcador/)
    assert.throws(() => readModuleConfig({ ...single, PIMIA_BASE_URL: 'https://app.{tenant}.taskai.work', PIMIA_TENANT_ID }), /subdominio/)
  }
  // Bien formado: sin PIMIA_BASE_URL, con origen no HTTPS o con ruta, no hay configuración.
  assert.throws(() => readModuleConfig({ ...single, PIMIA_BASE_URL: undefined }), /PIMIA_BASE_URL/)
  assert.throws(() => readModuleConfig({ ...single, PIMIA_BASE_URL: 'http://demo.pimia.test' }))
  assert.throws(() => readModuleConfig({ ...single, PIMIA_BASE_URL: 'https://demo.pimia.test/api' }))
  // El doble de Pimia, nunca en producción (antes, `TEST_MODE`).
  assert.throws(() => readModuleConfig({ ...single, PIMIA_DOUBLE_URL: 'http://127.0.0.1:7162' }), /doble/)
  assert.throws(() => readModuleConfig({ ...vertical, PIMIA_DOUBLE_URL: 'http://pimia-double:7162' }), /doble/)
  assert.equal(readModuleConfig({ ...single, NODE_ENV: 'test', PIMIA_DOUBLE_URL: 'http://127.0.0.1:7162' }).tenantPattern, null)
})

test('DATABASE_URL: PostgreSQL con nombre de base; si no, no hay configuración y no se dice el valor', () => {
  assert.equal(databaseUrl({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/notas' }), 'postgresql://u:p@127.0.0.1:5432/notas')
  assert.equal(databaseUrl({ DATABASE_URL: 'postgres://u@db/notas?sslmode=require' }), 'postgres://u@db/notas?sslmode=require')
  for (const bad of [undefined, '', 'nada', 'mysql://u@127.0.0.1/notas', 'postgresql://u@127.0.0.1', 'postgresql://u@127.0.0.1/', 'postgresql://u@127.0.0.1/a/b', 'postgresql://u@127.0.0.1/con-guion']) {
    assert.throws(() => databaseUrl({ DATABASE_URL: bad }), (e: unknown) => e instanceof Error && /DATABASE_URL/.test(e.message) && !e.message.includes('127.0.0.1'), String(bad))
  }
})

test('PIMIA_DOUBLE_URL: http a 127.0.0.1 o a un servicio de compose sin puntos; nada más', async () => {
  const { pimiaDoubleTarget } = await import('../src/deps')
  assert.equal(pimiaDoubleTarget(undefined), null)
  assert.equal(pimiaDoubleTarget('http://127.0.0.1:7162')?.host, '127.0.0.1:7162')
  assert.equal(pimiaDoubleTarget('http://pimia-double:7162/')?.host, 'pimia-double:7162')
  for (const bad of ['https://127.0.0.1:7162', 'http://pimia.example.com', 'http://10.0.0.1:7162', 'http://pimia-double:7162/api', 'http://u:p@127.0.0.1:1', 'nada']) {
    assert.throws(() => pimiaDoubleTarget(bad), bad)
  }
})
