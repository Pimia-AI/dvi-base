import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBundle } from '../src/build'
/** El módulo de ejemplo como proceso de verdad: su bundle, con `node` a secas, como en la imagen. */
const dir = mkdtempSync(join(tmpdir(), 'dvi-module-'))
export const BUNDLE = join(dir, 'server.cjs')
/** El mismo módulo compilado para desarrollo: el único que acepta el doble de Pimia (`PIMIA_DOUBLE_URL`). */
export const BUNDLE_DEV = join(dir, 'server-dev.cjs')
/** Las migraciones del módulo de ejemplo. */
export const MIGRATIONS_DIR = join(import.meta.dirname, 'example', 'migrations')
let built: Promise<void> | undefined
export const build = () => (built ??= Promise.all([
  buildBundle(join(import.meta.dirname, 'example', 'main.ts'), BUNDLE, 'production'),
  buildBundle(join(import.meta.dirname, 'example', 'main.ts'), BUNDLE_DEV, 'development'),
]).then(() => {}))
export const cleanup = () => rmSync(dir, { recursive: true, force: true })

export async function unusedPort(): Promise<number> {
  const listener = net.createServer()
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as net.AddressInfo).port
  await new Promise(resolve => listener.close(resolve))
  return port
}

export interface Instance { child: ChildProcess; exited: Promise<number | null>; output(): string; stop(): Promise<void> }
export function server(env: Record<string, string | undefined>, bundle = BUNDLE): Instance {
  const child = spawn(process.execPath, [bundle], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout!.on('data', x => { output += x }); child.stderr!.on('data', x => { output += x })
  const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', code => resolve(code)); child.once('error', reject) })
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  return { child, exited, output: () => output, stop: async () => { clearTimeout(timer); child.kill('SIGKILL'); await exited } }
}

export async function live(port: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(300) })).status === 200) return true } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}
export { assert }
