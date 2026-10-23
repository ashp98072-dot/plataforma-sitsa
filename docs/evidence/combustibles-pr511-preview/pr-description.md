## Problema y resultado

Los Excel tabulares y por lotes de combustible necesitan reconocimiento por encabezados, trazabilidad por hoja/lote/fila y revisión de coincidencias sin asignaciones por similitud. Este cambio amplía el preview CB2, reconoce múltiples hojas y lotes, actualiza columnas ante encabezados repetidos y conserva subtotales/notas como evidencia ignorada. Producto ausente queda sin informar; kilometraje ausente no genera avisos.

Las placas exactas normalizadas y únicas del catálogo autorizado se proponen al analizar; la confirmación final sigue siendo explícita. Las aproximadas y ambiguas requieren revisión manual, y el backend conserva la validación conservadora de placa y acceso vigente. No se eliminan prefijos. Se conservan claves/payloads históricos y parser 1 para reanudar evidencia anterior; los archivos nuevos usan parser 2 y un recibo firmado con esa versión.

El preview incorpora indicadores, filtros, detalles originales, sugerencias, paginación y resumen antes de confirmar. No modifica archivos SQL, dependencias ni workflows.

## Limitación de pilotos investigada

Se consulta `tms_personal`, únicamente pilotos activos de la empresa autenticada. La UI muestra piloto leído y sugerencias exactas, aproximadas, ambiguas o inexistentes, normalizando tildes y espacios. **CB2 solo persiste `piloto_informado`; no tiene relación con el catálogo.** Conforme a la excepción solicitada, no se inventa una relación: las sugerencias son informativas y no existe asociación persistida ni selector que prometa guardarla. La UI lo explica y permite corregir el dato mediante reanálisis del Excel. Una asociación real requiere una decisión posterior de modelo.

## Validación

- 355 pruebas aprobadas en 33 archivos; después, 5 pruebas del servicio repetidas tras un ajuste exclusivo de tipos.
- TypeScript sin errores, ESLint con cero advertencias y `git diff --check` correcto.
- Fixtures sintéticas de ambos formatos: hojas, lotes, columnas reordenadas, títulos combinados, encabezados repetidos, subtotales, tildes, espacios, guiones, homónimos y datos ausentes.
- Pruebas del servicio con BD/almacenamiento simulados: separación multiempresa, rechazo de placas distintas, un consumo por candidato, recibos de versión anterior y despacho del parser histórico.
- Comparación completa de parser 1 con main y hashes reproducibles para HALEL/SHELL.
- Regresión de permisos, origen/CSRF, idempotencia, selección parcial y reconstrucción ORIGEN/RESOLUCION.

No se accedió a producción ni se ejecutaron importaciones reales, SQL o migraciones. Sin inspección visual en navegador ni integración con una BD real en esta ampliación. Se mantiene como Draft para auditoría independiente; no se hace merge.

Guía y comandos reproducibles: [COMBUSTIBLES-PR511-PREVIEW.md](https://github.com/ashp98072-dot/plataforma-sitsa/blob/feature/combustibles-pr511-preview-mejoras/docs/COMBUSTIBLES-PR511-PREVIEW.md). Resultados y hashes: [evidencia](https://github.com/ashp98072-dot/plataforma-sitsa/tree/feature/combustibles-pr511-preview-mejoras/docs/evidence/combustibles-pr511-preview).
