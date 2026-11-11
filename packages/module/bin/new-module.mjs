#!/usr/bin/env node
/**
 * `npm run new-module -- <nombre>` (desde la raíz del repo): crea un módulo nuevo y vacío desde `template/`, en
 * `examples/<nombre>`, listo para `npm run up`. Sin preguntas; una línea JSON por paso; código distinto de 0 si falla.
 *
 *   <nombre>        en minúsculas, cifras y guiones (2 a 40). Es la clave del módulo en Pimia (`module.json` → `key`),
 *                   el nombre de su paquete y, con `_` en vez de `-`, su esquema en PostgreSQL.
 *   --name "Texto"  el nombre que ve una persona (por defecto, el nombre con mayúscula inicial).
 *   --owner <cuenta> la cuenta de integrador de Pimia ERP dueña del módulo (`module.json` → `owner`; con `key`, la
 *                   audiencia del token de módulo). Por defecto, `dvi-base`: vale para el doble; cámbiala al registrarlo.
 *   --no-install    no ejecuta `npm install` (los workspaces no lo verán hasta que se haga).
 *   --root <dir>    el repo de destino (por defecto, la carpeta actual).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const line = data => console.log(JSON.stringify(data))
const fail = (step, message, code = 1) => { line({ step, status: 'error', message }); process.exit(code) }
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args.splice(index, 2)[1] }
const flag = name => { const index = args.indexOf(name); if (index === -1) return false; args.splice(index, 1); return true }
const displayName = option('--name'), owner = option('--owner') ?? 'dvi-base', root = option('--root') ?? process.cwd(), noInstall = flag('--no-install')
const key = args[0]

if (!key || !/^[a-z][a-z0-9-]{1,39}$/.test(key) || key.endsWith('-')) {
  fail('name', 'Indica el nombre del módulo: minúsculas, cifras y guiones, de 2 a 40, empezando por una letra (npm run new-module -- mi-modulo)', 2)
}
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(owner)) fail('owner', 'La cuenta de integrador (--owner) va en minúsculas, cifras y guiones', 2)
const template = join(import.meta.dirname, '..', '..', '..', 'template')
const rootPackage = join(root, 'package.json')
if (!existsSync(rootPackage) || !(JSON.parse(readFileSync(rootPackage, 'utf8')).workspaces ?? []).includes('examples/*')) {
  fail('root', 'Ejecútalo desde la raíz de dvi-base (su package.json tiene el workspace examples/*)')
}
const dir = join(root, 'examples', key)
if (existsSync(dir)) fail('target', `Ya existe ${relative(root, dir)}: no se pisa nada`)

const values = {
  __OWNER__: owner,
  __KEY__: key,
  __NAME__: displayName?.trim() || key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' '),
  __SCHEMA__: key.replace(/-/g, '_'),
  __DIR__: `examples/${key}`,
  __PACKAGE__: `@dvi-modules/${key}`,
}
if (/["\\<>]/.test(values.__NAME__)) fail('name', 'El nombre visible no puede llevar comillas, barras ni < >')
// Va de título de la pantalla y de grupo del menú: la gramática común con Pimia ERP admite 40 caracteres en el grupo.
if ([...values.__NAME__].length > 40) fail('name', 'El nombre visible tiene como mucho 40 caracteres (es el grupo del menú del panel)', 2)

const files = []
function copy(from, to) {
  for (const entry of readdirSync(from)) {
    const source = join(from, entry), target = join(to, entry)
    if (statSync(source).isDirectory()) { copy(source, target); continue }
    let text = readFileSync(source, 'utf8')
    for (const [placeholder, value] of Object.entries(values)) text = text.split(placeholder).join(value)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
    files.push(relative(dir, target))
  }
}
copy(template, dir)
const leftover = files.filter(file => /__(KEY|NAME|SCHEMA|DIR|PACKAGE)__/.test(readFileSync(join(dir, file), 'utf8')))
if (leftover.length) fail('template', `Quedan marcadores sin sustituir en ${leftover.join(', ')}`)
line({ step: 'template', status: 'ok', dir: relative(root, dir), owner, key, name: values.__NAME__, schema: values.__SCHEMA__, files: files.length })

if (!noInstall) {
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8' })
  if (install.status !== 0) fail('install', `npm install falló: ${(install.stderr || '').trim().split('\n').slice(-3).join(' ')}`)
  line({ step: 'install', status: 'ok', package: values.__PACKAGE__ })
}
line({ result: 'ok', next: [`cd ${relative(root, dir)}`, 'npm run up', 'npm run doctor'] })
