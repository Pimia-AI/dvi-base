/** Lo común de las pruebas de un módulo nuevo: copias de la base como las vería un clon. */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const REPO = join(import.meta.dirname, '..')

/** Una copia del árbol de trabajo de dvi-base tal como lo vería un clon: lo versionado y lo nuevo no ignorado. */
export function snapshot(dest: string): string {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const file of files) {
    if (!existsSync(join(REPO, file))) continue
    mkdirSync(dirname(join(dest, file)), { recursive: true })
    cpSync(join(REPO, file), join(dest, file))
  }
  return dest
}

export const jsonLines = (text: string) => text.trim().split('\n').filter(text => text.startsWith('{')).map(text => JSON.parse(text))
