# PR #513 — Identificación y revisión de consumos

Base: `main`, `7c794bcb8e8bfc1d146a8045453ecfab63daf4ac`.

## Causas comprobadas

- `LISTO` excluía toda fila con advertencias, aunque el backend permitiera procesarla. La selección y los contadores usaban criterios distintos.
- La autoselección se calculaba al recibir la vista previa: un catálogo que llegara después no completaba las unidades. La selección de unidad también representaba la decisión de incluir el consumo, sin conservar ambas decisiones por separado.
- Las placas sin prefijo se consideraban aproximadas y el backend solo admitía igualdad completa normalizada.
- Ordenar por estado hacía que una fila cambiara de página al corregir su unidad.

## Comportamiento corregido

Un único modelo agrupa candidatos y calcula tabla, filtros, contadores y resumen final. Cada candidato cuenta una vez; sus apariciones conservan hoja, lote, fila y valores originales. Los registros ignorados y las apariciones bloqueadas sin identidad se presentan aparte.

| Dimensión | Definición |
| --- | --- |
| Identificación | Automática, manual, ambigua, inexistente o pendiente |
| LISTO / elegible | Candidato no bloqueado por el servidor y con unidad compatible del catálogo actual |
| PENDIENTE | Falta una unidad compatible |
| BLOQUEADO | Existe una aparición activa bloqueada; revisar avisos no elimina el bloqueo |
| Advertencias | Información o revisión pendiente, independientes de elegibilidad |
| Seleccionado | Candidato elegible marcado para esta confirmación, incluso si tiene advertencias |

Las autopropuestas se derivan del catálogo actual. Una elección o borrado manual tiene prioridad; desmarcar un consumo conserva la unidad. Estas decisiones y la revisión de avisos sobreviven a filtros, paginación y recargas del catálogo. El orden se mantiene por hoja y fila.

Se ignoran mayúsculas, espacios y guiones permitidos. Una abreviada de tres dígitos y tres letras, como `633 CBL`, solo propone `C-633CBL` si existe un único candidato autorizado. El backend vuelve a consultar y bloquear candidatos dentro de la transacción, con el predicado multiempresa existente, y revalida el acceso del vehículo seleccionado. No se infieren caracteres distintos ni prefijos expresamente informados. Una abreviada ambigua exige completar el prefijo en el Excel y reanalizar; una placa completa duplicada permite elección manual de una coincidencia exacta.

Los avisos muestran nivel, causa, evidencia y valores originales. La discrepancia monetaria utiliza Decimal con precisión 48, sin redondeo binario ni modificación de importes: producto de galones por precio, monto original, diferencia y tolerancia existente de 0.01. Se mantienen los perfiles, parser 2, claves e idempotencia existentes.

La tabla compacta conserva el tema oscuro y usa tarjetas en pantallas pequeñas. Ofrece filtros combinables, acceso a pendientes de intervención y detalles plegables de evidencia, pilotos y filas ignoradas. El resumen identifica importes por moneda, seleccionados, advertencias y exclusiones. Cualquier cambio de selección o elegibilidad invalida la aceptación previa; confirmar requiere una nueva aceptación explícita y la validación del backend.

## Pilotos y límites

El esquema CB2 conserva el nombre original sin una relación de consumo con piloto. No se crea ni persiste una relación nueva. Las sugerencias exactas son informativas; una aproximada o ambigua requiere seleccionar y confirmar explícitamente su revisión. Ninguna de estas sugerencias bloquea por sí sola un consumo. Se conserva el catálogo de la empresa y la advertencia existente sobre esta limitación.

## Validación

- Regresión de flota y combustible sin suites de base de datos: **63 archivos, 768 pruebas aprobadas**. Incluye formatos A/B sintéticos, múltiples hojas/lotes, trazabilidad, idempotencia, permisos y aislamiento.
- Cobertura nueva de interfaz: 20 consumos advertidos elegibles, duplicados, filtros combinados, totales, catálogo asíncrono, prioridad manual, deselección, paginación, bloqueos y revisión explícita de pilotos. La prueba del importador verifica aceptación invalidada por el catálogo tardío y payload con solo candidatos seleccionados, sin pilotos.
- Servicio con BD/almacenamiento simulados: abreviada única aceptada, abreviada ambigua rechazada aun enviando un ID, consulta limitada a empresa con `FOR UPDATE`, acceso revocado rechazado y caracteres distintos rechazados.
- `tsc --noEmit`: aprobado. ESLint sobre todos los archivos TypeScript modificados y añadidos: aprobado.
- Suites con base de datos no ejecutadas; no se afirma validación real en MariaDB. No se realizaron importaciones reales, cambios en producción ni modificaciones de archivos SQL. La compatibilidad móvil se implementó en CSS; no se realizó inspección visual en navegador.

