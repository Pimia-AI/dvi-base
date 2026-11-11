# Las pruebas detectan fallos (salir con 0 no es éxito)

08/11/2026. Se rompió a propósito el código, se ejecutaron las pruebas afectadas y se restauró. Salida resumida.

| Rotura | Fichero | Pruebas | Resultado |
| --- | --- | --- | --- |
| La sesión no exige que `/bootstrap` lleve la clave del módulo (`if (!carried)` → `if (false)`) | `paquetes/modulo/src/sesion.ts` | `sesion.test.ts`, `api-sesion.test.ts` | 8 pasan, **2 fallan**: «el plan de la instancia tiene que llevar el módulo…» y «sin token, con token caducado, sin empresa o con empresa ajena, el módulo no abre» (el caso `not_in_plan`) |
| Las respuestas dejan de llevar `X-Content-Type-Options: nosniff` | `paquetes/modulo/src/rutas.ts` | `rutas.test.ts`, `servidor.test.ts`, `arranque.test.ts` | 8 pasan, **7 fallan** |
| Restaurado | — | `npm test` | 37 pasan, 0 fallan |
