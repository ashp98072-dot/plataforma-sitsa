# CB2 — Reconocimiento automático de empleados por tokens

Base: `main` posterior al PR #514, `237d1c191b30436e96c04cf3aadbc15ddbdc3a73`.

## Causa y alcance

El PR #514 ya encontraba candidatos por tokens completos, pero devolvía `propuesta: null` para toda coincidencia parcial única. Además, privilegiaba una igualdad literal aun cuando otra persona contuviera esos mismos tokens, y consultaba empleados por cada consumo creado.

Este cambio se limita a reconocer empleados/pilotos al importar HALEL/SHELL y al reanudar candidatos pendientes. No cambia productos, placas, importes, reportes, permisos, parser, huellas ni claves de idempotencia. No modifica SQL, migraciones, dependencias ni workflows.

## Regla

- Normalizar mayúsculas, tildes, espacios y puntuación como separadores, conservando el nombre original del Excel.
- Exigir al menos dos tokens distintos completos de letras. No buscar por prefijos de palabras, distancia, iniciales expandidas ni similitud.
- Comparar todos los tokens informados contra el nombre registrado, sin exigir posición u orden. `Alvaro Pinto`, `Antonio Pinto`, `Alvaro León` y `León Antonio` pueden identificar a `Alvaro Antonio León Pinto`.
- Autopropuesta solo si **un único empleado activo de la empresa** contiene todos los tokens. Si dos personas coinciden, ninguna exacta tiene prioridad sobre la otra: se exige elección manual.
- Sin coincidencia confiable, el piloto queda pendiente y sin vínculo. Se conserva el criterio existente de que un piloto pendiente no bloquea por sí solo el consumo.
- Una selección o borrado manual prevalece sobre la autopropuesta durante filtrado, paginación y recarga del catálogo.

El modelo disponible guarda `empleados.nombre` completo; no hay columnas separadas de nombres y apellidos. Se comparan tokens registrados sin inventar una segmentación. Cualquier homónimo entre los candidatos activos convierte el resultado en ambiguo.

## Backend y trazabilidad

La interfaz envía `metodoEmpleado`: `EXACTA_NORMALIZADA`, `TOKENS_COMPLETOS_UNICOS`, `MANUAL` o `SIN_ASIGNACION`. El recibo firmado y la identidad de reintento incluyen estas decisiones.

Antes de crear consumos se lee el catálogo activo completo de la empresa del contexto autenticado, con `FOR UPDATE`, una sola vez dentro de la transacción. Se valida pertenencia/estado para cualquier ID elegido y se recalcula la coincidencia automática utilizando el **texto original del Excel reanalizado**, sin confiar en nombres ni candidatos del navegador. Una baja, cambio de nombre, homónimo nuevo o método automático incorrecto impide confirmar. Elegir manualmente sigue permitido únicamente para un empleado activo autorizado.

El método se registra en `decision.metodoEmpleadoValidado` del diario existente; `decision.asignacion` conserva la elección enviada. El texto original permanece en `datos_origen` y no se sustituye por el nombre completo del empleado. Solicitudes antiguas sin marcador siguen siendo admitidas: se valida el ID activo y se registra `NO_DECLARADO`, sin atribuirles un método que no declararon.

No se hace backfill de métodos, empleados o eventos antiguos. Una operación ya confirmada/reutilizada conserva su empleado anterior: la nueva autopropuesta no ejecuta actualizaciones sobre esa asignación. El flujo explícito de corrección del PR #514 permanece separado y sin cambios.

## Rendimiento y archivos

`empleados-coincidencias.ts` crea un índice invertido de tokens y una caché acotada de resultados. El backend construye un índice por operación; la interfaz lo reutiliza por identidad del array inmutable del catálogo. Una recarga sustituye el array y construye un índice nuevo. No se debe mutar ese array en el lugar.

No hay consultas de empleados por fila: una consulta para el lote seleccionado, o ninguna si no se seleccionó empleado. Se reemplazan búsquedas repetidas de decisiones por mapas al construir selecciones y eventos. No se cambia el resto del acceso a vehículos/documentos.

Archivos principales:

- `src/lib/flota/cb2/empleados-coincidencias.ts`: normalización, índice, unicidad y prioridad manual.
- `src/lib/flota/cb2/empleados-validacion.ts`: catálogo transaccional autorizado y revalidación.
- `src/lib/flota/cb2/model.ts`, `service.ts`: contrato opcional y registro del método.
- `src/components/flota/cb2/{importar,historial,asignacion,preview-vista,client}` y catálogo existente: selección, explicación y payload coherentes.
- Pruebas nuevas de coincidencias, validación y pantalla; adaptación de expectativas anteriores que exigían selección manual para parciales únicas.

## Validación

- **74 archivos, 850 pruebas aprobadas** de flota, combustible y tenant, excluyendo suites que requieren BD real.
- Ejemplo Álvaro Pinto, segundos nombres y apellidos, tildes, puntuación, orden invertido, tokens incompletos rechazados, homónimos, inactivos y empresa ajena.
- Confirmación HALEL/SHELL con Excel sintético real y BD/almacenamiento simulados: método registrado, original literal conservado, homónimo aparecido tras preview rechazado y empleado previamente confirmado intacto.
- Prueba DOM de 26 consumos: catálogo asíncrono, autopropuesta, corrección y borrado manual, recargas, ambigüedad, filtros, paginación y payload final con métodos independientes por consumo.
- Rendimiento verificable sin depender de tiempos: 10.000 consumos con una consulta de empleados; 10.000 búsquedas sin volver a normalizar todo el catálogo. Compatibilidad de lectura de diarios viejos y nuevos.
- `tsc --noEmit --incremental false`, ESLint de todos los archivos TypeScript modificados/añadidos y `git diff --check`: aprobados.
- Evidencia: `docs/evidence/combustibles-cb2-pilotos/validacion-local.json`.

## Migración y riesgos antes de integrar

**No requiere migración SQL adicional.** Utiliza `empleados` y las columnas/JSON del PR #514. No se comprobó ni modificó el esquema de ninguna instalación.

Las pruebas de persistencia usan mocks. No se ejecutó SQL contra una BD real, importaciones productivas, despliegue ni merge. Quedan pendientes la inspección visual en navegador, el plan de consulta y la concurrencia real en laboratorio. La lectura transaccional verifica unicidad en ese momento; no establece una unicidad permanente ni serializa las altas futuras de RRHH con todos sus escritores. Bloquear el catálogo activo también puede aumentar contención durante la confirmación de lotes grandes.

La aplicación nueva lee los diarios anteriores. Un rollback al lector estricto del PR #514 no reconoce los campos JSON nuevos y podría impedir reanudar importaciones creadas con este cambio: conservar un lector compatible al planificar una reversión, sin borrar evidencia. Desplegar frontend y backend compatibles juntos; un backend anterior rechaza el marcador nuevo. Estas consideraciones requieren revisión antes de integrar, sin ejecutar cambios productivos desde este PR.
