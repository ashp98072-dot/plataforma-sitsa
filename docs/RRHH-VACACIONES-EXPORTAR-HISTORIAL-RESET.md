# RRHH Vacaciones — exportar historial actual + preparar reset controlado

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (sin probar en navegador ni contra la base real). **No se ejecutó SQL, no se borró ni cambió ningún dato, no hay botón «Reset».** Continuación de #418 (vista previa de reconstrucción).

## 1. Objetivo
No existe un archivo histórico externo de RRHH. Antes de limpiar el módulo, los registros actuales se usan como fuente histórica:
1. exportarlos en un archivo compatible con «Importar historial (solo vista previa)»;
2. revisarlos con el **mismo motor** de vista previa de #418;
3. dejar preparado (solo para revisión) el reset controlado.

## 2. Exportar historial actual (RRHH → Vacaciones)
Panel **«Exportar historial actual»** (visible con permiso RRHH · Vacaciones · editar, igual que el importador). Acciones: **Descargar XLSX**, **Descargar CSV**, **Previsualizar historial actual**. Todo es de **solo lectura**.

Rutas (empresa siempre de la sesión/slug; permiso `vacaciones · editar`; sin caché):
- `GET /api/empresas/[slug]/rrhh/vacaciones/exportar-historial?formato=xlsx|csv`
- `GET /api/empresas/[slug]/rrhh/vacaciones/exportar-historial/preview`

### Formato exacto
Encabezados, en este orden: `codigo, dpi, nombre, fecha_inicio, fecha_fin, dias_habiles, tipo, observacion`.
- `fecha_*`: `YYYY-MM-DD` exacto (en XLSX como **texto**, sin seriales ni zona horaria).
- `dias_habiles`: número (`11`, `4.5`).
- `tipo`: exactamente `Vacaciones` o `A cuenta de Vacaciones`.
- `observacion`: `vacaciones.observaciones` (recortada). En CSV, un texto que empieza como fórmula (`= + - @`) se antepone con un espacio (el importador lo recorta: se reimporta idéntico).
- CSV: UTF-8 con BOM, `,`, CRLF, comillas dobles. XLSX: hoja 1 «Historial» (la que lee el importador) y hoja 2 «Problemas» (reporte; el importador la ignora).
- **No** exporta saldos, detalle FIFO ni IDs internos; solo estas 8 columnas.

### Cómo se resuelve el tipo (nunca se inventa)
`vacaciones` no tiene `incidencia_id`: `registrarVacacionesFifoEnConexion` inserta una fila «espejo» por cada incidencia con saldo. Se usa el criterio real del sistema (el mismo de `vacaciones-eliminar.ts`): **empresa + empleado + fecha_inicio + fecha_fin + dias_habiles**, solo con incidencias de tipo `Vacaciones` / `A cuenta de Vacaciones` (las de otros tipos, aunque tengan las mismas fechas, nunca emparejan). Por cada grupo de filas con la misma llave:

| Situación | Resultado |
|---|---|
| n filas = n incidencias candidatas, todas del mismo tipo | se exporta con ese tipo |
| 0 incidencias | **ERROR `VACACION_SIN_INCIDENCIA`** — no se exporta |
| candidatas de ambos tipos | **ERROR `TIPO_AMBIGUO`** — no se exporta |
| n filas ≠ n incidencias | **ERROR `INCIDENCIAS_CANTIDAD_DISTINTA`** — no se exporta |
| incidencia de vacaciones sin fila en `vacaciones` | **ERROR `INCIDENCIA_SIN_VACACION`** (no sale en el archivo; se perdería en una limpieza) |
| estado ≠ `Aprobado`, empleado inexistente, fechas/días inválidos | **ERROR** — no se exporta |
| filas idénticas legítimas (n = n) | se exportan todas + **ADVERTENCIA `DUPLICADO_IDENTICO`** (el importador ignora las repetidas) |

Una fila sin tipo resuelto jamás se escribe con tipo vacío (el importador lo leería como «Vacaciones»). El reporte lleva los IDs de vacaciones/incidencias solo para localizar el registro; no forman parte del archivo reimportable. Encabezados de la descarga: `X-Export-Filas`, `X-Export-Problemas`.

## 3. Previsualizar historial actual
Transforma las vacaciones actuales al mismo formato y ejecuta **el mismo `previsualizarHistorial`** de #418 (no hay un segundo motor). Muestra: filas válidas, duplicados, superposiciones, futuras, anteriores a fecha base, saldo insuficiente, empleados bloqueados (Elisa), diferencias `fecha_alta` / `fecha_inicio_laboral` (Amílcar), vacaciones actuales sin pareja correcta (reporte del emparejamiento) y el resumen por empleado. Solo `SELECT`; nunca `execute`/`getPool` (verificado por prueba).

Un archivo descargado y vuelto a subir da **exactamente** el mismo resultado que la vista previa directa (CSV y XLSX; probado).

## 4. Reset controlado (SOLO PREPARADO)
- `sql/preflight-reset-vacaciones.sql` — **solo lectura**: conteos (total y por empresa), respaldos existentes, incidencias por tipo, FK que referencian las tablas a borrar con su regla (marca las que bloquean), pareja vacaciones↔incidencias por grupo, vacaciones con estado ≠ Aprobado, detalle huérfano/inconsistente (incluye detalle sobre incidencias que no son de vacaciones y saldos de otro empleado/empresa), incidencias sin detalle, saldos con consumo, solicitudes pendientes/ligadas, evidencias asociadas, empleados con `fecha_alta` inválida (Elisa) o distinta de `fecha_inicio_laboral` (Amílcar) y un **resumen de bloqueos** (todo debe estar en 0 o decidido por RRHH).
- `sql/propuesta-reset-vacaciones.sql` — **100 % comentada**. Orden futuro: backups completos y separados (`bk_reset_<TS>_vacaciones`, `_incidencias_vacaciones`, `_detalle_consumo_vacaciones`, `_saldos_vacaciones`, `_solicitudes_vacaciones`) → validar export → validar preview → transacción → borrar detalle FIFO → borrar **solo** incidencias de vacaciones reconstruibles (con fila espejo, sin evidencias ni solicitud ligada) → borrar vacaciones → borrar saldos (sin arrastrar detalle por cascada) → validaciones (otras incidencias, empleados y solicitudes sin cambio; `backup_saldos_vacaciones_20261006` intacto) → `COMMIT`/`ROLLBACK`. **Sin `TRUNCATE`, sin `FOREIGN_KEY_CHECKS = 0`**; todos los borrados con `empresa_id`. La reconstrucción posterior desde el historial exportado es un paso aparte (aplicador controlado que aún no existe).
- **No** repara a Elisa ni a Amílcar; **no** toca FIFO, saldos reales, empleados ni `backup_saldos_vacaciones_20261006`.

## 5. Pruebas
`vacaciones-historial-export.test.ts` (emparejamiento, tipos, sin incidencia, ambigua, cantidad distinta, duplicados, CSV/XLSX reimportables, fechas y días exactos, sin IDs/saldos), `vacaciones-historial-actual.test.ts` (solo SELECT con `empresa_id`, no lee otros tipos, el preview es idéntico al del motor sobre el archivo CSV/XLSX, Elisa, Amílcar, futura, superposición, sin pareja, duplicados, no escribe), rutas de exportación y de vista previa (permiso, empresa de la sesión, formatos, reimportación del archivo descargado, solo GET), `vacaciones-reset-sql-contrato.test.ts` (preflight solo lectura; propuesta 100 % comentada, sin `TRUNCATE`/`FOREIGN_KEY_CHECKS`, orden, filtros por empresa y por tipo, backups separados).

## 6. Decisiones abiertas
1. Qué hacer con las vacaciones/incidencias que el reporte marque como sin pareja o ambiguas (corregirlas antes del reset).
2. Duplicados idénticos: ¿son tomas reales distintas? (el importador ignora las repetidas).
3. Elisa (fecha real de alta) y Amílcar (`fecha_alta` vs `fecha_inicio_laboral`).
4. Aplicador controlado de la reconstrucción (ticket aparte).
