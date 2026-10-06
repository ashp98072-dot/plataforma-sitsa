# RRHH Vacaciones — historial completo y reparación de períodos

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (motor corregido, API/UI de historial, pruebas, SQL de preflight y propuesta). **No probado en navegador ni contra la base real.** **No se ejecutó SQL**, no se tocó producción, no se borró ninguna vacación. La reparación de datos es una **propuesta comentada** que debe aplicar RRHH + responsable de la base.

## 1. Estado real de producción (inspección previa al ticket)

| Tabla | Filas | Observación |
|---|---|---|
| `vacaciones` | 31 | 31/31 con su incidencia (empresa, empleado, fechas, días hábiles); ninguna sin pareja |
| `incidencias` (Vacaciones / A cuenta de Vacaciones) | 31 | |
| `solicitudes_vacaciones` | 0 | |
| `detalle_consumo_vacaciones` | 35 | **Normal:** una incidencia puede consumir varios saldos (incidencia 24 = saldo 69 → 9 días + saldo 70 → 1 día). No es duplicación |
| `saldos_vacaciones` | 441 | |

Hallazgos: **Elisa Jiménez López (empleado 37)** con `fecha_alta = fecha_inicio_laboral = 1899-12-31` → 127 períodos (1900-01-01 → 2026-12-30), 1901.50 otorgados, 30.00 disponibles; y ≥ 27 pares de períodos traslapados (algunos solo por compartir la fecha límite; otros reales, p. ej. Amílcar Bernabé Torres Cho: saldo 78 `2024-05-31→2025-05-30` vs saldo 79 `2025-04-13→2026-04-12`, 48 días).

## 2. Discovery del motor

| Pieza | Dónde | Comportamiento |
|---|---|---|
| Generar períodos | `sincronizarPeriodosVacacionesEnConexion` (`src/lib/rrhh/vacaciones.ts`) | Lee **`empleados.fecha_alta`** (no `fecha_inicio_laboral`); períodos `1..aniosCompletos+1`, `[alta+(n-1)a, alta+na−1d]`; empareja filas existentes **solo por `anio_laboral`** |
| Vencer períodos | mismo archivo | Los períodos **completos** más allá de los 2 primeros más recientes pasan a `Vencido` y **`dias_disponibles = 0`** |
| Tope de 30 | mismo archivo | Con 2 completos vigentes, el excedente del período en curso se descuenta del más viejo |
| FIFO consumo | `registrarVacacionesFifoEnConexion` | Períodos `Vigente` con disponibles > 0, `ORDER BY anio_laboral ASC`; inserta `detalle_consumo_vacaciones (incidencia_id, saldo_id, dias_tomados)` |
| Devolver FIFO al eliminar | `vacaciones-eliminar.ts` | Devuelve al **mismo** `saldo_id`; si el saldo está `Vencido`, esos días **no se restauran** |
| Saldo mostrado | `obtenerPeriodosDisponibles` / `calcularSaldoTotalDisponible` | Solo `estado = 'Vigente'` |
| Alertas | `rrhh/vacaciones/alertas`, `notificaciones` | `SUM(dias_disponibles)` de saldos `Vigente`, umbral 15 días |
| UI | `rrhh/vacaciones/page.tsx`, `portal/vacaciones/page.tsx` | Listan solo los períodos vigentes («Máximo 2 periodos vigentes (30 días)») |
| Esquema | `sql/schema.sql` | `saldos_vacaciones`: `UNIQUE (id_empleado, periodo_inicio, periodo_fin)`, `anio_laboral NULL`; **`detalle_consumo_vacaciones.saldo_id → ON DELETE CASCADE`**; el detalle no tiene `empresa_id` |

## 3. Causa exacta de la «limitación de 2 períodos»

1. `MAX_PERIODOS_VIGENTES = 2` marca como `Vencido` y pone `dias_disponibles = 0` a todo período completo más antiguo (es la regla legal del tope de 30 días / 2 períodos acumulables).
2. Todas las lecturas (`obtenerPeriodosDisponibles`, alertas, UI de RRHH y portal) filtran `estado = 'Vigente'`, por lo que lo vencido **no se muestra**.

No se borra nada en BD (los vencidos siguen ahí); la limitación es de **visibilidad y de presentación**. **Se mantiene** la regla de 30 días para el saldo UTILIZABLE; lo que cambia es que el **historial** muestra todos los períodos.

## 4. Causa exacta de los traslapes

El sincronizador emparejaba por `anio_laboral` y:
- **reescribía** las fechas de los períodos `Vigente` con la fecha base actual, pero **nunca tocaba los `Vencido`** (quedaban congelados con las fechas de la base anterior) → traslapes cuando la fecha base cambió o hubo un desfase de un día (patrón consistente con la corrección de zona horaria de fechas `DATE`, RRHH-FECHAS-DATE-TIMEZONE, que movió la base −1 día: explicaría los **bordes de un día**, p. ej. Álvaro `…→2023-10-30` / `2023-10-30→…`; es una hipótesis que el preflight permite confirmar);
- **ignoraba** filas con `anio_laboral` NULO y no tenía `UNIQUE (empleado, anio_laboral)`: una fila «huérfana» y una nueva serie podían coexistir superpuestas;
- reescribía fechas de saldos **con consumo FIFO** si la fecha base cambiaba (reinterpretación silenciosa);
- aceptaba **cualquier** `fecha_alta` (Elisa, 1899) y generaba un período por año desde entonces.
Las dos categorías del reporte: **BORDE** (solo comparten la fecha límite, 1 día) y **REAL** (varios días, p. ej. 48).

## 5. Qué cambia en el motor (sin tocar FIFO)

Nuevo módulo puro `src/lib/rrhh/vacaciones-periodos.ts` (probado) y `vacaciones.ts` lo usa:

- **Fechas inclusivas, sin traslape por construcción:** período `n = [alta+(n−1) años, alta+n años−1 día]`; el siguiente empieza **exactamente** el día después. Cada límite se calcula desde la fecha base (sin deriva); bisiestos: el 29-feb cae al 28 en años no bisiestos y vuelve al 29, siempre `inicio(n+1) = fin(n)+1`.
- **Nunca inserta un período que se superponga** con cualquier fila existente (vencida, de otra serie o sin año).
- **Saldo con consumo FIFO: sus fechas no se reescriben**; si no coinciden con lo esperado → advertencia `FECHAS_DISTINTAS_CON_CONSUMO` (reparación administrada). Sin consumo: se realinea solo si el rango nuevo no se superpone.
- **Fecha laboral sospechosa (< 1980 o inválida): no se genera ni modifica nada** (ni períodos ni vencimientos ni tope). Se advierte.
- **Filas con `anio_laboral` NULO o repetido:** no participan y se advierte.
- **Idempotente:** sincronizar dos veces no inserta ni actualiza nada la segunda vez.
- **Sin cambios:** FIFO (orden, `incidencia_id/saldo_id/dias_tomados`), vencimiento, tope de 30, fórmula proporcional (movida sin cambios al módulo puro y re-exportada), eliminación y devolución de saldo.

### Comportamiento ante cambio de fecha laboral
| Situación | Resultado |
|---|---|
| Sin consumos y el nuevo rango no se superpone | Se **realinean** las fechas (y otorgados) de los períodos existentes; **no** se crea una segunda serie |
| Con consumos en el período | **No se reescribe**; advertencia y reparación administrada (preflight + propuesta); no se crean períodos que lo superpongan |
| Rango nuevo se superpondría con otra fila | No se escribe; advertencia |
| Fecha nueva sospechosa (< 1980) | No se genera nada; advertencia |
La confirmación explícita al editar la ficha (UI de empleados) **no** se implementó (alcance: RRHH empleados); queda documentada como siguiente paso: al cambiar `fecha_alta` con saldos existentes, mostrar el resumen de impacto del preflight y exigir confirmación. El motor ya es seguro sin ella.

## 6. Historial completo (API y UI)

- `obtenerHistorialPeriodos(empresa, empleado)` devuelve **todos** los períodos (año laboral, período, otorgados, **consumidos** = Σ detalle FIFO, disponibles, estado visual `En curso | Vigente | Consumido | Vencido`), el **saldo actual utilizable** (solo vigentes, tope 30; **no** suma el historial), la fecha laboral, `fechaLaboralSospechosa`, `historialOculto` y `advertencias` (incluye `TRASLAPE_BORDE` / `TRASLAPE_REAL` con días).
- `GET /rrhh/vacaciones?empleadoId=` (y `soloResumen=1`): campo **aditivo** `historial` (si falla, no rompe saldo/registro).
- UI: componente `HistorialPeriodosVacaciones` — «Saldo actual: XX días» + tabla expandible *Año laboral | Período | Otorgados | Consumidos | Disponibles | Estado*; en RRHH con advertencias administrativas, en el portal solo la tabla.
- **Fecha sospechosa:** no se muestran 127 períodos como válidos; se muestran solo los **vigentes o con consumo** y una advertencia («requiere el dato real de RRHH»).

## 7. SQL (propuesta; NO ejecutado)

- `sql/preflight-2026-10-vacaciones-historial-periodos.sql` — **solo lectura**: períodos por empleado, fecha laboral, primer/último período, anteriores a 1980/fecha de alta, **traslapes con días y tipo BORDE/REAL**, duplicados, gaps, otorgados > 15, disponibles > otorgados, consumos con saldo/incidencia ajenos o faltantes, saldos usados por el detalle (no eliminables), vacaciones/incidencias sin pareja, fechas sospechosas (< 1980, solo reporte), **Elisa (empleado 37)** explícita con «fecha laboral inválida/sospechosa; requiere dato de RRHH antes de reparar», y clasificación **A/B/C/D**.
- `sql/propuesta-2026-10-reparar-periodos-vacaciones.sql` — **100 % comentado**: respaldo, clase D (ficha), A (eliminar con `NOT EXISTS (detalle)`), B (con consumo: nunca eliminar), C (decisión de RRHH), verificación final. Documenta que el `ON DELETE CASCADE` del detalle borraría el consumo FIFO y exige verificar los conteos (31 / 31 / 35) antes y después.

## 8. Datos que requieren decisión humana

1. **Elisa Jiménez López (id 37):** fecha real de alta (y de inicio laboral). No se asume.
2. **¿Qué fecha manda?** El motor usa `fecha_alta`; la ficha también tiene `fecha_inicio_laboral` (usada por planilla). Confirmar cuál debe regir las vacaciones.
3. **Cada traslape REAL** (p. ej. Amílcar, saldos 78/79): confirmar la fecha laboral correcta antes de realinear o eliminar filas.
4. **Si los períodos vencidos con días sin tomar deben conservar su saldo** (hoy se ponen en 0): el historial muestra otorgados y consumidos, pero la regla de pérdida es la legal vigente de los 2 períodos; cualquier cambio es decisión de RRHH.
5. **Confirmación al cambiar `fecha_alta`** en la ficha (siguiente ticket).

## 9. Pruebas

`vacaciones-periodos.test.ts` (20): períodos sin traslape, bisiestos, borde vs real (casos Álvaro/Amílcar), fecha sospechosa (Elisa), 1 y 10 períodos, histórico completo, vencidos, prevención de traslape, no duplicar, cambio de fecha con y sin consumo, vacaciones existentes sin cambio. `vacaciones-historial-db.test.ts` (14, BD en memoria sobre el código real): historial conservado sin DELETE, tope 30, vencimiento, idempotencia, Elisa sin escrituras, cambio de fecha con/sin consumo, **FIFO** (9+1 con `incidencia_id/saldo_id/dias_tomados` exactos, orden por año laboral), `obtenerHistorialPeriodos`. `vacaciones-sql-contrato.test.ts` (5): preflight solo lectura, propuesta 100 % comentada, protección de saldos con consumo, Elisa.
