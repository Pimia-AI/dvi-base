import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
/**
 * El arnés: un PostgreSQL efímero con dos roles. El propietario puede crear en su base; el de ejecución se conecta,
 * pero no crea nada ni lee lo que no se le conceda. Lo arranca `packages/module/src/testing/with-postgres.ts`.
 */
const ownerUrl = process.env.TEST_PG_OWNER_URL
const runtimeUrl = process.env.TEST_PG_RUNTIME_URL

async function connect(url: string | undefined) {
  assert.ok(url, 'Falta la dirección: ejecuta con `npm run test:bd`')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return client
}

test('PostgreSQL 17, escuchando solo en 127.0.0.1', async () => {
  const client = await connect(ownerUrl)
  try {
    const { rows } = await client.query<{ version: string }>("SELECT current_setting('server_version_num') AS version")
    assert.ok(Number(rows[0].version) >= 170000 && Number(rows[0].version) < 180000, rows[0].version)
    assert.equal(new URL(ownerUrl!).hostname, '127.0.0.1')
  } finally {
    await client.end()
  }
})

test('el propietario crea en su base; el de ejecución no crea ni lee sin concesión', async () => {
  const owner = await connect(ownerUrl)
  const runtime = await connect(runtimeUrl)
  try {
    await owner.query('CREATE SCHEMA arnes')
    await owner.query('CREATE TABLE arnes.prueba (id int PRIMARY KEY)')
    await assert.rejects(runtime.query('CREATE SCHEMA ajeno'), { code: '42501' })
    await assert.rejects(runtime.query('CREATE TABLE public.ajena (id int)'), { code: '42501' })
    await assert.rejects(runtime.query('SELECT * FROM arnes.prueba'), { code: '42501' })
    const { rows } = await runtime.query<{ superusuario: string }>("SELECT current_setting('is_superuser') AS superusuario")
    assert.equal(rows[0].superusuario, 'off')
  } finally {
    await owner.query('DROP SCHEMA arnes CASCADE').catch(() => {})
    await owner.end()
    await runtime.end()
  }
})
