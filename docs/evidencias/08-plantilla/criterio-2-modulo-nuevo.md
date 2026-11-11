# Criterio 2: la plantilla crea un módulo nuevo vacío que arranca y responde a /readyz y /api/version

08/11/2026, sobre el commit `12c2d86` más el paso 8 sin commit. El módulo `sample` se crea solo para esta prueba y
después se borra (no forma parte del repo). Captura: `modulo-nuevo-embebido.png`, su pantalla de bienvenida dentro del
anfitrión de desarrollo, con la sesión del doble de Pimia.

```
# 2026-11-08T14:29:42Z  npm run new-module -- sample --name "Módulo de prueba"
{"step":"template","status":"ok","dir":"examples/sample","key":"sample","name":"Módulo de prueba","schema":"sample","files":18}
{"step":"install","status":"ok","package":"@dvi-modules/sample"}
{"result":"ok","next":["cd examples/sample","npm run up","npm run doctor"]}
# código de salida: 0

# cd examples/sample && npm run up
{"step":"config","status":"ok","module":"sample","mode":"double"}
{"step":"secrets","status":"ok","created":true,"file":".dvi/local.env"}
{"step":"compose","status":"ok","ms":16079,"services":["postgres","migrate","pimia-double","module","dev-host"]}
{"step":"migrations","status":"ok","schema":"sample","applied":[],"already_applied":0}
{"step":"seed","status":"ok","files":0,"rows":0}
{"step":"module","status":"ok","ready":true,"migrations":0}
{"step":"host","status":"ok"}
{"result":"ok","urls":{"host":"http://127.0.0.1:7161/m/sample/sample","module":"http://127.0.0.1:7160/app/sample","version":"http://127.0.0.1:7160/api/version"}}
# código de salida: 0

$ curl -i http://127.0.0.1:7160/readyz
HTTP/1.1 200 OK
{"status":"ready"}

$ curl http://127.0.0.1:7160/api/version
{"module":"sample","commit":null,"migrations":[]}

$ npm run doctor (en examples/sample)
{"check":"pimia:me","status":"ok","mode":"double"}
{"check":"ui","status":"ok","frameAncestors":"http://127.0.0.1:7161"}
{"check":"host","status":"ok"}
{"result":"ok"}

$ npm test (raíz: incluye examples/sample/tests)
✔ module.json es válido y declara la pantalla de entrada (0.478833ms)
✔ la tabla de rutas y sus handlers casan (si no, el módulo no arrancaría) (0.495291ms)
ℹ tests 77
ℹ pass 77
ℹ fail 0
```
