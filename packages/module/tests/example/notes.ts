import type pg from 'pg'
import { Conflict, isUniqueViolation, type Scope } from '../../src/index'
/**
 * El repositorio de notas del módulo de ejemplo. Tiene la forma del repositorio de una vertical anterior
 * en producción: ámbito por instancia y empresa en cada consulta, alta repetible por
 * id y edición con versión. Es lo que la base enseña a hacer, no parte de la base.
 */
export interface Note {
  id: string; tenant_id: string; company_id: string; title: string; body: string | null
  created_by: string; updated_at: string; version: number
}
export type NoteValues = Pick<Note, 'title' | 'body'>
export const PAGE_SIZE = 20

export function validateNote(input: unknown): { values: NoteValues } | { errors: Partial<Record<keyof NoteValues, string>> } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const errors: Partial<Record<keyof NoteValues, string>> = {}
  const text = (key: keyof NoteValues, max: number, required: boolean) => {
    const value = raw[key]
    if (value !== undefined && value !== null && typeof value !== 'string') { errors[key] = 'Valor no válido.'; return null }
    const trimmed = (value ?? '').trim()
    if (!trimmed) { if (required) errors[key] = 'Obligatorio.'; return null }
    if (trimmed.length > max) { errors[key] = `Admite hasta ${max} caracteres.`; return null }
    return trimmed
  }
  const title = text('title', 120, true), body = text('body', 4000, false)
  if (Object.keys(errors).length) return { errors }
  return { values: { title: title!, body } }
}

const columns = `id,tenant_id,company_id,title,body,created_by,to_json(updated_at)#>>'{}' AS updated_at,version::int AS version`

export class NotesRepository {
  constructor(private db: Pick<pg.Pool, 'query'>, private scope: Scope) {}

  async list(page = 1, search = ''): Promise<{ notes: Note[]; nextPage: number | null }> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000 || search.length > 120) throw new RangeError('page')
    const result = await this.db.query<Note>(
      `SELECT ${columns} FROM notes WHERE tenant_id=$1 AND company_id=$2
       AND ($3::text='' OR title ILIKE '%'||$3||'%' OR body ILIKE '%'||$3||'%')
       ORDER BY lower(title),id LIMIT $4 OFFSET $5`,
      [this.scope.tenantId, this.scope.companyId, search.trim(), PAGE_SIZE + 1, (page - 1) * PAGE_SIZE])
    return { notes: result.rows.slice(0, PAGE_SIZE), nextPage: result.rows.length > PAGE_SIZE ? page + 1 : null }
  }

  async get(id: string): Promise<Note | null> {
    const result = await this.db.query<Note>(`SELECT ${columns} FROM notes WHERE tenant_id=$1 AND company_id=$2 AND id=$3`, [this.scope.tenantId, this.scope.companyId, id])
    return result.rows[0] ?? null
  }

  /** Alta con id elegido por quien llama: repetir la misma alta devuelve la misma nota; otra distinta con ese id es conflicto. */
  async create(id: string, values: NoteValues, createdBy: string): Promise<Note> {
    try {
      const result = await this.db.query<Note>(
        `INSERT INTO notes(tenant_id,company_id,id,title,body,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
        [this.scope.tenantId, this.scope.companyId, id, values.title, values.body, createdBy])
      return result.rows[0]
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const row = await this.get(id)
      if (row && row.created_by === createdBy && row.version === 1 && row.title === values.title && row.body === values.body) return row
      throw new Conflict('Ya existe otra nota con ese id.')
    }
  }

  /** `null` si la nota no existe en este ámbito; conflicto si existe con otra versión. */
  async update(id: string, version: number, values: NoteValues): Promise<Note | null> {
    if (!Number.isSafeInteger(version) || version < 1) throw new Conflict()
    const result = await this.db.query<Note>(
      `UPDATE notes SET title=$4,body=$5,version=version+1,updated_at=now()
       WHERE tenant_id=$1 AND company_id=$2 AND id=$3 AND version=$6 RETURNING ${columns}`,
      [this.scope.tenantId, this.scope.companyId, id, values.title, values.body, version])
    if (result.rows[0]) return result.rows[0]
    if (await this.get(id)) throw new Conflict()
    return null
  }
}
