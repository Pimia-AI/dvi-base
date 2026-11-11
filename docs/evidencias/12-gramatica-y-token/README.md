# Gramática común con Pimia ERP y validador del token endurecido

**Fecha:** 08/11/2026. **Commit:** `3859f1b` (rama `shared-grammar-token-hardening`, desde `main` `087acee`).
**Origen:** el frente de Pimia ERP.

## Parte 1: gramática compartida de ámbitos y pantallas

- Los ficheros de casos del ERP están copiados tal cual en [`docs/contrato/`](../../contrato/), con su procedencia y
  sus huellas SHA-256. Si una copia cambia, la prueba falla.
- `readManifest` ya tiene los topes del ERP:
  - ámbitos: 48 caracteres cada uno, 16 como mucho;
  - pantallas: 20 como mucho;
  - título: 60 caracteres, contados como `mb_strlen`;
  - ruta: 200 caracteres;
  - grupo del menú: 40 caracteres;
  - icono: un nombre de lucide;
  - `order`: de 0 a 1000.

  Como el ERP, `ui` solo admite `screens`, y cada pantalla y su menú solo admiten sus propios campos.
- `packages/module/tests/shared-grammar.test.ts` comprueba los 39 casos uno a uno contra la columna `erp`: los 20 de
  ámbitos con `readManifest` e `isScope`, y los 19 de pantallas con `readManifest`. Además prueba cada tope del
  fichero justo en el límite y con uno más.
- En los 39 casos, dvi-base acepta y rechaza ahora lo mismo que el ERP. Antes difería en tres: el ámbito de 49
  caracteres, el icono `Notebook.svg` y el título de 61.
- `new-module` rechaza un nombre visible de más de 40 caracteres, porque la plantilla lo usa como grupo del menú.
- `docs/contrato-embebido.md` §2 recoge la gramática común y enlaza los ficheros.

## Parte 2: el validador del token de módulo (`packages/module/src/token.ts`)

En `peekModuleToken`, que también usa `verifyModuleToken`, hay tres comprobaciones nuevas:

- **Claves JSON repetidas:** se rechazan en la cabecera y en los claims, comparadas ya decodificadas. Es el mismo
  recorrido lineal que `ModuleJws::hasDuplicateKeys` del ERP.
- **Caracteres de control:** ninguno (`\p{C}`, incluido un salto de línea final) en `iss`, `tenant`, `sub`, `name`,
  `act.sub`, `company`, `aud`, `sid` ni `jti`.
- **Ámbitos del claim `scope`:** cada uno sigue la gramática común. Van separados por un solo espacio, sin repetidos
  y 16 como mucho.

### Regresión cruzada (`packages/module/tests/token-cross.test.ts`)

Usa la clave del ERP (semilla Ed25519 de 32 × 0x01), su `kid` y su vector del 08/11, que se acepta tal cual. La
función `forge` reproduce los bytes del vector. Cada token defectuoso está firmado con la clave buena y lleva un solo
defecto:

- los nueve saltos de línea finales de las pruebas del validador del ERP;
- los cinco duplicados de las pruebas del validador del ERP;
- otros caracteres de control (CR, tabulador, NUL, espacio de ancho cero en el nombre);
- ámbitos fuera de la gramática.

Tabla obtenida con el `verifyModuleToken` de `main` `087acee` y con el de esta rama, sobre los mismos tokens:

| Token | `main` 087acee | Esta rama |
| --- | --- | --- |
| vector del ERP (válido) | acepta (sub "7", scopes ["notes:read","notes:write"]) | acepta (sub "7", scopes ["notes:read","notes:write"]) |
| iss con LF | rechaza (bad_signature) | rechaza (malformed) |
| tenant con LF | acepta (sub "7", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| sub con LF | acepta (sub "7\n", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| company con LF | acepta (sub "7", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| act.sub con LF | acepta (sub "7", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| aud con LF | rechaza (wrong_audience) | rechaza (malformed) |
| scope con LF | acepta (sub "7", scopes ["notes:read\n"]) | rechaza (malformed) |
| sid con LF | rechaza (malformed) | rechaza (malformed) |
| jti con LF | rechaza (malformed) | rechaza (malformed) |
| kid repetido | rechaza (bad_signature) | rechaza (malformed) |
| alg repetido (none, EdDSA) | acepta (sub "7", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| sub repetido | acepta (sub "8", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| sub repetido con escape | acepta (sub "8", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| sub repetido en act | acepta (sub "7", scopes ["notes:read","notes:write"]) | rechaza (malformed) |
| scope «Notes:read» | acepta (sub "7", scopes ["Notes:read"]) | rechaza (malformed) |
| scope repetido | acepta (sub "7", scopes ["notes:read","notes:read"]) | rechaza (malformed) |
| nombre con LF | acepta (sub "7", scopes ["notes:read","notes:write"]) | rechaza (malformed) |

En `main`, el validador aceptaba 12 de los 17 tokens defectuosos. Además de los tres que vio la revisión (`sub` con LF,
`scope` con LF y `sub` repetido, que devolvía «8»), aceptaba también `tenant`, `company` y `act.sub` con LF, `alg`
repetido, `sub` repetido con escape y dentro de `act`, ámbitos fuera de la gramática o repetidos, y un nombre con LF.
`session.ts` paraba después `tenant` y `company` al compararlos con la petición, pero el token ya había pasado la
validación. En esta rama se rechazan los 17 por mal formados.

### Mutaciones

Cada una se aplicó sola sobre el fuente; luego se ejecutaron las pruebas nuevas y se restauró el original, que pasa
entero:

| Mutación | Lo que falla |
| --- | --- |
| Sin la comprobación de caracteres de control en los textos | «un salto de línea final no pasa…» y «ni otros caracteres de control…» |
| Sin la gramática en cada ámbito de `scope` | «un salto de línea final…» (ámbito) y «cada ámbito del claim scope…» |
| Sin el rechazo de claves repetidas | «ninguna clave JSON repetida…» |
| `readManifest` de `main` (sin topes) | los cinco casos de `shared-grammar.test.ts` (49 caracteres, 17 ámbitos, icono, título, campos ajenos) |
| Sin el tope de título | el título de 61, del fichero y del límite |
| Sin el tope de 48 en `isScope` | el ámbito de 49, en `readManifest` y en el claim `scope` |
| Contar el título en unidades UTF-16 en lugar de caracteres | «título de 60 caracteres fuera del plano básico» |

## Suite de contrato, repetida

[`contrato-doble.json`](contrato-doble.json) es el informe saneado (sin tokens) sobre `3859f1b` con el árbol limpio,
contrato `pimia-module-token/0.1` y emisor `pimia-double@0.1.0`. Los siete casos dan lo esperado: 200; 403
`forbidden` · 403 `tenant_mismatch`; 401 `wrong_audience`; 401 `token_expired` · 401 `token_revoked`; 403
`not_in_plan`; 403 `insufficient_scope`; 503 `pimia_unavailable`.

## Pruebas

[`salida.txt`](salida.txt) recoge cuatro ejecuciones:

- las pruebas de gramática, token, plantilla, manifiesto y sesión: 30 de 30;
- `npm test`: 109 de 109;
- `npm run test:db`: 17 de 17 (PostgreSQL efímero en Docker);
- typecheck: limpio.

No se repitieron `up` ni `doctor`, porque este cambio no toca el arranque.

## Para el frente ERP

Las columnas `manifest` de los dos ficheros del ERP describen dvi-base `087acee`. Ahora `readManifest` coincide con
`erp` en los 39 casos, así que esa columna puede igualarse a `erp` en el ERP. Si se hace, se vuelven a copiar los
ficheros aquí con el commit y las huellas nuevas (`docs/contrato/README.md`).
