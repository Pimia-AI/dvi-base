# El diagnóstico detecta fallos (salir con 0 no es éxito)

08/11/2026. Con todo arriba, se paró el servicio `module` (`docker compose stop module`) y se ejecutó `npm run doctor`:

```
{"check":"service:module","state":"exited","health":null,"status":"error"}
{"check":"module:healthz","status":"error"}
{"check":"module:readyz","status":"error"}
{"check":"module:version","module":null,"commit":null,"applied":0,"expected":1,"status":"error"}
{"check":"ui","frameAncestors":null,"status":"error"}
{"result":"error"}
código de salida: 1
```

Al volver a arrancarlo (`docker compose start module`), y en cuanto Docker lo marcó como sano, `{"result":"ok"}` otra vez.
