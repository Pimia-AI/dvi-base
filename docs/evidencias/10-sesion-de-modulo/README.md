# Sesión de módulo con token firmado

**Fecha:** 08/11/2026. **Qué cambia:** la sesión del módulo deja de reenviar el token de la persona a `/me` y
`/bootstrap`, y valida un **token de módulo** firmado por la instancia (`docs/contrato-embebido.md` §4). El doble de
Pimia pasa a emitirlo como lo hará el ERP. Lo de B (OAuth del integrador) se ha borrado entero.

## Los dos defectos que encontró la revisión, corregidos

| Defecto en `packages/module/src/session.ts` | Ahora | Prueba que lo detecta (mutación) |
| --- | --- | --- |
| Reenviaba el bearer a `/me` sin comprobar audiencia: cualquier token de la persona abría el módulo, y el módulo podía usarlo contra toda la API de Pimia | El token no sale del módulo salvo hacia `…/modules/{key}/state` de su instancia. Se comprueban firma (claves públicas de la instancia), emisor construido por el módulo, vida ≤ 10 min, audiencia `owner/key` única, empresa e instancia | Sin comprobar audiencia: falla «audiencia: solo owner/key…». Sin comprobar firma: falla «sin token, mal formado, sin firma…». Sin comprobar empresa: falla «empresa: la cabecera…» |
| Cacheaba el plan por origen, sin la clave del módulo | El estado (plan y revocaciones) se recuerda por `instancia|owner/key`, como mucho 60 s (`max_age` del ERP manda hacia abajo) | Con la memo solo por instancia: falla «el estado se recuerda por instancia + módulo…». Sin revocación: fallan esa y «plan y revocación…» |

Las cinco mutaciones se aplicaron una a una sobre `session.ts` y `token.ts`, se ejecutó
`packages/module/tests/session.test.ts` y se restauró el original (que vuelve a pasar entero).

## Suite de contrato de siete casos contra el doble

[`contrato-doble.json`](contrato-doble.json): el informe saneado (sin tokens) que escribe
`CONTRACT_REPORT=… node --import tsx --test packages/module/tests/contract.test.ts`. Registra la versión del contrato
(`pimia-module-token/0.1`), la del emisor (`pimia-double@0.1.0`), el módulo y el commit (`2507d50`, con el árbol
limpio), y cada caso con lo esperado y lo obtenido:

| Caso | Resultado |
| --- | --- |
| Acceso autorizado | 200 |
| Empresa o instancia ajenas | 403 `forbidden` · 403 `tenant_mismatch` |
| Audiencia equivocada | 401 `wrong_audience` |
| Token caducado o revocado | 401 `token_expired` · 401 `token_revoked` |
| Módulo retirado del plan | 403 `not_in_plan` |
| Ámbito insuficiente | 403 `insufficient_scope` |
| ERP caído | 503 `pimia_unavailable` |

La suite está en `packages/module/src/testing/contract.ts` (exportada como `@dvi-base/module/testing/contract`). El
destino del doble está en `packages/pimia-double/src/contract-target.ts`. Contra el ERP real hará falta otro destino
que pida los tokens al DVI. Eso queda pendiente del lado del ERP.

## Pruebas

- [`salida.txt`](salida.txt): 26 pruebas de sesión, API, `withModule`, suite de contrato y anfitrión de desarrollo.
- `npm test`: 84 de 84. `npm run test:db`: 12 de 12 (PostgreSQL efímero en Docker), con los tokens del doble.
- [`doctor.jsonl`](doctor.jsonl): `npm run up` y `npm run doctor` con todo en verde. El diagnóstico ahora pide un token
  de módulo al anfitrión (que lo pide al doble) y lo valida contra el módulo en `/api/session` (`module:session`:
  persona 7, empresa 1, instancia `demo`, permisos `notes:read notes:write`).
- En el navegador: la pantalla de notas abre en el anfitrión de desarrollo con el token de módulo del doble (comprobado
  por el agente; sin captura nueva, porque la pantalla no cambia).
