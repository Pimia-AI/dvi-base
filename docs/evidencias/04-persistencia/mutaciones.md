# Las pruebas del paso 4 detectan fallos (salir con 0 no es éxito)

08/11/2026, con el código ya renombrado al inglés. Se rompió a propósito el código, se ejecutaron las pruebas y se
restauró.

| Rotura | Fichero | Pruebas | Resultado |
| --- | --- | --- | --- |
| La ficha de una nota no filtra por empresa (`WHERE tenant_id=$1 AND id=$3`), criterio 4 | `packages/module/tests/example/notes.ts` | `npm run test:db` | 10 pasan, **2 fallan**: «notas en el esquema del módulo: ámbito por instancia y empresa…» (repositorio) y «alta, lista, ficha y edición con versión, acotadas a la empresa» (API) |
| El migrador no compara el checksum de lo ya aplicado (`if (false)`), criterio 5 | `packages/module/src/migrations.ts` | `npm run test:db` y `npm test` | BD: 11 pasan, **1 falla** («una migración ya aplicada que cambia…»); unitarias: 40 pasan, **2 fallan** («el historial tiene que ser un prefijo exacto…» y la prueba de `/readyz`) |
| Restaurado | — | `npm test`, `npm run test:db` | 42 y 12 pasan, 0 fallan |
