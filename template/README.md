# __NAME__

Módulo de Pimia ERP creado con dvi-base (`npm run new-module -- __KEY__`). Las reglas para el agente están en
[`AGENTS.md`](AGENTS.md).

```sh
npm run up       # arranque local: PostgreSQL, migraciones, datos de ejemplo, módulo, doble de Pimia y anfitrión
npm run doctor   # diagnóstico
npm run down     # parar y borrar
npm run image    # imagen de producción
```

## El dueño del módulo: `owner` en `module.json`

`owner` es el **nombre de integrador en Pimia** de quien publica el módulo. La persona lo ve en el taller, en **Cuenta →
«Tu cuenta de Pimia» → «Nombre de integrador en Pimia»**; con el taller enlazado a la cuenta de Pimia es también el nombre
del integrador en el taller. Se pone al crear el módulo (`npm run new-module -- <clave> --owner <nombre de integrador>`)
o se cambia aquí antes de la primera versión. El valor por defecto, `dvi-base`, solo vale para el doble de Pimia del
arranque local. Con `key`, forma la audiencia del token de módulo (`<owner>/<key>`): si `owner` no es el nombre de
integrador de la cuenta, Pimia no registra el módulo y hace falta otra versión con el `module.json` corregido.

## La imagen de producción, por CI (cuando este módulo es la raíz de su repositorio)

Una versión nace cuando marcas un commit con una etiqueta `v*` y la empujas (`git tag v5` y `git push origin v5`). Los
commits a `main` sin etiqueta solo comprueban que la imagen construye: no publican nada ni crean ninguna versión.

Con la etiqueta, `.github/workflows/dvi-image.yml` construye la imagen del commit etiquetado (target `module`,
`BUILD_REVISION` = el commit), la publica en GHCR (privada, con el `GITHUB_TOKEN` del flujo) y deja su digest como nombre de
artefacto; `.github/workflows/dvi-register.yml` la registra en el DVI como la construcción de la versión de ese commit, con la
etiqueta en su nota (docs/api.md §22 del DVI). En el servidor, `deploy/compose.server.yaml` arranca exactamente ese digest
con el `dvi-executor`. El contenedor del módulo se llama `<proyecto>-module-1` (`<proyecto>` es el `-p` del gancho del
ejecutor) y ese es el `container` del módulo en la configuración del ejecutor; no le pongas `container_name`.

Hace falta en el repositorio solo la variable `DVI_BASE_REF` (el commit de dvi-base, que es público y se clona sin
credencial: el de tu clon de dvi-base al crear el módulo, `git rev-parse HEAD`). `dvi-register.yml` registra **sin clave**:
pide el token OIDC de GitHub Actions (`permissions: id-token: write`) con la audiencia que dice el DVI en `GET /v1/salud`
(`ci_oidc.audience`) y el DVI deduce la vertical y el entregable del repositorio (docs/api.md §30 del DVI). Para eso tiene
que existir, en el DVI, este repositorio **vinculado a su vertical como el repositorio del módulo** y **accesible para la
App de GitHub del DVI**. Nada más: ni secretos ni variables de vertical o entregable.

Opcionales: la variable `DVI_URL` (la URL de la API del DVI terminada en `/v1`; por defecto, `https://dvi-api.taskai.work/v1`)
y `DVI_ENTREGABLE_ID`, solo si el DVI responde que el repositorio sirve a más de un entregable (`409 ci_target_ambiguous`).
Un repositorio que ya tiene el secreto `DVI_CI_TOKEN` (un principal del DVI con `leer` y `publicar` sobre la vertical)
sigue con esa vía, con las variables `DVI_VERTICAL` y `DVI_ENTREGABLE_ID`, como antes. En el servidor, la lectura del
registro es el token personal del integrador (su `docker login ghcr.io`, con caducidad; ver la receta del servidor del DVI).

El `.env` del servidor sale de [`.env.example`](.env.example). `PIMIA_HOST_ORIGINS` es la **lista exacta** de anfitriones
que pueden embeber las pantallas, separados por comas: el panel de Pimia del entorno y, cuando exista, la app de tu
producto (`https://<producto>`). Al cambiarla, recrea el contenedor del módulo y comprueba la cabecera de una pantalla
con un GET: `curl -s -o /dev/null -D - https://<origen del módulo>/app/<pantalla>`. Su `Content-Security-Policy` dice
`frame-ancestors` con esos orígenes. Con `curl -I` no se ve: las pantallas solo admiten GET y a un HEAD responden `405`
con las cabeceras de la API (`frame-ancestors 'none'`).

La CI mete el módulo en `__DIR__` sobre dvi-base recién clonado, cuyo `package-lock.json` no lo conoce. El `Dockerfile` lo
añade antes de `npm ci` con `packages/module/bin/module-lock.mjs`; por eso el primer push a `main` de un módulo recién
creado construye sin tocar nada. Sus reglas: nada de lo que la base fija cambia ni se sombrea con otra copia (ningún
`@dvi-base/*` ni otra versión de un paquete de la base debajo del módulo); toda dependencia nueva viene del registro
público de npm (`https://registry.npmjs.org/`) con su `integrity`, sin `file:`, git, otros hosts ni carpetas enlazadas; y
la salida lista todas las entradas nuevas del lock. Si `DVI_BASE_REF` apunta a un commit de
dvi-base sin ese fichero, la construcción falla: usa uno más reciente.

## La carpeta `.dvi/`

Solo se versiona `.dvi/documentos.yml`, la convención con la que el taller lee los documentos de la vertical (entrevistas,
requisitos…). La plantilla trae un ejemplo válido, con la forma explicada en sus comentarios: adáptalo a tus carpetas. Dos
errores que el taller no avisa: `ficheros` es **un** patrón entre comillas (`ficheros: "*.md"`; con `["*.md"]` no casa
con nada y la entrada no lista ningún documento), y `excluir` lleva nombres exactos (un patrón no excluye nada). Lo demás de `.dvi/` es local y git lo ignora: ahí guarda
`npm run up` las contraseñas de `.dvi/local.env`.

## Licencia de tu módulo

El código que escribas para este módulo es tuyo y lo licencias como quieras: pon tu propio `LICENSE` en la raíz del repositorio de la vertical (el campo `license` de `package.json` apunta a él). Las partes que procedan de dvi-base (los paquetes `@dvi-base/*` y lo que copies de la base) siguen bajo la Licencia del Ecosistema Pimia (cláusula 4).
