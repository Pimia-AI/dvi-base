# dvi-base

Base mínima de un **módulo de Pimia ERP**. Da a cualquier vertical de negocio lo común:
- el runtime (servidor Node);
- la sesión contra Pimia ERP, con el token de módulo firmado;
- la persistencia en PostgreSQL, con migraciones con historial;
- el kit visual;
- el arranque local con un doble de Pimia;
- la plantilla de un módulo nuevo.

Así, quien construye la vertical (el integrador y su agente) escribe solo el dominio.

Las reglas para quien trabaja aquí están en [`AGENTS.md`](AGENTS.md). El contrato entre el módulo, Pimia ERP y el panel que lo embebe está en [`docs/contrato-embebido.md`](docs/contrato-embebido.md).

## Arranque rápido

Solo hacen falta Node 24 y Docker. Desde la raíz, sin instalar nada:

```sh
npm run up       # el módulo de ejemplo (notas) con PostgreSQL, el doble de Pimia y el anfitrión de desarrollo
npm run doctor   # diagnóstico
npm run down     # parar y borrar
```

Al terminar, `npm run up` dice la URL del anfitrión (`http://127.0.0.1:7161/m/dvi-base-notes/notes`).

Para trabajar en la base: `npm install`, `npm test` (pruebas unitarias) y `npm run test:db` (con un PostgreSQL efímero en Docker).

## Una vertical de módulo, paso a paso

1. **Crear el módulo** desde la plantilla: `npm run new-module -- <clave> --owner <cuenta-del-integrador> --name "Nombre visible"`. Queda en `examples/<clave>`, con:
   - `module.json`: dueño, clave, esquema y ámbitos;
   - `migrations/` y `seeds/`;
   - las pantallas, en `src/ui`;
   - las rutas del servidor, en `src/server`;
   - un `compose.yaml` para el arranque local;
   - un `AGENTS.md` para el agente que lo construye.
2. **Construir el dominio** en el módulo: tablas en `migrations/` (nombres `0001_nombre.sql`), rutas y pantallas con el kit. Se prueba en local contra el doble de Pimia (`npm run up` desde la carpeta del módulo).
3. **Darle su repositorio.** La raíz del módulo es la raíz del repositorio de la vertical: `module.json` y `migrations/` en la raíz, donde los lee el panel de verticales del integrador.
4. **Crear una versión con una etiqueta de Git.** Las versiones las define el integrador: cuando el trabajo está listo para entregarse, marca el commit con una etiqueta `v*` y la empuja:

   ```sh
   git tag v5
   git push origin v5
   ```

   Los commits a `main` sin etiqueta no crean nada en el panel de verticales: solo se comprueba que la imagen construye. Al empujar la etiqueta, la plantilla hace dos cosas con sus dos flujos de GitHub Actions:
   - `.github/workflows/dvi-image.yml` construye la imagen de producción del commit etiquetado (target `module`, con `BUILD_REVISION` igual al commit) sobre esta base en el commit fijado, la publica en GHCR como paquete privado del repositorio y deja su digest;
   - `.github/workflows/dvi-register.yml` la registra como la construcción de la versión de ese commit, con la etiqueta en su nota («versión 5 · v5»).

   Cada versión es una imagen fija: un commit, un digest.
5. **Desplegar por digest** en el servidor del integrador: `deploy/compose.server.yaml` arranca exactamente la imagen `<repositorio>@sha256:…` que le indica el ejecutor de entregas, con la credencial de lectura del registro del propio integrador. El mismo digest en desarrollo, piloto y producción.

## Qué hay aquí

| Carpeta | Qué hay |
| --- | --- |
| `packages/module` | El runtime de un módulo: servidor, sesión contra Pimia ERP, almacén, migraciones, diagnóstico, órdenes `dvi-module` y `new-module` |
| `packages/kit` | El kit de interfaz: tokens, componentes y conexión con el panel (contrato embebido) |
| `packages/pimia-double` | El doble de Pimia ERP para pruebas y desarrollo |
| `packages/dev-host` | El anfitrión de desarrollo: hace en local el papel del panel de Pimia |
| `template/` | La plantilla de un módulo nuevo, con su CI y su compose de servidor |
| `examples/notes` | El módulo de ejemplo (dominio neutro) |
| `docs/` | El contrato embebido, las gramáticas compartidas con Pimia ERP (`docs/contrato/`) y las evidencias técnicas |

## Licencia

La base es de **código visible** bajo la [Licencia del Ecosistema Pimia](LICENSE): se puede leer, clonar, ejecutar y modificar para crear, probar, desplegar y operar verticales que funcionen con el ecosistema Pimia, para uso propio o para clientes. No es de código abierto: usarla fuera del ecosistema, para competir con él o redistribuirla por separado requiere permiso. El código propio de cada vertical es de quien lo escribe (cláusula 4).
