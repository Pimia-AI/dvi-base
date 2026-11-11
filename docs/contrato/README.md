# Casos compartidos con Pimia ERP

Estos ficheros son **copias exactas** de los que publica Pimia ERP. La gramática de ámbitos y pantallas de un módulo
propio es la misma en los dos lados (`docs/contrato-embebido.md` §2).

| Fichero | Origen en Pimia ERP | SHA-256 |
| --- | --- | --- |
| [`module-scope-grammar.json`](module-scope-grammar.json) | Pimia ERP, `docs/modulos/module-scope-grammar.json` (20 casos) | `f484bf6c5d4fb8ca011f43fa76d6aac3dfd0bd15af90f6e27767b27ff2322d34` |
| [`module-ui-grammar.json`](module-ui-grammar.json) | Pimia ERP, `docs/modulos/module-ui-grammar.json` (19 casos) | `148f53389951277da4437e7d1ee34e78bfeae79b89ba5e9582e0836e44c2018b` |

Las dos huellas viven también en `packages/module/tests/shared-grammar.test.ts`, que lee estos ficheros y
comprueba `readManifest` caso a caso. Si alguien cambia una copia sin traerla del ERP, la prueba falla.

**Las dos columnas.** Cada caso tiene dos columnas:

- `erp`: lo que acepta el ERP. Manda y es la que comprueba la prueba.
- `manifest`: lo que hacía `readManifest` en dvi-base `087acee`, antes de los topes.

Las columnas difieren en tres casos: el ámbito de 49 caracteres, el icono `Notebook.svg` y el título de 61. Desde que
`readManifest` tiene los topes, el resultado en dvi-base coincide con `erp` en los 39 casos. Los ficheros no se
retocan aquí: si el ERP iguala la columna `manifest`, se vuelven a copiar con las huellas nuevas.

**Para actualizarlos:**

1. Copia los ficheros del commit del ERP: `git -C <checkout de Pimia ERP> show <commit>:docs/modulos/<fichero>`.
2. Actualiza la tabla de arriba y `SOURCES` en la prueba.
3. Ejecuta `npm test`.
