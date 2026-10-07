# RRHH Vacaciones — reconstrucción completa desde el historial oficial (vista previa y simulación)

Estado: **IMPLEMENTADO HASTA VISTA PREVIA / SIMULACIÓN. VERIFICADO TÉCNICAMENTE.** Este PR **no escribe nada**: no importa ningún archivo real, no ejecuta SQL, no modifica producción y no borra datos. La **ejecución real** de la reconstrucción es un paso posterior y controlado (ver §8). `sql/preflight-reconstruccion-vacaciones.sql` es de solo lectura y `sql/reconstruccion-vacaciones-propuesta.sql` está **100 % comentado**.

## 1. Objetivo y diseño

RRHH tiene el listado histórico completo de todas las vacaciones tomadas. La idea es reconstruir el dominio de vacaciones desde cero, de forma controlada: generar los períodos correctos desde la fecha base, reaplicar cronológicamente cada vacación con FIFO, reconstruir el detalle de consumo, obtener saldos correctos y conservar el historial completo — sin `TRUNCATE` y sin depender de las filas heredadas.

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Lectura del archivo (pura) | `src/lib/rrhh/vacaciones-historial-import.ts` | CSV, columnas, fechas, días, tipo, validación de cada fila, llave lógica |
| Lector XLSX | `src/lib/rrhh/vacaciones-historial-xlsx.ts` | Primera hoja de un `.xlsx` (solo lee, en memoria) |
| **Motor de simulación (puro)** | `src/lib/rrhh/vacaciones-reconstruccion.ts` | Empleado + fecha base + historial → períodos, FIFO, vencimiento, tope, saldo, advertencias |
| Vista previa (solo `SELECT`) | `src/lib/rrhh/vacaciones-historial-preview.ts` | Resuelve empleados, duplicados, días calculados vs informados, comparación con lo actual, resumen por empleado |
| API | `POST /api/empresas/[slug]/rrhh/vacaciones/importar-historial/preview` | Multipart `archivo`; permiso RRHH · Vacaciones · **editar**; la empresa sale de la sesión; ≤ 5 MB |
| UI | `src/components/rrhh/importar-historial-vacaciones.tsx` | RRHH → Vacaciones → «Importar historial (solo vista previa)» |
| SQL | `sql/preflight-reconstruccion-vacaciones.sql`, `sql/reconstruccion-vacaciones-propuesta.sql` | Solo lectura / propuesta comentada |

## 2. Formato de archivo esperado

CSV UTF-8 (delimitador `,` `;` o tabulación; comillas dobles; BOM aceptado) o la primera hoja de un `.xlsx`; primera fila = encabezados. Máximo 5 000 filas / 5 MB.

| Campo | Obligatorio | Encabezados aceptados (sin importar mayúsculas/acentos) | Notas |
|---|---|---|---|
| Identificador del empleado | **Sí (al menos uno)** | `codigo` (`codigo_empleado`, `no_empleado`…), `dpi` (`cui`), `nombre` (`empleado`, `colaborador`…) | Prioridad por fila: **código > DPI > nombre**. El nombre debe coincidir exactamente (sin acentos/mayúsculas) y ser único; si no, `EMPLEADO_AMBIGUO` |
| `fecha_inicio` | **Sí** | `fecha_inicio`, `inicio`, `desde`… | `YYYY-MM-DD` o `DD/MM/YYYY` (nunca se interpreta `MM/DD`); también fechas de Excel |
| `fecha_fin` | **Sí** | `fecha_fin`, `fin`, `hasta`… | ≥ `fecha_inicio` |
| `dias_habiles` | **Sí** | `dias_habiles`, `dias`, `dias_tomados`… | > 0; admite medio día; coma o punto decimal |
| `tipo` | No | `tipo` | `Vacaciones` (por defecto) o `A cuenta de Vacaciones`. Cualquier otro tipo **no es reconstruible** (fila inválida) |
| `observacion` | No | `observacion(es)`, `referencia`, `nota`… | Texto libre |

Cualquier **otra columna se ignora y se informa** explícitamente en la vista previa (nunca se mapea en silencio).

**Llave lógica de importación (duplicados):** `empleado + fecha_inicio + fecha_fin + días + tipo`. Las repeticiones dentro del archivo se ignoran con advertencia `DUPLICADO_EN_ARCHIVO`. Las vacaciones actuales se comparan **solo para informar**: en una reconstrucción completa **no se suman** al archivo oficial.

## 3. Validaciones de la vista previa

Filas inválidas (con su número de fila): sin identificador, fecha de inicio/fin inválida, fin anterior a inicio, días inválidos, tipo no reconstruible, columnas obligatorias faltantes, exceso de filas. Por empleado/archivo: empleados **encontrados / no encontrados / ambiguos**, **duplicados**, **vacaciones superpuestas**, **días calculados vs informados** (domingos y feriados excluidos, misma regla de `contarDiasHabiles`; se usan los informados), **anteriores a la fecha base**, **futuras**, **total de días por empleado**, **vacaciones actuales equivalentes** al archivo y **actuales que el archivo no trae** (decisión: una reconstrucción completa las eliminaría), diferencia `fecha_alta ≠ fecha_inicio_laboral`.

Severidades: `BLOQUEANTE` · `ERROR` (corregir el archivo) · `DECISION` (RRHH debe aprobar) · `ADVERTENCIA` · `INFO`. `puedeAplicarse` es verdadero solo si no hay `BLOQUEANTE` ni `ERROR`; las `DECISION` no lo impiden pero deben resolverse por escrito antes de aplicar.

## 4. Motor de simulación (`reconstruirEmpleado`)

Función **pura** `(empleado, historial, hoy) → resultado`. No recibe ni lee `saldos_vacaciones`, `detalle_consumo_vacaciones` ni las incidencias actuales: reconstruye un empleado **completo** solo con la fecha base y el historial oficial.

- **Fecha base:** `empleados.fecha_alta` (regla vigente; UI «Fecha ingreso / contratación — Base para vacaciones»). **No** se usa `fecha_inicio_laboral`; si difiere, advertencia informativa: «Diferencia entre fecha entrada laboral y base de vacaciones».
- **Períodos:** `[alta + (n−1) años, alta + n años − 1 día]`, 15 días por año completo, proporcional en el período en curso (misma fórmula histórica), sin traslapes (bisiestos incluidos). Ejemplo: 13/04/2023 → 12/04/2024 · 13/04/2024 → 12/04/2025 · 13/04/2025 → 12/04/2026.
- **Reaplicación cronológica:** `fecha_inicio` ASC y, como desempate, fila de origen ASC. Cada vacación consume FIFO (año laboral más antiguo primero) y se guarda exactamente qué período consume y cuántos días.
- **Disponibilidad a la fecha:** cada vacación consume a su `fecha_inicio` (acumulación proporcional, vencimiento y tope vigentes a esa fecha); las futuras consumen a la fecha de hoy. *(Supuesto explícito: el sistema actual consume en la fecha de registro, que el archivo histórico no tiene.)*
- **Vacación que CRUZA un aniversario (regla final):** no se asume que toda la vacación consuma con la disponibilidad de su `fecha_fin`. Se parte en **tramos con fechas reales** (en cada inicio de período que cae dentro del rango, después del primer día): el tramo anterior al aniversario solo puede consumir los períodos que **ya existen** a su fecha de inicio; el tramo posterior, los que existen desde el aniversario. En cada tramo se aplica el **mismo FIFO vigente** (`anio_laboral` ASC). Los días hábiles de cada tramo se cuentan con la **misma regla del módulo** (sin domingos; feriados de la empresa); los días de la vacación (los informados por RRHH) se asignan a los tramos en orden cronológico hasta los hábiles reales de cada uno (el remanente, si el archivo informa más días, cae en el último tramo). Como el sistema actual **no tiene** una regla de reparto por fecha (consume en la fecha de registro), el resultado es **PROVISIONAL**: se emite `VACACION_CRUZA_ANIVERSARIO` (**DECISION**) con el detalle por tramo y período, y el resumen cuenta cuántas requieren confirmación de RRHH. Una vacación que **empieza** el día del aniversario no cruza.
- **Otorgado / consumido / utilizable:** el resultado separa `resumenDias`: `otorgado = consumido + recortadoPorTope + perdidoPorVencimiento + saldoUtilizable`. El historial **nunca se descarta** porque el período hoy esté vencido: la vacación consumió cuando el período estaba vigente (se explica cronológicamente) y el período final queda `Vencido` conservando sus `consumidos`.
- **Vencimiento y tope:** solo los 2 períodos completos más recientes son utilizables (los anteriores pasan a `Vencido`, los días sin tomar se registran como `perdidosPorVencimiento`); tope de 30 días con la **misma regla** del motor actual (excedente del período en curso recortado del completo más viejo, registrado como `recortadosPorTope`). El historial conserva **todos** los períodos.
- **Saldo insuficiente:** la vacación **no se descarta** (el historial oficial es la verdad): consume lo disponible, el faltante queda como `deficit` y se emite `SALDO_INSUFICIENTE` (requiere decisión de RRHH).
- **Bloqueantes:** sin fecha base, fecha base < 1980 (**Elisa, id 37, `1899-12-31`**: no se reconstruye hasta que RRHH corrija la ficha) o futura.
- **Amílcar (id 14):** `fecha_inicio_laboral = 13/02/2023`, `fecha_alta = 13/04/2023` → se reconstruye según `fecha_alta` y se advierte la diferencia.
- **Empleados (coincidencia):** código exacto > DPI exacto > nombre **solo** si la fila no trae código ni DPI y el nombre es único; nunca se elige entre coincidencias múltiples (`EMPLEADO_AMBIGUO`) ni entre un código y un DPI que apuntan a empleados distintos (`EMPLEADO_CONFLICTO`).
- **Determinismo / idempotencia:** misma entrada → mismo resultado; el orden de las filas del archivo no cambia el resultado; no muta la entrada.

## 5. UI

RRHH → Vacaciones → **«Importar historial (solo vista previa)»** (visible con permiso de editar vacaciones): subir archivo → vista previa → errores y advertencias (por severidad) → resumen por empleado (fecha base, vacaciones, días, períodos, saldo final simulado, faltante, estado) → mensaje fijo «No se escribió nada». **No existe botón de aplicar** en este PR.

## 6. SQL propuesto (no ejecutado)

- **`sql/preflight-reconstruccion-vacaciones.sql` (solo lectura):** conteos actuales (31 / 31 / 35 / 441 / 0), respaldos existentes (no sobrescribir `backup_saldos_vacaciones_20261006`), incidencias por tipo (solo las de vacaciones son reconstruibles), todas las FK que referencian `incidencias`/`saldos_vacaciones`/`vacaciones` con su `DELETE_RULE`, incidencias de vacaciones con evidencias o solicitud, detalle FIFO hacia incidencias de otro tipo, pareja vacaciones↔incidencias, bloqueantes (fecha_alta < 1980) e informativos (`fecha_alta ≠ fecha_inicio_laboral`), impacto por empleado y validación del staging (comentada hasta que exista).
- **`sql/reconstruccion-vacaciones-propuesta.sql` (todo comentado):** (0) precondiciones; (1) **respaldos separados** con sello `bk_reconstruccion_<TS>_*` de `vacaciones`, incidencias de vacaciones, `detalle_consumo_vacaciones`, `saldos_vacaciones` y `solicitudes_vacaciones`; (2) tablas de staging; (3) validar el staging; (4) **una transacción**: eliminar detalle → eliminar **solo** incidencias de vacaciones reconstruibles (sin evidencias ni solicitud) → eliminar vacaciones → eliminar saldos → regenerar períodos → insertar incidencias → insertar vacaciones → generar detalle FIFO → validar; (5) `COMMIT`/`ROLLBACK`. **Sin `TRUNCATE`, sin `FOREIGN_KEY_CHECKS=0`**, nunca otro tipo de incidencia, el alcance se limita a los empleados presentes en el staging.
- Los períodos y los consumos FIFO **los calcula el motor de la aplicación** (no el SQL) y se cargan en el staging en el paso controlado posterior; el SQL solo copia lo ya revisado en la vista previa.

**Validaciones post-reconstrucción** (por empleado): cero traslapes, cero años laborales duplicados, cero saldos sin año, cero detalle FIFO huérfano, Σ detalle = días de la incidencia, vacaciones = incidencias 1:1, saldo ≤ 30, períodos ordenados e históricos completos, ningún disponible negativo, ninguna vacación duplicada. **Globales:** total importado = total fuente válida, incidencias de vacaciones = vacaciones, detalle FIFO > 0 cuando corresponde, cero huérfanos.

## 7. Pruebas

`vacaciones-reconstruccion.test.ts` (motor): 1 año, 10 años, 15 días por año, período proporcional actual, ejemplo 13/04/2023, bisiestos, 0 traslapes, FIFO entre dos períodos, varias vacaciones (independiente del orden de las filas), desempate por origen, vacación que cruza un aniversario (reparto por tramos, feriados, inicio en el aniversario), otorgado/consumido/utilizable, historial antiguo con período hoy vencido, Σ detalle FIFO = días tomados, saldo insuficiente, superpuestas, anterior a la base, futura, tope de 30, vencidos, fecha base inválida, **Elisa**, **Amílcar**, `fecha_alta ≠ fecha_inicio_laboral`, idempotencia. `vacaciones-historial-import.test.ts` (archivo): fechas, días, tipos, columnas, CSV (delimitadores, comillas, BOM), filas inválidas con su motivo, exceso de filas, llave lógica, XLSX. `vacaciones-historial-preview.test.ts` (servicio): **no escribe** (`execute`/`getPool` prohibidos y solo `SELECT`), empleados no encontrados/ambiguos, duplicados, días calculados vs informados, Elisa bloqueante, Amílcar, comparación con lo actual, idempotencia, columnas faltantes, solo tipos de vacaciones. Ruta (permiso, empresa de la sesión, formatos, tamaño). `vacaciones-reconstruccion-sql-contrato.test.ts`: preflight solo lectura, propuesta 100 % comentada, sin `TRUNCATE`/`FOREIGN_KEY_CHECKS`, orden de pasos, solo incidencias de vacaciones, respaldos separados.

## 8. Siguiente paso (otro ticket, fuera de este PR)

1. Recibir el archivo oficial real de RRHH y correr la vista previa; resolver los `ERROR`/`BLOQUEANTE` (corregir Elisa) y aprobar por escrito las `DECISION`.
2. Ticket de ejecución controlada: cargar el staging desde el resultado validado de la simulación, ejecutar el preflight, los respaldos y la propuesta SQL **manualmente** con las validaciones.

## 9. Fuera de alcance / decisiones abiertas

- Fecha base: `fecha_alta` (regla vigente); cambiar a `fecha_inicio_laboral` es decisión posterior de RRHH.
- Qué hacer con los empleados que tienen vacaciones actuales y no aparecen en el archivo (la vista previa los marca como `DECISION`).
- Faltantes de saldo (`SALDO_INSUFICIENTE`) y vacaciones anteriores a la fecha base: requieren decisión de RRHH caso por caso.
