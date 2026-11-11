/**
 * `module.json`: lo que un módulo declara de sí mismo (`docs/contrato-embebido.md` §2). La base usa `owner` y `key` (la
 * audiencia del token de módulo: `owner/key`, §4), `name` (registros), `schema` (su sitio en Postgres), `scopes` (los
 * permisos que el token puede llevar y que las rutas exigen), `ui` (las pantallas) y `needs_from_pimia`.
 */
export interface Screen {
  id: string
  title: string
  path: string
  menu?: { group: string; icon: string; order?: number }
}
export interface Manifest {
  /** La cuenta de integrador de Pimia ERP dueña del módulo. */
  owner: string
  key: string
  name: string
  schema: string
  /** Los permisos propios del módulo (`notes:read`, `notes:write`). Pimia ERP los da por rol en el token de módulo. */
  scopes?: string[]
  ui?: { screens: Screen[] }
  needs_from_pimia?: { operation: string; scope: string }[]
}

const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/
/*
 * La gramática común de ámbitos y pantallas con Pimia ERP (`docs/contrato-embebido.md` §2): la misma en los dos lados,
 * con los casos compartidos en `docs/contrato/module-scope-grammar.json` y `module-ui-grammar.json`. Si cambias algo
 * aquí, cambia esos ficheros en los dos repos. En JavaScript, sin la bandera `m`, `$` ya es fin absoluto: un salto de
 * línea final no pasa (en PHP, el ERP usa `\z`).
 */
/** Un permiso del módulo: de dos a cuatro segmentos en minúsculas separados por `:` (`notes:write`). */
export const SCOPE = /^[a-z][a-z0-9-]{0,40}(:[a-z][a-z0-9-]{0,40}){1,3}$/
export const SCOPE_MAX_LENGTH = 48
export const SCOPES_MAX = 16
const SCREEN_ID = /^[a-z][a-z0-9-]{0,40}$/
const SCREEN_PATH = /^\/app\/[a-z0-9-]+(\/[a-z0-9-]+)*$/
const SCREEN_PATH_MAX = 200
const SCREEN_TITLE_MAX = 60
const SCREENS_MAX = 20
const MENU_GROUP_MAX = 40
/** Un nombre de la librería de iconos del anfitrión (lucide), no una imagen. */
const MENU_ICON = /^[a-z0-9-]{1,40}$/
const MENU_ORDER_MIN = 0
const MENU_ORDER_MAX = 1000

/** Un permiso con la gramática común: forma y tope de tamaño. */
export function isScope(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SCOPE_MAX_LENGTH && SCOPE.test(value)
}
/** Caracteres, no unidades UTF-16: el ERP cuenta con `mb_strlen`. */
const chars = (value: string) => [...value].length
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const onlyKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const SCHEMA = /^[a-z][a-z0-9_]{0,62}$/
const RESERVED_SCHEMAS = new Set(['public', 'information_schema', 'pg_catalog', 'pg_toast'])

/** Valida un `module.json` ya leído. Lo que no cuadra, error con el campo; nunca se completa por defecto. */
export function readManifest(input: unknown): Manifest {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null
  if (!raw) throw new Error('module.json: tiene que ser un objeto')
  const text = (key: string, max: number) => {
    const value = raw[key]
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`module.json: falta o no vale «${key}»`)
    return value
  }
  const owner = text('owner', 63), key = text('key', 63), name = text('name', 120), schema = text('schema', 63)
  if (!KEY.test(owner)) throw new Error('module.json: «owner» (la cuenta de integrador) va en minúsculas, cifras y guiones (máximo 63)')
  if (!KEY.test(key)) throw new Error('module.json: «key» va en minúsculas, cifras y guiones (máximo 63)')
  if (!SCHEMA.test(schema) || RESERVED_SCHEMAS.has(schema) || schema.startsWith('pg_')) throw new Error('module.json: «schema» no válido')
  const manifest: Manifest = { owner, key, name, schema }
  if (raw.scopes !== undefined) {
    const list = raw.scopes
    if (!Array.isArray(list) || list.length > SCOPES_MAX || list.some(item => !isScope(item)) || new Set(list).size !== list.length) {
      throw new Error(`module.json: «scopes» es una lista sin repetidos de hasta ${SCOPES_MAX} permisos como «notes:write», de ${SCOPE_MAX_LENGTH} caracteres como mucho`)
    }
    manifest.scopes = [...list]
  }
  if (raw.ui !== undefined) manifest.ui = readUi(raw.ui)
  if (raw.needs_from_pimia !== undefined) {
    const list = raw.needs_from_pimia
    if (!Array.isArray(list) || list.some(item => !item || typeof item.operation !== 'string' || typeof item.scope !== 'string')) {
      throw new Error('module.json: «needs_from_pimia» es una lista de {operation, scope}')
    }
    manifest.needs_from_pimia = list.map(item => ({ operation: item.operation, scope: item.scope }))
  }
  return manifest
}

function readUi(value: unknown): { screens: Screen[] } {
  const screens = isRecord(value) && onlyKeys(value, ['screens']) ? value.screens : undefined
  if (!Array.isArray(screens)) throw new Error('module.json: «ui» es {screens} y «ui.screens» es una lista')
  if (screens.length > SCREENS_MAX) throw new Error(`module.json: como mucho ${SCREENS_MAX} pantallas`)
  const ids = new Set<string>()
  return {
    screens: screens.map((p: unknown) => {
      if (!isRecord(p) || typeof p.id !== 'string' || !SCREEN_ID.test(p.id) || ids.has(p.id)) throw new Error('module.json: pantalla sin «id» válido o repetido')
      ids.add(p.id)
      if (!onlyKeys(p, ['id', 'title', 'path', 'menu'])) throw new Error(`module.json: pantalla ${p.id}: solo lleva id, title, path y menu`)
      if (typeof p.title !== 'string' || !p.title.trim() || chars(p.title) > SCREEN_TITLE_MAX) throw new Error(`module.json: pantalla ${p.id} sin «title» o de más de ${SCREEN_TITLE_MAX} caracteres`)
      if (typeof p.path !== 'string' || p.path.length > SCREEN_PATH_MAX || !SCREEN_PATH.test(p.path)) throw new Error(`module.json: pantalla ${p.id}: «path» va bajo /app/ (${SCREEN_PATH_MAX} caracteres como mucho)`)
      const screen: Screen = { id: p.id, title: p.title, path: p.path }
      const menu = p.menu
      if (menu !== undefined) {
        const order = isRecord(menu) ? menu.order : undefined
        if (!isRecord(menu) || !onlyKeys(menu, ['group', 'icon', 'order'])
          || typeof menu.group !== 'string' || !menu.group.trim() || chars(menu.group) > MENU_GROUP_MAX
          || typeof menu.icon !== 'string' || !MENU_ICON.test(menu.icon)
          || (order !== undefined && (!Number.isInteger(order) || (order as number) < MENU_ORDER_MIN || (order as number) > MENU_ORDER_MAX))) {
          throw new Error(`module.json: pantalla ${p.id}: «menu» es {group, icon, order?}: grupo de ${MENU_GROUP_MAX} caracteres como mucho, icono de lucide («notebook») y orden entero de ${MENU_ORDER_MIN} a ${MENU_ORDER_MAX}`)
        }
        screen.menu = { group: menu.group, icon: menu.icon, ...(order === undefined ? {} : { order: order as number }) }
      }
      return screen
    }),
  }
}
