import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * El flujo de registro de la plantilla (`template/.github/workflows/dvi-register.yml`), sin clave (docs/api.md §30 del DVI):
 * pide el token OIDC de GitHub Actions con la audiencia que dice el taller y registra la versión construida en
 * `POST /ci/github/builds`, sin secreto ni variables de vertical o entregable; con el secreto `DVI_CI_TOKEN`, la vía antigua.
 *
 * Se ejecuta el `run:` del paso tal cual con bash, con `gh` y `curl` de mentira en el PATH (no sale a Internet): se
 * comprueba qué pide y qué manda, y que el token no sale en la salida salvo en la orden `::add-mask::` que lo oculta.
 */
const WORKFLOW = readFileSync(join(import.meta.dirname, '..', 'template', '.github', 'workflows', 'dvi-register.yml'), 'utf8')
const work = mkdtempSync(join(tmpdir(), 'dvi-register-'))
after(() => rmSync(work, { recursive: true, force: true }))

/** El script del paso: las líneas bajo `run: |`, sin la sangría. */
function script(): string {
  const lines = WORKFLOW.split('\n')
  const start = lines.findIndex(line => /^\s+run: \|\s*$/.test(line))
  assert.ok(start > 0, 'el paso tiene un run: |')
  const body: string[] = []
  let indent = -1
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') { body.push(''); continue }
    const n = line.length - line.trimStart().length
    if (indent < 0) indent = n
    if (n < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}

const DIGEST_HEX = 'ab'.repeat(32)
const COMMIT = '1'.repeat(40)
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJyZXBvIjoieCJ9.firma-de-prueba'
const CI_TOKEN = `dvi_p_${'z'.repeat(43)}`

// gh: el nombre del artefacto de la ejecución de dvi-image. curl: registra cada petición y responde según la URL.
const bin = join(work, 'bin')
spawnSync('mkdir', ['-p', bin])
writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "dvi-image-sha256-${DIGEST_HEX}"\n`)
writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
out=""; url=""; data=""; method=GET; hdrs=()
while [ $# -gt 0 ]; do case "$1" in
  -o) out="$2"; shift 2 ;; -w) shift 2 ;; -X) method="$2"; shift 2 ;; --data) data="$2"; shift 2 ;;
  -H) if [[ "$2" == @* ]]; then hdrs+=("$(cat "\${2#@}")"); else hdrs+=("$2"); fi; shift 2 ;;
  -*) shift ;; *) url="$1"; shift ;;
esac; done
jq -nc --arg u "$url" --arg m "$method" --arg d "$data" '{url: $u, method: $m, data: $d, headers: $ARGS.positional}' --args "\${hdrs[@]}" >> "$STUB_LOG"
case "$url" in
  */salud) code=200; body="$STUB_SALUD" ;;
  https://oidc.test/*) code=200; body='{"value":"${JWT}"}' ;;
  */ci/github/builds) code="$STUB_BUILDS_CODE"; body="$STUB_BUILDS_BODY" ;;
  */versiones) code=201; body='{"version":4}' ;;
  */estados) code=201; body='{}' ;;
  *) code=404; body='{}' ;;
esac
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; echo "$code"; else printf '%s' "$body"; fi
`)
chmodSync(join(bin, 'gh'), 0o755)
chmodSync(join(bin, 'curl'), 0o755)

let n = 0
function run(env: Record<string, string>) {
  const dir = join(work, String(++n))
  spawnSync('mkdir', ['-p', dir])
  const log = join(dir, 'peticiones.jsonl')
  const summary = join(dir, 'summary.md')
  writeFileSync(log, '')
  writeFileSync(summary, '')
  const result = spawnSync('bash', ['-c', script()], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    env: {
      PATH: `${bin}:${process.env.PATH}`, HOME: dir, GITHUB_REPOSITORY: 'Acme-Org/acme-tareas', GITHUB_STEP_SUMMARY: summary,
      DVI_URL: 'https://dvi-api.test/v1', DVI_VERTICAL: '', DVI_ENTREGABLE_ID: '', GH_TOKEN: 'ghs_de_prueba', DVI_CI_TOKEN: '',
      RUN_ID: '900', COMMIT, TAG: 'v1',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.test/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'peticion-de-prueba',
      STUB_LOG: log, STUB_SALUD: '{"estado":"ok","ci_oidc":{"audience":"https://dvi-api.test"}}',
      STUB_BUILDS_CODE: '201', STUB_BUILDS_BODY: '{"version":1,"vertical":{"clave":"tareas"},"entregable":{"clave":"acme-tareas"}}',
      ...env,
    },
  })
  const peticiones = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { url: string; method: string; data: string; headers: string[] })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, peticiones, summary: readFileSync(summary, 'utf8') }
}

test('el flujo pide id-token: write, solo corre tras un push de etiqueta de dvi-image y no mete expresiones de GitHub en el script', () => {
  assert.match(WORKFLOW, /^permissions:\n(?: {2}[^\n]*\n)* {2}id-token: write$/m)
  assert.match(WORKFLOW, /workflow_run:\n\s+workflows: \[dvi-image\]/)
  assert.match(WORKFLOW, /github\.event\.workflow_run\.event == 'push' && startsWith\(github\.event\.workflow_run\.head_branch, 'v'\)/)
  assert.doesNotMatch(script(), /\$\{\{/, 'lo que viene de GitHub entra por variables de entorno, nunca en el texto del script')
  assert.doesNotMatch(WORKFLOW, /secrets\.(?!DVI_CI_TOKEN\b)/, 'ningún otro secreto')
})

test('sin clave: pide el token OIDC con la audiencia del taller y registra en /ci/github/builds con él, sin secreto ni variables de vertical o entregable', () => {
  const r = run({})
  assert.equal(r.status, 0, r.output)
  const [salud, oidc, builds, ...resto] = r.peticiones
  assert.equal(resto.length, 0)
  assert.equal(salud!.url, 'https://dvi-api.test/v1/salud')
  assert.equal(oidc!.url, 'https://oidc.test/token?api-version=2.0&audience=https%3A%2F%2Fdvi-api.test')
  assert.deepEqual(oidc!.headers, ['Authorization: bearer peticion-de-prueba'])
  assert.equal(builds!.url, 'https://dvi-api.test/v1/ci/github/builds')
  assert.equal(builds!.method, 'POST')
  assert.ok(builds!.headers.includes(`authorization: Bearer ${JWT}`), JSON.stringify(builds!.headers))
  assert.deepEqual(JSON.parse(builds!.data), {
    commit: COMMIT, tag: 'v1', build: { ci: 'github_actions', run_id: '900', digest: `sha256:${DIGEST_HEX}`, image: { repository: 'ghcr.io/acme-org/acme-tareas' } },
  })
  assert.match(r.summary, /Construcción registrada: versión 1 · v1 de tareas\/acme-tareas, ghcr\.io\/acme-org\/acme-tareas@sha256:/)
  // El token solo aparece en la orden que lo oculta.
  assert.deepEqual(r.output.split('\n').filter(line => line.includes(JWT)), [`::add-mask::${JWT}`])
  assert.ok(!r.output.includes('peticion-de-prueba'))
})

test('sin clave: DVI_ENTREGABLE_ID, si existe, solo elige el entregable; repetir es 200; un error del taller para el flujo con su código', () => {
  const elegido = run({ DVI_ENTREGABLE_ID: '6f0e3c1a-1b2c-4d3e-8f90-123456789abc' })
  assert.equal(elegido.status, 0, elegido.output)
  assert.equal(JSON.parse(elegido.peticiones[2]!.data).entregable_id, '6f0e3c1a-1b2c-4d3e-8f90-123456789abc')
  const repetida = run({ STUB_BUILDS_CODE: '200', STUB_BUILDS_BODY: '{"version":1,"repeated":true}' })
  assert.equal(repetida.status, 0, repetida.output)
  assert.match(repetida.summary, /ya tenía esta construcción/)
  const ambiguo = run({ STUB_BUILDS_CODE: '409', STUB_BUILDS_BODY: '{"error":"ci_target_ambiguous","message":"…","detalle":{"motivo":"varios_entregables"}}' })
  assert.equal(ambiguo.status, 1)
  assert.match(ambiguo.output, /El taller no registró la construcción \(409\): \{"error":"ci_target_ambiguous"/)
  assert.deepEqual(ambiguo.output.split('\n').filter(line => line.includes(JWT)), [`::add-mask::${JWT}`])
})

test('sin clave: un taller que aún no la acepta o un job sin id-token lo dicen y paran, sin pedir nada más', () => {
  const viejo = run({ STUB_SALUD: '{"estado":"ok"}' })
  assert.equal(viejo.status, 1)
  assert.match(viejo.output, /no acepta todavía la CI sin clave.*DVI_CI_TOKEN/)
  assert.equal(viejo.peticiones.length, 1)
  const sinPermiso = run({ ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' })
  assert.equal(sinPermiso.status, 1)
  assert.match(sinPermiso.output, /falta permissions: id-token: write/)
  assert.equal(sinPermiso.peticiones.length, 1)
})

test('la vía antigua: con el secreto DVI_CI_TOKEN registra como antes, con DVI_VERTICAL y DVI_ENTREGABLE_ID, y no pide el token OIDC', () => {
  const r = run({ DVI_CI_TOKEN: CI_TOKEN, DVI_VERTICAL: 'tareas', DVI_ENTREGABLE_ID: 'e-1' })
  assert.equal(r.status, 0, r.output)
  assert.deepEqual(r.peticiones.map(p => `${p.method} ${p.url}`), [
    'POST https://dvi-api.test/v1/verticales/tareas/entregables/e-1/versiones',
    'POST https://dvi-api.test/v1/verticales/tareas/entregables/e-1/versiones/4/estados',
  ])
  assert.ok(r.peticiones.every(p => p.headers.includes(`authorization: Bearer ${CI_TOKEN}`)))
  assert.ok(!r.output.includes(CI_TOKEN))
  const incompleta = run({ DVI_CI_TOKEN: CI_TOKEN, DVI_VERTICAL: 'tareas' })
  assert.equal(incompleta.status, 1)
  assert.match(incompleta.output, /Con DVI_CI_TOKEN, falta DVI_ENTREGABLE_ID/)
})
