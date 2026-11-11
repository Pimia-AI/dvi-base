# Contrato embebido: lo que un módulo necesita del anfitrión (versión 1, propuesta)

**Fecha:** 08/11/2026. **Estado:** versión 1, aprobada. El token de módulo lo emite Pimia ERP, firmado, y la sesión
del módulo lo valida sin reenviarlo (§1, §2, §4, §7, §8, §11 a §13). La interfaz del módulo es embebida, al estilo
Shopify.

**Quién implementa qué:**

| Parte | Quién | Dónde |
| --- | --- | --- |
| El módulo (backend y pantallas) | El integrador, con la base | `dvi-base`: `packages/module` y `packages/kit` (lado módulo del contrato) |
| La declaración y el emisor del token de módulo | Pimia | Pimia ERP: `/bootstrap`, claves públicas, emisión, estado y revocación (§3, §4) |
| La petición del token en automatización (D) | DVI | El DVI comprueba la delegación y lo pide al ERP de servidor a servidor (§4.4) |
| El anfitrión | Pimia | El panel web de Pimia ERP (§5 a §9) |
| El anfitrión de desarrollo | La base | `dvi-base/packages/dev-host` (§11): el lado anfitrión, solo para local |

Lo que este documento llama **anfitrión** es el frontend de Pimia ERP, servido por Pimia. El **módulo** corre en el
servidor del integrador. Nada de lo que sigue obliga al integrador a tocar el frontend de Pimia.

## 1. Principios

1. **El módulo no tiene login.** La persona ya está dentro de Pimia ERP; el anfitrión le da al módulo un token y el
   contexto (instancia, empresa, persona).
2. **Quien decide sigue siendo Pimia ERP.** Pimia ERP emite el token de módulo y firma quién es la persona, su empresa,
   su instancia, para qué módulo vale y con qué permisos. El backend del módulo lo valida en cada petición con las
   claves públicas de la instancia y pregunta a Pimia por el plan y las revocaciones (§4). **No reenvía el token** a
   `/me` ni a ninguna API de la persona. Lo que diga el
   anfitrión es una pista; el token firmado lo confirma.
3. **El token que llega al navegador es un token de módulo**: corto, con audiencia del módulo y atado a la persona y
   la empresa. Nunca el token de sesión del panel. Es lo que hace Shopify (token de sesión de la app, no el del
   comerciante).
4. **Sin cookies de terceros.** Dentro de un iframe de otro origen el navegador las bloquea; todo va con
   `Authorization: Bearer`.
5. **Mismo origen para las pantallas y la API del módulo.** La pantalla llama a su backend sin CORS.

## 2. Cómo se declara un módulo

**En el repo del módulo**, `module.json` (lo lee la base al arrancar y al construir):

```json
{
  "owner": "dvi-base",
  "key": "dvi-base-notes",
  "name": "Notas",
  "schema": "notes",
  "scopes": ["notes:read", "notes:write"],
  "ui": {
    "screens": [
      { "id": "notes", "title": "Notas", "path": "/app/notes",
        "menu": { "group": "Ejemplo", "icon": "notebook", "order": 10 } }
    ]
  },
  "needs_from_pimia": []
}
```

- `owner`: la cuenta de integrador de Pimia ERP dueña del módulo. Con `key`, forma la audiencia del token (`owner/key`).
- `key`: la de `modulos_propios[].key` (máximo 63, `IntegradorPlanRequest.php:67`). El backend exige que el plan de
  la instancia la lleve (`not_in_plan` si no; §4.3).
- `scopes`: los permisos propios del módulo. Pimia ERP los da por rol en el token (`scope`); cada ruta del módulo
  exige el suyo (`withModule(…, { scope })`) y sin él responde `403 insufficient_scope`.
- `ui.screens[].path`: siempre bajo `/app/` y con el mismo origen que la API. `menu.icon` es un nombre de la
  librería de iconos del anfitrión (lucide), no una imagen.
- `needs_from_pimia`: las operaciones de la API de Pimia ERP que el módulo usa (`[{operation, scope}]`; Pimia ERP las
  publica hoy como `necesita_de_pimia`, `BootstrapController.php:193`). Acota los scopes del token de módulo (§4).

**Gramática común con Pimia ERP.** Los ámbitos y las pantallas se validan igual en los dos lados: `readManifest`
(`packages/module/src/manifest.ts`) al arrancar el módulo, y el propio ERP al
registrarlo. Lo que vale en un lado no se rechaza en el otro:

| Qué | Regla |
| --- | --- |
| Ámbito (`scopes[]` y cada ámbito del claim `scope`) | `^[a-z][a-z0-9-]{0,40}(:[a-z][a-z0-9-]{0,40}){1,3}$`: de dos a cuatro segmentos, cada uno empezando por letra; 48 caracteres como mucho; 16 ámbitos como mucho, sin repetidos |
| `ui` | Solo `screens`, con 20 pantallas como mucho; cada pantalla solo `id`, `title`, `path` y `menu` |
| `id` | `^[a-z][a-z0-9-]{0,40}$`, sin repetidos |
| `title` | No vacío, 60 caracteres como mucho (caracteres, no bytes) |
| `path` | `^/app/[a-z0-9-]+(/[a-z0-9-]+)*$`, 200 caracteres como mucho |
| `menu` | Solo `group` (no vacío, 40 caracteres), `icon` (nombre de lucide: `^[a-z0-9-]{1,40}$`) y `order` (entero de 0 a 1000, opcional) |

Los casos compartidos están en [`docs/contrato/module-scope-grammar.json`](contrato/module-scope-grammar.json) y
[`docs/contrato/module-ui-grammar.json`](contrato/module-ui-grammar.json): 39 casos, copiados de Pimia ERP (procedencia y huellas en [`docs/contrato/README.md`](contrato/README.md)). Los lee
`packages/module/tests/shared-grammar.test.ts` y, en el ERP, sus propias pruebas. Los patrones terminan en `$`
porque en JavaScript, sin la bandera `m`, ya es fin absoluto; en PHP el ERP usa `\z`. Si la gramática cambia, cambian
los dos ficheros en los dos repos.

**En Pimia ERP**, el integrador registra el módulo como hoy (`IntegradorModuloController`) y le **añade la
declaración de la interfaz** (lo de `ui` de arriba). El **origen** donde corre no es del módulo sino de cada
instalación (`https://notes.integrator.example`): lo fija la instalación (D16 del plan del hito 5) o, en la empresa
de pruebas, el integrador desde el DVI. Hoy Pimia ERP no guarda ninguna dirección de módulo («sin URL, que es del
despliegue del fork», `TenantModulesController.php:88-89`).

## 3. Lo que publica `/bootstrap` (aditivo; contrato 1.13.0 propuesto)

Cada entrada de `modulos_propios` gana un campo `ui`, o `null` si el módulo no tiene pantallas o la instancia no
tiene un origen fijado:

```json
{
  "key": "dvi-base-notes", "name": "Notas", "en_lugar_de": null,
  "control_de_usuarios": [], "necesita_de_pimia": [],
  "ui": {
    "protocol": 1,
    "origin": "https://notes.integrator.example",
    "screens": [ { "id": "notes", "title": "Notas", "path": "/app/notes",
                   "menu": { "group": "Ejemplo", "icon": "notebook", "order": 10 } } ]
  }
}
```

- `origin`: `https://`, sin ruta, query, fragmento ni credenciales (las reglas de `httpsOrigin`).
- Las claves nuevas van en inglés (regla 2); las que ya publica Pimia ERP (`modulos_propios`, `en_lugar_de`…) no se tocan.
- El anfitrión no confía en nada que no venga de aquí: el origen al que manda el token es este, y solo este.

## 4. El token de módulo

Lo **emite Pimia ERP** y solo Pimia ERP. Lo piden el anfitrión, para la persona que está en el panel (E y producción),
o el DVI, de servidor a servidor, para un agente con delegación comprobada (D). Ni el módulo ni el integrador lo
fabrican, ni hay clientes OAuth por instancia ni suplantación de personas.

### 4.1 Forma

Un JWT compacto (`typ: "pimia-module+jwt"`), firmado con **clave asimétrica** de la instancia (`EdDSA`, `ES256` o
`RS256`; nunca `none` ni claves simétricas), con `kid` obligatorio.

| Claim | Valor |
| --- | --- |
| `iss` | El origen de la instancia (`https://demo.taskai.work`) |
| `tenant` | El slug de la instancia |
| `sub` | La persona (id de Pimia ERP); `name`, su nombre para mostrar |
| `act` | `{sub}`: quién lo pidió en nombre de la persona (el DVI o un agente en D). Sin `act`, lo pidió ella desde el panel |
| `company` | La empresa. Una sola: cambiar de empresa es pedir otro token |
| `aud` | `owner/key` del módulo. Una sola audiencia |
| `scope` | Los permisos del módulo que tiene la persona (de los `scopes` declarados), separados por espacios |
| `sid` | La sesión de módulo: lo que se revoca |
| `jti`, `iat`, `exp` | Identificador y vida: 10 minutos como máximo |

### 4.2 Lo que publica la instancia

- `GET /.well-known/pimia-module-keys`: las claves públicas (JWKS). Rotación con `kid` nuevo; las viejas se mantienen
  mientras haya tokens vivos firmados con ellas.
- `GET /api/v1/modules/{key}/state`, con el propio token de módulo como bearer (es lo único que ese token abre en el
  ERP): `{data: {in_plan, revoked_sessions: [sid…], max_age}}`. `401` si el ERP ya no acepta el token.

### 4.3 Cómo lo valida el módulo (`packages/module/src/session.ts` y `token.ts`)

El mismo validador para el doble, para D y para E:

1. La instancia sale de `x-pimia-tenant` con patrón, o de la configuración. El emisor esperado se construye con ella;
   nunca se toma del token. Token de otra instancia: `403 tenant_mismatch`, sin preguntar a nadie.
2. Firma con las claves de esa instancia (memoria de 10 min; un `kid` nuevo las vuelve a pedir). Vida ≤ 10 min, con
   30 s de holgura. Audiencia exacta `owner/key`. Forma, con las mismas reglas que el ERP: ninguna clave JSON repetida
   en la cabecera ni en los claims (comparadas ya decodificadas); ningún carácter de control (`\p{C}`, también un
   salto de línea final) en `iss`, `tenant`, `sub`, `name`, `act.sub`, `company`, `aud`, `sid` ni `jti`; y cada ámbito
   de `scope` con la gramática común del §2, separados por un solo espacio y sin repetidos. Si algo falla: mal formado.
3. `company` del token igual a la cabecera `company`.
4. Estado del módulo en la instancia: memoria por **instancia + módulo**, como mucho 60 s (`max_age` solo la acorta).
   Fuera del plan: `403 not_in_plan`. `sid` revocado: `401 token_revoked`.
5. Permiso de la ruta en `scope`: si falta, `403 insufficient_scope`.

| Código | Cuándo |
| --- | --- |
| `401 unauthorized` | Sin token, mal formado, firma que no vale, emisor o `kid` desconocidos, vida de más de 10 min |
| `401 token_expired` | Caducado |
| `401 wrong_audience` | Emitido para otro módulo, u otra cuenta de integrador |
| `401 token_revoked` | Sesión de módulo revocada |
| `403 tenant_mismatch` / `forbidden` | Instancia / empresa distintas de las de la petición |
| `403 not_in_plan` | El plan de la instancia ya no lleva el módulo |
| `403 insufficient_scope` | El token no trae el permiso que exige la ruta |
| `503 pimia_unavailable` | No se pueden leer las claves o el estado, y no hay nada vigente recordado |

### 4.4 Quién lo pide

- **E y producción:** el anfitrión, con la sesión del panel y la empresa activa. Sin `act`.
- **D (automatización):** el agente, identificado ante el DVI, pide sesión para su empresa de pruebas. El DVI comprueba
  la delegación (concesión vigente, vertical, instalación, alcance) y la solicita al ERP de servidor a servidor. El ERP
  verifica la propiedad y emite, con `act` = quién lo pidió.
- **A (el doble de Pimia):** `packages/pimia-double` emite con esta misma forma, para el día a día y las pruebas.

Se revoca al cerrar la sesión del panel, al quitar el módulo del plan, al retirar la concesión del agente o a mano.

### 4.5 Suite de contrato

Siete casos que el doble y el ERP real tienen que dar igual: acceso autorizado; empresa o instancia ajenas; audiencia
equivocada; token caducado o revocado; módulo retirado del plan; ámbito insuficiente; ERP caído
(`@dvi-base/module/testing/contract`). Se registran la versión del ERP, la del contrato (`pimia-module-token/0.1`), el
commit y los resultados saneados, y se repite al cambiar la sesión, el doble o este contrato. Contra el doble pasa
entera (`docs/evidencias/10-sesion-de-modulo/`). Contra el ERP real, cuando exista el emisor.

## 5. Cómo carga el anfitrión una pantalla

1. Lee `/bootstrap`. Por cada módulo con `ui`, añade al menú sus pantallas (`menu.group`, `title`, `menu.icon`,
   `menu.order`). Hoy el panel ya esconde o enseña entradas por `modulos_propios` (`nav-data.ts:372-381` del fork de vet);
   esto lo hace sin fork y para cualquier módulo.
2. La URL del anfitrión para una pantalla es `/m/{key}/{rest}`, donde `{rest}` es la ruta del módulo sin
   `/app/`. Así funcionan los enlaces directos y el botón Atrás.
3. Pinta un iframe que ocupa todo el área de contenido:

```html
<iframe src="https://notes.integrator.example/app/notes?pimia_protocol=1&pimia_host=https%3A%2F%2Fdemo.taskai.work&pimia_tenant=demo&pimia_company=12&pimia_locale=es-ES&pimia_theme=light"
        title="Notas" referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe>
```

- En la URL va solo contexto que no es secreto, para que la primera pintura salga bien (tema, idioma, empresa).
  **El token nunca va en la URL.**
- `pimia_host` es el origen del anfitrión. El módulo no puede deducirlo (con `referrerpolicy="no-referrer"` no hay
  referente, y `ancestorOrigins` no existe en Firefox), así que lo recibe aquí, **solo lo acepta si está en su lista**
  (`PIMIA_HOST_ORIGINS`) y es el único origen al que envía mensajes. Añadido en el paso 5 al escribir el lado módulo
  (`packages/kit/src/host.ts`).
- `allow-same-origin` hace falta para que el módulo hable con su propio backend. Sin `allow-top-navigation`: el
  módulo no puede sacar a la persona del panel; para eso pide `open` (§6).

## 6. Mensajes entre anfitrión y módulo

`window.postMessage` con objetos JSON `{ "pimia": 1, "type": "...", "id"?: "...", "data"?: {...} }`. `pimia` es la
versión del protocolo. Un mensaje con otra versión o de otro origen se ignora.

**Del módulo al anfitrión:**

| `type` | `data` | Para qué |
| --- | --- | --- |
| `ready` | `{protocols: [1]}`, con `id` | Primer mensaje, al cargar. El anfitrión responde con `session` |
| `request-session` | —, con `id` | Token caducado o a punto de caducar, o un `401` del backend. Respuesta: `session` |
| `title` | `{title, breadcrumbs: [{text, path?}]}` | El anfitrión pone el título en la pestaña del navegador. Las migas son opcionales: el panel actual no las pinta |
| `navigate` | `{path, replace?}` | El módulo cambió de vista. El anfitrión actualiza su URL (`/m/{key}/…`) sin recargar |
| `open` | `{target: "pimia", path}` | Ir a una pantalla de Pimia (p. ej. la ficha de un cliente). El anfitrión decide si la ruta vale |
| `notice` | `{kind: "success" \| "error" \| "info", text}` | Una notificación breve con el sistema del anfitrión |
| `error` | `{code, status}` | El módulo no puede seguir (`not_in_plan`, `forbidden`, `pimia_unavailable`…). El anfitrión puede pintar su propio estado |

**Del anfitrión al módulo:**

| `type` | `data` | Para qué |
| --- | --- | --- |
| `session` | `{token, expires_at, tenant, company: {id, name}, user: {id, name}, locale, theme}`, con el `id` de la petición | Respuesta a `ready` y a `request-session` |
| `go` | `{path}` | La persona usó Atrás o un enlace directo del anfitrión |
| `context-changed` | `{tenant, company}` | Cambió la empresa activa: el módulo retira su conexión (todo rechaza con `context`, sin volver a pedir sesión) y el anfitrión recarga la pantalla con la URL nueva |
| `theme` | `{theme: "light" \| "dark"}` | Cambio de tema en vivo |

**Comprobaciones obligatorias:**

- **Módulo:** solo acepta mensajes de `window.parent` cuyo `event.origin` esté en sus orígenes de anfitrión
  (`PIMIA_HOST_ORIGINS`, con el mismo patrón `{tenant}` que `PIMIA_BASE_URL`), y solo envía a ese origen (nunca a `*`).
  Comprueba que `session.tenant` y `session.company.id` coinciden con los de la URL; si no, `error`.
- **Anfitrión:** solo acepta mensajes con `event.source === iframe.contentWindow` y `event.origin` igual al `origen`
  de `/bootstrap`, y envía la `session` solo a ese origen.
- **Peticiones de sesión (corrección del 08/11, tras la revisión):** `ready` y `request-session` llevan un `id`, y
  el anfitrión **tiene que** devolverlo en `session`. El módulo solo acepta la `session` con el `id` exacto de la
  petición en curso; sin `id`, con otro o sin petición, se ignora. El cierre (`close()`) descarta la sesión y la
  petición en curso. `context-changed` **retira la conexión**: su contexto ya no es el del anfitrión y todo lo que se
  le pida rechaza con `context` hasta que el anfitrión recargue la pantalla con la URL nueva. El anfitrión responde a
  la ventana que pidió (`event.source`) y no entrega una respuesta pedida antes de un cambio de persona, empresa o
  pantalla (`packages/dev-host/src/ui/session-relay.ts`).

## 7. Peticiones de la pantalla a su backend

Mismo origen, `Authorization: Bearer <token de módulo>`, `company: <company.id>`, `x-pimia-tenant: <tenant>`. Son
exactamente las cabeceras que hoy reenvía el panel de vet al módulo (`servidor.ts:30`), y el backend las comprueba igual.

- `401` (cualquiera de los de §4.3): el kit pide `request-session` una vez y repite la petición una vez; si vuelve a
  fallar, `error`.
- El token vive solo en memoria de la pantalla: ni `localStorage`, ni cookies, ni URL, ni registros. El backend del
  módulo tampoco lo registra ni lo reenvía.

## 8. Errores: quién pinta qué

| Código del módulo | Qué pinta el módulo (kit) | Qué hace el anfitrión con `error` |
| --- | --- | --- |
| `401 unauthorized`, `token_expired`, `token_revoked`, `wrong_audience` | Nada: pide sesión | Si no puede dar sesión, manda a iniciar sesión en Pimia |
| `403 insufficient_scope` | «No tienes permiso para esto» en la propia pantalla | Nada |
| `403 not_in_plan` | «Esta empresa no tiene el módulo» | Puede esconder la entrada del menú |
| `403 forbidden`, `company_required`, `tenant_mismatch` | «No tienes acceso con esta empresa» | Nada |
| `503 pimia_unavailable`, `unavailable` | «No se puede cargar ahora» y Reintentar | Nada |
| `409 conflict`, `422 validation` | En la propia pantalla (campo a campo en 422) | Nada |
| El iframe no carga (módulo caído) | — | El anfitrión: «El módulo no responde» tras un plazo sin `ready` (15 s) |

## 9. Seguridad del lado del módulo

- HTML de las pantallas: `Content-Security-Policy: frame-ancestors <orígenes del anfitrión>; default-src 'self'; …`.
  La API sigue con `frame-ancestors 'none'` (como hoy `MODULE_HEADERS`, `rutas.ts:33-38`).
- Sin `X-Frame-Options` en las pantallas (lo sustituye `frame-ancestors`).
- Abierta suelta (sin anfitrión), la pantalla no pide nada y dice «Abre este módulo desde Pimia».

## 10. Versiones

- El protocolo es `1`. Un cambio que añade tipos o campos opcionales no lo sube; uno que rompe, sí, y el módulo
  declara en `ready` qué versiones habla.
- La forma de `/bootstrap` sigue la regla del contrato público de Pimia ERP: aditiva y anunciada en
  `docs/changelog-desarrollador.md`.

## 11. Desarrollo y pruebas: de dónde sale el token

Nunca de un OAuth del integrador ni de un token amplio de una persona. Tres modos, el mismo validador (§4.3):

- **A, el día a día: anfitrión de desarrollo y doble de Pimia.** `dvi-base/packages/dev-host` hace de anfitrión: una
  cáscara con el estilo del panel, el menú sacado de `module.json` y el iframe en `http://127.0.0.1:7160/app/…`. No
  guarda tokens: en cada `ready` y `request-session` pide a su servidor (`/dev/session`) un token de módulo para la
  persona y la empresa elegidas, que emite el doble (`packages/pimia-double`, `/dev/tokens`). Cambiar de persona o de
  empresa recarga la pantalla y pide otro. Todo escucha solo en `127.0.0.1` y nada de esto entra en la imagen de
  producción.
- **D, automatización contra la empresa de pruebas real:** el agente pide sesión al DVI (§4.4) y llama al backend del
  módulo con ese token. Sin pantalla de login. Es lo que usará la suite de contrato contra el ERP real.
- **E, el destino:** la empresa de pruebas del integrador, abierta en el panel real de Pimia con su usuario normal,
  embebe el módulo local. Condiciones:
  - El anfitrión limita `frame-src` al origen de desarrollo registrado para esa instancia y ese módulo, y el módulo
    pone `frame-ancestors` con el origen del anfitrión.
  - El intercambio va por `postMessage`, verificando `origin`, `source` y destinatario (§6).
  - El token vive solo en memoria, nunca en URL ni en registros. Cambiar de empresa destruye la sesión. Sin cookies de
    terceros.
  - El módulo local se publica por un **túnel https** que expone solo el módulo, con comprobación de posesión del
    origen al registrarlo y revocación al cerrarlo.

Es la misma pantalla y el mismo protocolo en los tres: cambia quién emite y quién pide el token, no el módulo.

## 12. Qué se abre en cada frente

**Pimia ERP:**

1. `ui` en el registro del módulo del integrador, y el origen por instancia o instalación (y el origen de desarrollo
   para E, con comprobación de posesión).
2. `modulos_propios[].ui` en `/bootstrap` (contrato 1.13.0) y su entrada en el changelog.
3. El **emisor del token de módulo** (§4): claves asimétricas por instancia y su JWKS, emisión para el panel (E) y
   para el DVI (D), `GET /api/v1/modules/{key}/state` y la revocación por `sid`. Con pruebas de que el token no sirve
   fuera de su audiencia, su empresa, su instancia ni sus permisos, y la suite de contrato del §4.5 pasando.
4. Empresa de desarrollo con restricciones y propietario, y confinamiento obligatorio de ámbitos.

**DVI:** identidad MCP del agente, delegación comprobada, solicitud de la empresa de pruebas, petición del
token al ERP de servidor a servidor (§4.4), registro del origen de desarrollo, cuotas y auditoría.

**Anfitrión (el panel web de Pimia ERP):**

1. Menú por `modulos_propios[].ui.screens`.
2. Ruta `/m/{key}/*` con el iframe del §5.
3. El intercambio de mensajes del §6 con sus comprobaciones, y la petición y renovación del token de módulo.
4. Los estados del §8 (módulo caído, sin plan).

## 13. Preguntas abiertas

1. **Origen web del anfitrión.** ¿El panel de una instancia vive en `https://{tenant}.taskai.work`, igual que su API,
   o en otro dominio? Decide el valor por defecto de `PIMIA_HOST_ORIGINS` y el `frame-ancestors` del módulo.
2. **Operaciones de `needs_from_pimia`.** El token de módulo solo abre en el ERP su propio estado (§4.2). Si el
   backend del módulo necesita leer datos de Pimia (clientes, facturas), hace falta un canje de token con esa
   audiencia y esos scopes. No se ha diseñado: es del frente ERP.
3. **Pantallas fuera del menú** (p. ej. la ficha de una nota abierta desde un enlace de otra pantalla de Pimia):
   ¿basta con `open` desde Pimia hacia `/m/{key}/…`, o hace falta declararlas?
