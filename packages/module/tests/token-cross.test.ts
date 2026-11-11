/**
 * Regresión cruzada con el validador del ERP (las pruebas del validador de Pimia ERP). Usa la misma clave
 * (semilla Ed25519 de 32 × 0x01), el mismo `kid`, el vector del 08/11 que firma el ERP y los mismos defectos: cada
 * token está bien firmado y lleva un solo defecto. La revisión contrastó doce contra `verifyModuleToken` de dvi-base `087acee`
 * y pasaban tres (`sub` con salto de línea final, `scope` con salto de línea final y `sub` repetido, que daba «8»).
 * Aquí van los nueve saltos de línea y los cinco duplicados del ERP, más los ámbitos fuera de la gramática común.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { verifyModuleToken, hasDuplicateKeys, TokenError, type KeyCache } from '../src/token'

const KID = 'mk_20261108_abcdefgh'
/** El vector del ERP: semilla 32 × 0x01, claims fijos. */
const VECTOR = 'eyJ0eXAiOiJwaW1pYS1tb2R1bGUrand0IiwiYWxnIjoiRWREU0EiLCJraWQiOiJta18yMDI2MTEwOF9hYmNkZWZnaCJ9.eyJpc3MiOiJodHRwczovL3NieC00azJtOXE3YzFhLnRhc2thaS53b3JrIiwidGVuYW50Ijoic2J4LTRrMm05cTdjMWEiLCJzdWIiOiI3IiwibmFtZSI6IkFuYSBJbnRlZ3JhZG9yYSDwnYSeIiwiYWN0Ijp7InN1YiI6ImR2aTpwcmluY2lwYWw6M2YyYyJ9LCJjb21wYW55IjoiMSIsImF1ZCI6ImFjbWUvZHZpLWJhc2Utbm90ZXMiLCJzY29wZSI6Im5vdGVzOnJlYWQgbm90ZXM6d3JpdGUiLCJzaWQiOiJtc19hYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsImp0aSI6IjFiNmU4YzNlLTViMGYtNGMxZS05ZDdhLTJmMWUzYzRiNWE2OSIsImlhdCI6MTc5NDE2NTYwMCwiZXhwIjoxNzk0MTY1OTAwfQ.A4lM4zYuB_58cUExmlESJ7gg5u-xSQlVsK1PrHC27rCPQP-E0nZ2z9pySRQw9pvsaZe9vZKiG381dluh0uTICg'
const ISSUER = 'https://sbx-4k2m9q7c1a.taskai.work', AUDIENCE = 'acme/dvi-base-notes'
const NOW_MS = 1794165610 * 1000

const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 1)]), format: 'der', type: 'pkcs8' })
const jwks = { keys: [{ ...createPublicKey(privateKey).export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'EdDSA' }] }
const transport: typeof fetch = async () => Response.json(jwks)
const verifyOf = (token: string) => verifyModuleToken(token, { issuer: ISSUER, audience: AUDIENCE, fetch: transport, keyCache: new Map() as KeyCache, now: () => NOW_MS })

const HEADER = `{"typ":"pimia-module+jwt","alg":"EdDSA","kid":"${KID}"}`
/** La carga útil del vector, byte a byte, y como objeto. */
const PAYLOAD = Buffer.from(VECTOR.split('.')[1], 'base64url').toString('utf8')
const CLAIMS = JSON.parse(PAYLOAD) as Record<string, unknown>
const b64 = (text: string) => Buffer.from(text).toString('base64url')
/** Re-firma una cabecera y una carga útil arbitrarias con la clave buena. */
function forge(header: string, payload: string | Record<string, unknown>) {
  const signed = `${b64(header)}.${b64(typeof payload === 'string' ? payload : JSON.stringify(payload))}`
  return `${signed}.${sign(null, Buffer.from(signed), privateKey).toString('base64url')}`
}
const malformed = (token: string, label: string) =>
  assert.rejects(verifyOf(token), (e: unknown) => e instanceof TokenError && e.reason === 'malformed', label)

test('el vector del ERP vale aquí tal cual, y forge reproduce sus bytes', async () => {
  assert.equal(forge(HEADER, PAYLOAD), VECTOR)
  const claims = await verifyOf(VECTOR)
  assert.deepEqual([claims.sub, claims.company, claims.tenant, claims.actor, claims.scopes], ['7', '1', 'sbx-4k2m9q7c1a', 'dvi:principal:3f2c', ['notes:read', 'notes:write']])
})

test('un salto de línea final no pasa en ningún claim (los nueve del ERP)', async () => {
  const cases: Record<string, Record<string, unknown>> = {
    iss: { iss: `${ISSUER}\n` },
    tenant: { tenant: 'sbx-4k2m9q7c1a\n' },
    sub: { sub: '7\n' },
    company: { company: '1\n' },
    act: { act: { sub: 'dvi:principal:3f2c\n' } },
    aud: { aud: `${AUDIENCE}\n` },
    'ámbito': { scope: 'notes:read\n' },
    sid: { sid: `ms_${'a'.repeat(26)}\n` },
    jti: { jti: '1b6e8c3e-5b0f-4c1e-9d7a-2f1e3c4b5a69\n' },
  }
  for (const [label, over] of Object.entries(cases)) await malformed(forge(HEADER, { ...CLAIMS, ...over }), label)
})

test('ni otros caracteres de control en los textos, ni en el nombre', async () => {
  const cases: Record<string, Record<string, unknown>> = {
    'sub con retorno de carro': { sub: '7\r' },
    'empresa con tabulador': { company: '\t1' },
    'instancia con NUL': { tenant: 'sbx\u0000x' },
    'nombre con salto de línea': { name: 'Ana\nIntegradora' },
    'nombre con carácter invisible': { name: 'Ana​Integradora' },
    'nombre que no es texto': { name: 7 },
  }
  for (const [label, over] of Object.entries(cases)) await malformed(forge(HEADER, { ...CLAIMS, ...over }), label)
})

test('ninguna clave JSON repetida en la cabecera ni en los claims (los cinco del ERP)', async () => {
  const cases: Record<string, [string, string]> = {
    'kid repetido en la cabecera': [`${HEADER.slice(0, -1)},"kid":"mk_otro"}`, PAYLOAD],
    'alg repetido en la cabecera': [`{"typ":"pimia-module+jwt","alg":"none","alg":"EdDSA","kid":"${KID}"}`, PAYLOAD],
    'sub repetido (ganaba el último: «8»)': [HEADER, `${PAYLOAD.slice(0, -1)},"sub":"8"}`],
    'sub repetido con escape': [HEADER, `${PAYLOAD.slice(0, -1)},"\\u0073ub":"8"}`],
    'sub repetido dentro de act': [HEADER, PAYLOAD.replace('"act":{"sub":"dvi:principal:3f2c"}', '"act":{"sub":"a","sub":"b"}')],
  }
  for (const [label, [header, payload]] of Object.entries(cases)) {
    assert.notEqual(header + payload, HEADER + PAYLOAD, `${label}: el caso cambia algo`)
    await malformed(forge(header, payload), label)
  }
})

test('el detector de duplicados no confunde claves con valores ni con comillas escapadas', async () => {
  const claims = await verifyOf(forge(HEADER, { ...CLAIMS, name: 'sub "sub" sub', act: { sub: 'sub' } }))
  assert.equal(claims.name, 'sub "sub" sub')
  assert.equal(claims.actor, 'sub')
  assert.equal(hasDuplicateKeys('{"a":{"b":1},"b":[{"a":2},{"a":3}],"c":"\\"a\\""}'), false)
  assert.equal(hasDuplicateKeys('{"a":[{"x":1,"x":2}]}'), true)
  assert.equal(hasDuplicateKeys('{"a\\\\":1,"a\\\\":2}'), true)
})

test('cada ámbito del claim scope con la gramática común; vacío es ninguno', async () => {
  const cases: Record<string, string> = {
    'mayúsculas': 'Notes:read',
    'un solo segmento': 'notes',
    'dos espacios seguidos': 'notes:read  notes:write',
    'espacio al final': 'notes:read ',
    'espacio al principio': ' notes:read',
    'repetido': 'notes:read notes:read',
    'de 49 caracteres': `${'a'.repeat(24)}:${'b'.repeat(24)}`,
    '17 ámbitos': Array.from({ length: 17 }, (_, i) => `s${i}:read`).join(' '),
    'tabulador como separador': 'notes:read\tnotes:write',
  }
  for (const [label, scope] of Object.entries(cases)) await malformed(forge(HEADER, { ...CLAIMS, scope }), label)
  assert.deepEqual((await verifyOf(forge(HEADER, { ...CLAIMS, scope: '' }))).scopes, [])
  assert.deepEqual((await verifyOf(forge(HEADER, { ...CLAIMS, scope: Array.from({ length: 16 }, (_, i) => `s${i}:read`).join(' ') }))).scopes.length, 16)
  assert.deepEqual((await verifyOf(forge(HEADER, { ...CLAIMS, scope: `${'a'.repeat(23)}:${'b'.repeat(24)}` }))).scopes, [`${'a'.repeat(23)}:${'b'.repeat(24)}`])
})
