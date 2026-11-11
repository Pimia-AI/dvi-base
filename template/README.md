# __NAME__

Módulo de Pimia ERP creado con dvi-base (`npm run new-module -- __KEY__`). Las reglas para el agente están en
[`AGENTS.md`](AGENTS.md).

```sh
npm run up       # arranque local: PostgreSQL, migraciones, datos de ejemplo, módulo, doble de Pimia y anfitrión
npm run doctor   # diagnóstico
npm run down     # parar y borrar
npm run image    # imagen de producción
```

## La imagen de producción, por CI (cuando este módulo es la raíz de su repositorio)

`.github/workflows/dvi-image.yml` construye la imagen una vez por commit de `main` (target `module`, `BUILD_REVISION` = el
commit), la publica en GHCR (privada, con el `GITHUB_TOKEN` del flujo) y deja su digest como nombre de artefacto;
`.github/workflows/dvi-register.yml` la registra en el DVI como la construcción de la versión de ese commit (docs/api.md §22
del DVI). En el servidor, `deploy/compose.server.yaml` arranca exactamente ese digest con el `dvi-executor`.

Hace falta en el repositorio: la variable `DVI_BASE_REF` (el commit de dvi-base, que es público y se clona sin credencial),
el secreto `DVI_CI_TOKEN` (un principal del DVI con `leer` y `publicar` sobre la vertical) y las variables `DVI_URL`,
`DVI_VERTICAL` y `DVI_ENTREGABLE_ID`. En el servidor, la lectura del registro es el token personal del integrador (su
`docker login ghcr.io`, con caducidad; ver la receta del servidor del DVI).

## Licencia de tu módulo

El código que escribas para este módulo es tuyo y lo licencias como quieras: pon tu propio `LICENSE` en la raíz del repositorio de la vertical (el campo `license` de `package.json` apunta a él). Las partes que procedan de dvi-base (los paquetes `@dvi-base/*` y lo que copies de la base) siguen bajo la Licencia del Ecosistema Pimia (cláusula 4).
