# Reglas para el agente que trabaja en el módulo «__NAME__»

Este módulo es una vertical sobre **Pimia ERP**, hecha con **dvi-base**. Pimia ERP da la identidad, la sesión, la
empresa y los permisos; la base da el servidor, la sesión contra Pimia, la base de datos, las migraciones, el kit de
interfaz y el arranque local. **Tú escribes solo el dominio**: sus tablas, sus rutas y sus pantallas.

## 1. Qué es tuyo y qué no tocas

| Carpeta o fichero | De quién | Qué va ahí |
| --- | --- | --- |
| `module.json` | tuyo | Clave (`key`, la que lleva el plan en Pimia), nombre, esquema y pantallas del módulo |
| `migrations/0001_nombre.sql`… | tuyo | Las tablas del dominio, en orden y sin huecos. Una migración aplicada **no se edita nunca**: se añade otra |
| `seeds/0001_nombre.sql`… | tuyo | Datos de ejemplo para el arranque local (instancia `demo`, empresas 1, 2 y 3 del doble). Nunca llegan a producción |
| `src/server/api.ts` y lo que importe | tuyo | La tabla de rutas (`/api/…`) y sus handlers |
| `src/ui/` | tuyo | Las pantallas, en `/app/…`, hechas con `@dvi-base/kit` |
| `tests/` | tuyo | Las pruebas del dominio |
| `src/server/main.ts`, `Dockerfile`, `compose.yaml`, `.mcp.json` | de la plantilla | No los cambies salvo que haga falta y lo sepa la persona que te dirige |
| `@dvi-base/module`, `@dvi-base/kit`, `@dvi-base/pimia-double`, `@dvi-base/dev-host` | **de la base** | **No se tocan.** Si algo falta en la base, se pide (no se copia ni se parchea aquí) |

## 2. Órdenes

Desde esta carpeta (solo hacen falta Node 24 y Docker; sin preguntas y con una línea JSON por paso):

| Orden | Qué hace |
| --- | --- |
| `npm run up` | PostgreSQL, migraciones y datos de ejemplo, el módulo, el doble de Pimia y el anfitrión de desarrollo. Al terminar dice las URL: abre la del anfitrión (`http://127.0.0.1:7161/m/__KEY__/…`) |
| `npm run doctor` | Comprueba configuración, servicios, migraciones, Pimia (doble) y pantallas. Si algo falla, lo dice y sale con 1 |
| `npm run down` | Lo para y lo borra (los datos locales van en memoria: cada `up` empieza de cero) |
| `npm run image` | La imagen de producción (etapa `module`) con el commit, y su prueba de humo |
| `npm test` | Las pruebas de `tests/` |

Solo un módulo arrancado a la vez: todos usan los puertos 7160 a 7163.

## 3. Reglas del dominio (las comprueba la base o las pruebas)

1. **Cada consulta va acotada por instancia y empresa.** Toda tabla lleva `tenant_id` y `company_id` delante en la clave
   primaria y todo `WHERE` los filtra con `scopeOf(session)`. Sin excepciones: es lo que impide que una empresa vea los
   datos de otra.
2. **Quien decide los permisos es Pimia.** El módulo no tiene usuarios ni login; usa `withModule(request, deps, …, { scope })`
   en cada handler, con un permiso declarado en `scopes` de `module.json`, y nunca da más de lo que el token de módulo
   ya daba. El token no se reenvía a ninguna API. `created_by` es el id de usuario de Pimia.
3. **Alta idempotente:** el id (UUID) lo elige la pantalla; repetir la misma alta devuelve la misma fila y otra distinta
   con ese id es `Conflict` (409). **Edición con `version`:** si no casa, `Conflict`.
4. **Migraciones:** `migrations/0001_nombre.sql`, sin `BEGIN`/`COMMIT` (la transacción la abre el migrador), sin
   `DELETE` para el rol de ejecución (solo tiene `SELECT, INSERT, UPDATE`). Las tablas van al esquema del módulo.
5. **Pantallas:** solo con `@dvi-base/kit` y dentro de `<ModuleApp>`; sin colores literales (solo tokens); sin login;
   el token vive en memoria. Se abren dentro del panel de Pimia (contrato embebido); sueltas dicen «Abre este módulo
   desde Pimia».
6. **Errores** con su código: `ModuleHttpError(422, 'validation', mensaje, errores por campo)`, `404 not_found`,
   `Conflict` (409). Los mensajes, en español y diciendo qué hacer.
7. **Idioma:** el código en inglés (ficheros, variables, tablas, columnas, claves JSON, rutas); lo que lee una persona
   en español (comentarios, textos de pantalla, mensajes, commits).
8. **Nada de secretos en git.** Las contraseñas locales están en `.dvi/local.env` (ignorado); el token del DVI, en la
   variable de entorno `DVI_TOKEN`.

## 4. Cómo se añade…

- **Una tabla:** `migrations/000N_nombre.sql` con `tenant_id`, `company_id`, `id uuid`, `created_by`, `version`, sus
  `CHECK` y la clave primaria `(tenant_id, company_id, id)`. `npm run up` la aplica; `npm run doctor` comprueba que
  `/api/version` la lista.
- **Una ruta:** en `routes` de `src/server/api.ts` (`/api/<algo>`, segmentos variables `:id`) y su handler en
  `handlers` con el mismo nombre y un método por cada uno declarado. Si falta o sobra uno, el módulo no arranca.
- **Una pantalla:** en `module.json` (`ui.screens`, ruta bajo `/app/`) y en `src/ui/screens.tsx`, con el kit. El
  anfitrión la pone en el menú.

## 5. El DVI

`.mcp.json` conecta con el MCP del DVI (`https://dvi-api.taskai.work/v1/mcp`) con `Authorization: Bearer ${DVI_TOKEN}`.
Ahí se acuerdan requisitos y se registran entregas y evidencias.

## 6. Lo que la base todavía no da

El emisor real del token de módulo en Pimia ERP (hasta entonces no se embebe en producción ni se prueba contra una
empresa de pruebas real: en local, el doble de Pimia lo emite igual); leer datos de Pimia desde el backend del módulo
(`needs_from_pimia`). Si el dominio lo necesita, se
pide a quien mantiene la base.
