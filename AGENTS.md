# Reglas para quien trabaja en dvi-base (personas y agentes)

1. **Qué es esto.** La base de un módulo de Pimia ERP: el runtime, la sesión contra Pimia ERP, la persistencia, el kit visual,
   el arranque local y la plantilla. El dominio de cada vertical vive en su módulo, nunca en `packages/`.
2. **Idioma: código en inglés, personas en español.** En inglés: nombres de ficheros y carpetas de código, paquetes,
   variables, funciones, tipos, claves de configuración y variables de entorno, claves de JSON y de API, códigos de error,
   tablas y columnas. En español: documentación, comentarios, textos de interfaz y mensajes para personas, commits y PR.
3. **La identidad, las sesiones, los permisos y la empresa los da Pimia ERP.** El módulo es Node + PostgreSQL y valida el
   token de módulo firmado por el ERP ([`docs/contrato-embebido.md`](docs/contrato-embebido.md)); no guarda usuarios ni
   contraseñas.
4. **Sin secretos en el repositorio.** Las contraseñas locales van en `.dvi/local.env` (ignorado por git), los tokens de módulo
   se emiten al momento y no se guardan, y las credenciales de un servidor viven en ese servidor.
5. **Se desarrolla y se prueba en local** (Docker): `npm run up`, `npm test` y `npm run test:db`. El módulo se despliega en el
   servidor de quien lo construye, con la imagen que hace su CI (ver el README).
6. **Ramas y PR pequeños**, con el mensaje en español. Todo cambio de comportamiento va con su prueba; una regresión
   encontrada en una revisión queda como prueba con su nombre.
7. **Lo que se afirma que funciona va con su prueba** en `docs/evidencias/` (salida de comandos, capturas), sin secretos.
   «Salir con 0 no es éxito»: se comprueba el resultado.
8. **Pantallas** con el kit (`packages/kit`): monocromo, acción negra, accesibles y a ancho de móvil.
9. Si algo de una tarea parece mal o imposible, se dice en una frase con la evidencia y se propone la alternativa.
