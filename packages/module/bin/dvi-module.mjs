#!/usr/bin/env node
/**
 * `dvi-module`: el arranque local, el diagnóstico y la imagen de un módulo, desde su carpeta (la que tiene
 * `module.json` y `compose.yaml`). Sin preguntas y con una línea JSON por paso, para que lo ejecute un agente; código de
 * salida distinto de 0 si algo falla. Solo usa Node y Docker: funciona en un checkout limpio, antes de `npm install`.
 *
 *   dvi-module up       PostgreSQL, migraciones y datos de ejemplo, el módulo, el doble de Pimia y el anfitrión
 *   dvi-module down     lo para y lo borra (los datos locales van en memoria)
 *   dvi-module doctor   comprueba configuración, servicios, migraciones, Pimia (doble) y pantallas
 *   dvi-module image    construye la imagen de producción (etapa `module`) con el commit, y la prueba
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const PORTS = { module: 7160, host: 7161, double: 7162 }
const cwd = process.cwd()
const ENV_FILE = join(cwd, '.dvi', 'local.env')
const line = data => console.log(JSON.stringify(data))
let failed = false
const fail = data => { failed = true; line({ ...data, status: 'error' }) }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  return { code: result.status ?? 1, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}
const compose = (...args) => run('docker', ['compose', '--env-file', ENV_FILE, ...args])
const tail = (text, lines = 12) => text.split('\n').slice(-lines).join('\n')
async function http(path, port = PORTS.module, init = {}) {
  try { return await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000), ...init }) } catch { return null }
}

function readModule() {
  const manifest = JSON.parse(readFileSync(join(cwd, 'module.json'), 'utf8'))
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(manifest.key ?? '') || !/^[a-z][a-z0-9_]{0,62}$/.test(manifest.schema ?? '')) throw new Error('module.json: key o schema no válidos')
  if (!existsSync(join(cwd, 'compose.yaml'))) throw new Error('Falta compose.yaml en la carpeta del módulo')
  return manifest
}
function migrationNames() {
  const dir = join(cwd, 'migrations')
  return existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith('.sql')).sort() : []
}
/** Las contraseñas de la base local: se generan una vez, viven solo en `.dvi/local.env` (fuera de git) y nunca se escriben en la salida. */
function ensureSecrets() {
  if (existsSync(ENV_FILE)) return false
  mkdirSync(join(cwd, '.dvi'), { recursive: true })
  const secret = () => randomBytes(18).toString('hex')
  writeFileSync(ENV_FILE, `# Generado por dvi-module. Solo para el arranque local; no se sube a git.\nDVI_POSTGRES_PASSWORD=${secret()}\nDVI_OWNER_PASSWORD=${secret()}\nDVI_RUNTIME_PASSWORD=${secret()}\n`, { mode: 0o600 })
  return true
}
function firstScreen(manifest) {
  const path = manifest.ui?.screens?.[0]?.path ?? '/app/'
  return path.replace(/^\/app\//, '')
}

async function up() {
  let manifest
  try {
    manifest = readModule()
    if (run('docker', ['info', '--format', '{{.ServerVersion}}']).code !== 0) throw new Error('Docker no responde: arranca Docker Desktop')
    line({ step: 'config', status: 'ok', module: manifest.key, mode: 'double' })
  } catch (error) { return fail({ step: 'config', message: error.message }) }
  line({ step: 'secrets', status: 'ok', created: ensureSecrets(), file: '.dvi/local.env' })

  const start = Date.now()
  const started = compose('up', '-d', '--build', '--wait', '--wait-timeout', '300', '--remove-orphans')
  if (started.code !== 0) {
    const logs = compose('logs', '--no-color', '--tail', '15')
    return fail({ step: 'compose', message: tail(started.err || started.out, 6), logs: tail(logs.out, 30) })
  }
  line({ step: 'compose', status: 'ok', ms: Date.now() - start, services: ['postgres', 'migrate', 'pimia-double', 'module', 'dev-host'] })

  for (const text of compose('logs', 'migrate', '--no-log-prefix', '--no-color').out.split('\n')) {
    try { const data = JSON.parse(text); if (data.step) line(data) } catch {}
  }
  const ready = await http('/readyz')
  if (ready?.status !== 200) return fail({ step: 'module', message: 'El módulo no está listo (/readyz)' })
  const version = await (await http('/api/version'))?.json()
  line({ step: 'module', status: 'ok', ready: true, migrations: version?.migrations?.length ?? null })
  const host = await http('/dev/config', PORTS.host)
  if (host?.status !== 200) return fail({ step: 'host', message: 'El anfitrión de desarrollo no responde' })
  line({ step: 'host', status: 'ok' })
  line({ result: 'ok', urls: {
    host: `http://127.0.0.1:${PORTS.host}/m/${manifest.key}/${firstScreen(manifest)}`,
    module: `http://127.0.0.1:${PORTS.module}/app/${firstScreen(manifest)}`,
    version: `http://127.0.0.1:${PORTS.module}/api/version`,
  } })
}

function down() {
  if (!existsSync(ENV_FILE)) ensureSecrets()
  const stopped = compose('down', '--remove-orphans', '--volumes')
  if (stopped.code !== 0) return fail({ step: 'down', message: tail(stopped.err, 6) })
  line({ step: 'down', status: 'ok' })
}

async function doctor() {
  const check = (name, ok, detail = {}) => (ok ? line({ check: name, status: 'ok', ...detail }) : fail({ check: name, ...detail }))
  let manifest = null
  try { manifest = readModule(); check('module.json', true, { module: manifest.key, schema: manifest.schema, screens: manifest.ui?.screens?.length ?? 0 }) }
  catch (error) { check('module.json', false, { message: error.message }) }
  const names = migrationNames()
  const sequential = names.every((name, index) => name.startsWith(`${String(index + 1).padStart(4, '0')}_`) && /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/.test(name))
  check('migrations', sequential, { files: names.length, ...(sequential ? {} : { message: 'Las migraciones van de 0001_nombre.sql en adelante, sin huecos' }) })
  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}'])
  check('docker', docker.code === 0, docker.code === 0 ? { version: docker.out } : { message: 'Docker no responde' })
  if (!existsSync(ENV_FILE)) { check('services', false, { message: 'No está arrancado: npm run up' }); return }
  const ps = compose('ps', '--all', '--format', 'json')
  const services = ps.out.split('\n').filter(Boolean).map(text => JSON.parse(text))
  for (const name of ['postgres', 'migrate', 'pimia-double', 'module', 'dev-host']) {
    const service = services.find(s => s.Service === name)
    const ok = name === 'migrate' ? service?.State === 'exited' && service?.ExitCode === 0 : service?.State === 'running' && (!service.Health || service.Health === 'healthy')
    check(`service:${name}`, Boolean(ok), service ? { state: service.State, health: service.Health || null } : { message: 'No existe' })
  }
  const health = await http('/healthz'), ready = await http('/readyz')
  check('module:healthz', health?.status === 200)
  check('module:readyz', ready?.status === 200)
  const version = await (await http('/api/version'))?.json().catch(() => null)
  const applied = (version?.migrations ?? []).map(m => `${String(m.version).padStart(4, '0')}_${m.name}.sql`)
  check('module:version', JSON.stringify(applied) === JSON.stringify(names), { module: version?.module ?? null, commit: version?.commit ?? null, applied: applied.length, expected: names.length })
  // La sesión de punta a punta, como la pide una pantalla: el anfitrión pide al doble un token de módulo para la primera
  // persona y su primera empresa, y el módulo lo valida (firma, audiencia, empresa, instancia, plan y revocación).
  const devConfig = await (await http('/dev/config', PORTS.host))?.json().catch(() => null)
  const person = devConfig?.people?.[0], company = person?.companies?.[0]
  const issued = person && company ? await (await http(`/dev/session?person=0&company=${company.id}`, PORTS.host))?.json().catch(() => null) : null
  check('pimia:token', Boolean(issued?.token), { mode: 'double', issuer: 'pimia-double' })
  const who = issued?.token ? await http('/api/session', PORTS.module, { headers: { authorization: `Bearer ${issued.token}`, company: company.id, 'x-pimia-tenant': devConfig.tenant } }) : null
  const session = who?.ok ? (await who.json()).data : null
  check('module:session', Boolean(session) && session.companyId === company.id, session
    ? { user: session.userId, company: session.companyId, tenant: session.tenantId, scopes: session.scopes }
    : { status: who?.status ?? null, error: who ? (await who.json().catch(() => ({}))).error ?? null : null })
  const screen = manifest ? await http(`/app/${firstScreen(manifest)}`) : null
  const csp = screen?.headers.get('content-security-policy') ?? ''
  check('ui', screen?.status === 200 && csp.includes(`frame-ancestors http://127.0.0.1:${PORTS.host}`), { frameAncestors: /frame-ancestors ([^;]+)/.exec(csp)?.[1] ?? null })
  const host = await http('/dev/config', PORTS.host)
  check('host', host?.status === 200)
}

async function image() {
  let manifest
  try { manifest = readModule() } catch (error) { return fail({ step: 'image', message: error.message }) }
  ensureSecrets()
  const revision = run('git', ['rev-parse', 'HEAD'])
  if (revision.code !== 0) return fail({ step: 'image', message: 'No es un repo git: hace falta el commit para BUILD_REVISION' })
  const dirty = run('git', ['status', '--porcelain']).out.length > 0
  const config = JSON.parse(compose('config', '--format', 'json').out || '{}')
  const build = config.services?.module?.build
  if (!build?.context) return fail({ step: 'image', message: 'compose.yaml: el servicio module no dice cómo se construye' })
  const tag = `${manifest.key}:${revision.out.slice(0, 12)}`
  const start = Date.now()
  // `compose config` da el Dockerfile relativo al contexto; `docker build -f`, relativo a la carpeta actual.
  const dockerfile = isAbsolute(build.dockerfile) ? build.dockerfile : join(build.context, build.dockerfile)
  const built = run('docker', ['build', '--target', 'module', '--build-arg', `BUILD_REVISION=${revision.out}`, '-f', dockerfile, '-t', tag, build.context])
  if (built.code !== 0) return fail({ step: 'image', message: tail(built.err, 8) })
  const inspect = JSON.parse(run('docker', ['image', 'inspect', tag]).out)[0]
  line({ step: 'image', status: 'ok', tag, ms: Date.now() - start, size_mb: Math.round(inspect.Size / 1e6), revision: inspect.Config.Labels?.['org.opencontainers.image.revision'], dirty, user: inspect.Config.User, healthcheck: inspect.Config.Healthcheck?.Test?.join(' ') ?? null })
  // Prueba de humo: sin configuración no arranca y no dice ningún valor; con el doble de Pimia, tampoco.
  const bare = run('docker', ['run', '--rm', tag])
  line({ step: 'image:without-config', status: bare.code === 1 && bare.err.includes('Arranque cancelado') ? 'ok' : 'error', exit: bare.code, output: bare.err })
  const withDouble = run('docker', ['run', '--rm', '-e', 'PIMIA_BASE_URL=https://pimia.test.invalid', '-e', 'PIMIA_TENANT_ID=demo', '-e', 'DATABASE_URL=postgresql://x:y@127.0.0.1:1/notes', '-e', 'PIMIA_HOST_ORIGINS=http://127.0.0.1:7161', '-e', 'PIMIA_DOUBLE_URL=http://pimia-double:7162', tag])
  line({ step: 'image:rejects-double', status: withDouble.code === 1 ? 'ok' : 'error', exit: withDouble.code, output: withDouble.err })
  const contents = run('docker', ['run', '--rm', '--entrypoint', 'sh', tag, '-c', 'ls -1 /app; ls /app/ui | head -3; grep -c "PIMIA_DOUBLE_URL no v" server.cjs || true'])
  line({ step: 'image:contents', status: 'ok', listing: contents.out.split('\n') })
  if (bare.code !== 1 || withDouble.code !== 1) failed = true
}

const commands = { up, down, doctor, image }
const command = commands[process.argv[2]]
if (!command) {
  line({ status: 'error', message: `Orden desconocida. Uso: dvi-module ${Object.keys(commands).join(' | ')}` })
  process.exit(2)
}
await command()
if (process.argv[2] === 'doctor') line({ result: failed ? 'error' : 'ok' })
process.exit(failed ? 1 : 0)
