# Criterio 1: un checkout limpio levanta con una orden y pasa sus pruebas

08/11/2026. `git clone --branch base-minima` del repo en una carpeta vacía (commit `0db27a8`), sin `node_modules` ni
`.dvi/`. La orden de arranque no necesita `npm install`: solo Node y Docker. Docker reutilizó la caché de capas, que
tienen el mismo contenido que las construidas en la primera ejecución (`up.jsonl`, 28 s).

## `npm run up` (sin instalar nada)

```
# 2026-11-08T14:25:13Z  checkout limpio de base-minima en 0db27a8, sin node_modules: npm run up
{"step":"config","status":"ok","module":"dvi-base-notes","mode":"double"}
{"step":"secrets","status":"ok","created":true,"file":".dvi/local.env"}
{"step":"compose","status":"ok","ms":10557,"services":["postgres","migrate","pimia-double","module","dev-host"]}
{"step":"migrations","status":"ok","schema":"notes","applied":["0001_notes"],"already_applied":0}
{"step":"seed","status":"ok","files":1,"rows":5}
{"step":"module","status":"ok","ready":true,"migrations":1}
{"step":"host","status":"ok"}
{"result":"ok","urls":{"host":"http://127.0.0.1:7161/m/dvi-base-notes/notes","module":"http://127.0.0.1:7160/app/notes","version":"http://127.0.0.1:7160/api/version"}}
# código de salida: 0
```

## Después, en el mismo checkout: instalar, pruebas, diagnóstico e imagen desde el commit

```
# 2026-11-08T14:25:35Z  mismo checkout limpio (0db27a8)
$ npm ci
added 74 packages in 2s

$ npm run typecheck
(sin errores, código 0)

$ npm test
ℹ tests 70
ℹ pass 70
ℹ fail 0

$ npm run test:db
ℹ tests 12
ℹ pass 12
ℹ fail 0

$ npm run doctor
{"result":"ok"}

$ npm run image
{"step":"image","status":"ok","tag":"dvi-base-notes:0db27a8df6ba","ms":1363,"size_mb":250,"revision":"0db27a8df6baed055c38fffe156b3fb7b59fbbe7","dirty":false,"user":"node","healthcheck":"CMD node healthcheck.mjs"}
{"step":"image:without-config","status":"ok","exit":1,"output":"Configuración del módulo incompleta o no válida. Arranque cancelado."}
{"step":"image:rejects-double","status":"ok","exit":1,"output":"Configuración del módulo incompleta o no válida. Arranque cancelado."}
{"step":"image:contents","status":"ok","listing":["healthcheck.mjs","migrations","server.cjs","ui","assets","index.html","0"]}
# código de salida: 0

$ git status --porcelain (sin cambios tras todo lo anterior)
       0
```

Al terminar, `npm run down`.
