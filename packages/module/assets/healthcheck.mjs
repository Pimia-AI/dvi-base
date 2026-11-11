// Sin curl ni shell. No imprimir cuerpo, configuración o errores del transporte.
try {
 const response=await fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/healthz`,{signal:AbortSignal.timeout(3000),redirect:'error'})
 process.exit(response.status===200?0:1)
} catch { process.exit(1) }
