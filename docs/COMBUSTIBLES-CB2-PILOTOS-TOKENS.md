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

Antes de crear consumos se validan los IDs elegidos contra la empresa autenticada y el estado activo. Se deduplican y ordenan numéricamente; se consultan por PK en lotes de hasta 200, con `LOCK IN SHARE MODE`. Esos empleados quedan protegidos contra bajas, borrados o renombres hasta terminar la transacción, mientras dos importaciones pueden compartirlos. No se bloquean todos los empleados activos ni se usa `FOR UPDATE` sobre su catálogo.

Solo si hay decisiones automáticas se lee una vez el catálogo activo completo, sin bloqueo, después de obtener los bloqueos elegidos. La transacción existente usa READ COMMITTED: esta lectura ve los cambios confirmados durante la espera. Se recalcula la coincidencia utilizando el **texto original del Excel reanalizado**, sin confiar en nombres ni candidatos del navegador. Una baja del elegido, cambio de su nombre, homónimo visible en esa lectura o método incorrecto impide confirmar. La selección manual no necesita leer todo el catálogo. El borrado manual no consulta empleados.

El orden es proveedor, documentos/vehículos, consumos previos y empleados elegidos; se movió la validación de empleados después del bloqueo de consumos previos para no esperar esos consumos mientras se retienen bloqueos de empleados. El orden de documentos y vehículos y los reintentos acotados de deadlock/timeout del repositorio permanecen vigentes. Esto reduce contención evitable; no certifica ausencia de interbloqueos frente a cualquier escritor externo.

El método se registra en `decision.metodoEmpleadoValidado` del diario existente; `decision.asignacion` conserva la elección enviada. El texto original permanece en `datos_origen` y no se sustituye por el nombre completo del empleado. Solicitudes antiguas sin marcador siguen siendo admitidas: se valida el ID activo y se registra `NO_DECLARADO`, sin atribuirles un método que no declararon.

No se hace backfill de métodos, empleados o eventos antiguos. Una operación ya confirmada/reutilizada conserva su empleado anterior: la nueva autopropuesta no ejecuta actualizaciones sobre esa asignación. El flujo explícito de corrección del PR #514 permanece separado y sin cambios.

## Rendimiento y archivos

`empleados-coincidencias.ts` crea un índice invertido de tokens y una caché acotada de resultados. El backend construye un índice por operación; la interfaz lo reutiliza por identidad del array inmutable del catálogo. Una recarga sustituye el array y construye un índice nuevo. No se debe mutar ese array en el lugar.

No hay consultas de empleados por fila: `ceil(IDs distintos/200)` consultas compartidas y una lectura adicional de catálogo si hay métodos automáticos. Diez mil consumos del mismo empleado usan dos consultas automáticas o una manual; sin empleado usan cero. Se reemplazan búsquedas repetidas de decisiones por mapas al construir selecciones y eventos. No se cambia el resto del acceso a vehículos/documentos.

Archivos principales:

- `src/lib/flota/cb2/empleados-coincidencias.ts`: normalización, índice, unicidad y prioridad manual.
- `src/lib/flota/cb2/empleados-validacion.ts`: catálogo transaccional autorizado y revalidación.
- `src/lib/flota/cb2/model.ts`, `service.ts`: contrato opcional y registro del método.
- `src/components/flota/cb2/{importar,historial,asignacion,preview-vista,client}` y catálogo existente: selección, explicación y payload coherentes.
- Pruebas nuevas de coincidencias, validación y pantalla; adaptación de expectativas anteriores que exigían selección manual para parciales únicas.

## Validación

- **74 archivos, 854 pruebas aprobadas** de flota, combustible y tenant, excluyendo suites que requieren BD real.
- Ejemplo Álvaro Pinto, segundos nombres y apellidos, tildes, puntuación, orden invertido, tokens incompletos rechazados, homónimos, inactivos y empresa ajena.
- Confirmación HALEL/SHELL con Excel sintético real y BD/almacenamiento simulados: método registrado, original literal conservado, homónimo aparecido tras preview rechazado y empleado previamente confirmado intacto.
- Prueba DOM de 26 consumos: catálogo asíncrono, autopropuesta, corrección y borrado manual, recargas, ambigüedad, filtros, paginación y payload final con métodos independientes por consumo.
- Rendimiento verificable sin depender de tiempos: 10.000 consumos con dos consultas de empleados; 405 IDs manuales desordenados se bloquean en tres lotes ordenados; 10.000 búsquedas sin volver a normalizar todo el catálogo. Compatibilidad de lectura de diarios viejos y nuevos y reanudación completa del servicio para HALEL/SHELL con ambas versiones de evidencia, usando persistencia y almacenamiento simulados.
- `tsc --noEmit --incremental false`, ESLint de todos los archivos TypeScript modificados/añadidos y `git diff --check`: aprobados.
- Evidencia: `docs/evidence/combustibles-cb2-pilotos/validacion-local.json`.

## Migración y riesgos antes de integrar

**No requiere migración SQL adicional.** Utiliza `empleados` y las columnas/JSON del PR #514. No se comprobó ni modificó el esquema de ninguna instalación.

Las pruebas de persistencia usan mocks. No se ejecutó SQL, no se crearon bases de datos, no se accedió a producción y no hubo despliegue ni merge. Quedan pendientes la inspección visual en navegador, el plan de consulta y la concurrencia real en MariaDB, fuera del alcance autorizado. La unicidad se comprueba en el instante de la lectura del catálogo: una alta, reactivación o renombre de OTRO empleado confirmado después puede generar un homónimo antes del commit. No se garantiza unicidad serializable con RRHH. Conseguirla requiere coordinación de todos sus escritores; no se añade aquí. Los IDs elegidos sí conservan pertenencia/estado/nombre bajo bloqueo compartido hasta commit. Un lote que elija miles de IDs todavía retiene miles de bloqueos compartidos; la lectura automática sigue siendo proporcional al catálogo activo.

La aplicación nueva lee los diarios anteriores. Un rollback al lector estricto del PR #514 no reconoce `metodoEmpleadoValidado` ni `asignacion.metodoEmpleado` y puede impedir reanudar importaciones creadas con este cambio: conservar el lector compatible de `model.ts`, sin borrar ni reescribir evidencia. No revertir la migración ya aplicada del PR #514.

Compatibilidad durante una futura publicación (no ejecutada aquí):

| Frontend | Backend | Resultado |
| --- | --- | --- |
| #514 | #515 | Admite solicitudes sin marcador, valida empleado activo/empresa y registra NO_DECLARADO; conserva el contrato y digest anteriores. |
| #515 | #515 | Revalida métodos automáticos; las selecciones y borrados manuales prevalecen. |
| #515 | #514 | El schema estricto anterior rechaza el campo nuevo; no es compatible. |

Publicar primero backend compatible y luego frontend, o cambiar ambos de forma atómica con afinidad de versión. No enviar tráfico nuevo a instancias del backend anterior durante un despliegue mixto. Mantener archivo, selección, clave y recibo exactos para reintentos inciertos; no retirar el marcador de una solicitud que pudo confirmarse: cambiaría el digest. Un recibo vencido sin operación confirmada requiere nuevo preview; la recuperación de una operación ya confirmada precede la comprobación de vencimiento. La ausencia de método en clientes anteriores no demuestra selección manual ni automática y por eso nunca se inventa esa procedencia.
