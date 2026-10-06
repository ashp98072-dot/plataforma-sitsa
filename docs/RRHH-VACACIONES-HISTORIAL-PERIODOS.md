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

El planificador (`planificarSincronizacion`) es **TODO O NADA**: o sincroniza la serie completa con seguridad, o el empleado queda **congelado** y no se escribe NADA.

- **Fechas inclusivas, sin traslape por construcción:** período `n = [alta+(n−1) años, alta+n años−1 día]`; el siguiente empieza **exactamente** el día después. Cada límite se calcula desde la fecha base (sin deriva); bisiestos: el 29-feb cae al 28 en años no bisiestos y vuelve al 29, siempre `inicio(n+1) = fin(n)+1`.
- **Idempotente:** sincronizar dos veces no inserta ni actualiza nada la segunda vez (y el estado congelado tampoco escribe nunca).
- **Sin cambios:** FIFO (orden, `incidencia_id/saldo_id/dias_tomados`), vencimiento, tope de 30, fórmula proporcional (movida sin cambios al módulo puro y re-exportada), eliminación y devolución de saldo.

### A) Consumo + serie correcta → operación normal
Tener consumo **no** bloquea: si las fechas del saldo consumido **ya coinciden** con la serie esperada para su año laboral, el saldo se conserva tal cual (días y fechas), el historial **sigue creciendo** (se crea el siguiente período) y se aplican vencimiento y tope de 30 como siempre. Ejemplo: alta `2024-10-31`, saldo 1 `2024-10-31 → 2025-10-30` con consumo, hoy `2026-10-06` → se conserva el saldo 1 y se crea el período 2 `2025-10-31 → 2026-10-30`.

### B) Consumo + serie incompatible con la fecha laboral actual → CONGELACIÓN TOTAL
**Condición exacta que bloquea la sincronización de un empleado** (cualquiera de las tres; se emite una advertencia `bloqueante` y `requiereReparacion = true`):

1. **`FECHA_SOSPECHOSA`** — fecha de alta inválida o anterior a 1980.
2. **`SERIE_HISTORICA_CON_CONSUMO`** — existe **al menos un saldo con consumo FIFO** (en cualquier estado, también `Vencido`) cuyas fechas **no coinciden** con las esperadas para su `anio_laboral` según la fecha de alta actual; o que no tiene año laboral; o cuyo año excede la serie esperada. Es la evidencia de que la fecha laboral cambió o la serie es incompatible.
3. **`ESTRUCTURA_INCONSISTENTE`** (fail-safe: no se puede determinar una única serie segura) — año laboral **duplicado**; un saldo **sin año laboral que se superpone** con la serie esperada; o un **traslape REAL** (> 1 día) ya existente entre filas.

Cuando bloquea: **0 inserts, 0 updates**; **no** se realinea ningún otro saldo (ni siquiera los sin consumo); **no** se crean períodos futuros; **no** se vence ningún período; **no** se reduce nada a 0; **no** se aplica el tope de 30; el detalle FIFO queda intacto. La **lectura/historial sigue funcionando** y muestra el aviso «Sincronización congelada… requiere reparación administrada».

**No bloquea** (advertencias informativas): un saldo sin año laboral **fuera** de la serie; traslapes de **BORDE** de 1 día; un período nuevo omitido por superponerse con una fila existente; una realineación omitida por traslape.

> **Impacto operativo a conocer antes de desplegar:** los empleados que cumplan alguna de estas condiciones **dejan de recibir períodos nuevos** hasta repararse. La **sección 12 del preflight** lista exactamente quiénes (por motivo). Con los datos descritos (≥ 27 pares traslapados, Elisa con fecha 1899, cambios de fecha con consumo) habrá empleados en este estado: es el comportamiento seguro buscado, y se corrigen con la propuesta de reparación administrada.

### Comportamiento ante cambio de fecha laboral
| Situación | Resultado |
|---|---|
| Sin consumos y la serie nueva no se superpone | Se **realinean** las fechas (y otorgados) de los períodos existentes; **no** se crea una segunda serie |
| **Con consumo y la serie ya no coincide** | **Congelación total** (B): no se escribe nada para ese empleado |
| Con consumo pero las fechas ya coinciden con la serie esperada | Operación normal (A) |
| Fecha nueva sospechosa (< 1980) | Congelación (`FECHA_SOSPECHOSA`) |

La confirmación explícita al editar la ficha (UI de empleados) **no** se implementó (alcance: RRHH empleados); queda documentada como siguiente paso: al cambiar `fecha_alta` con saldos existentes, mostrar el resumen de impacto del preflight y exigir confirmación. El motor ya es seguro sin ella.

## 6. Historial completo (API y UI)

- `obtenerHistorialPeriodos(empresa, empleado)` devuelve **todos** los períodos (año laboral, período, otorgados, **consumidos** = Σ detalle FIFO, disponibles, estado visual `En curso | Vigente | Consumido | Vencido`), el **saldo actual utilizable** (solo vigentes, tope 30; **no** suma el historial), la fecha laboral, `fechaLaboralSospechosa`, `historialOculto` y `advertencias` (incluye `TRASLAPE_BORDE` / `TRASLAPE_REAL` con días).
- `GET /rrhh/vacaciones?empleadoId=` (y `soloResumen=1`): campo **aditivo** `historial` (si falla, no rompe saldo/registro).
- UI: componente `HistorialPeriodosVacaciones` — «Saldo actual: XX días» + tabla expandible *Año laboral | Período | Otorgados | Consumidos | Disponibles | Estado*; en RRHH con advertencias administrativas, en el portal solo la tabla.
- **Congelado:** `requiereReparacion` + advertencias bloqueantes (en RRHH se muestra un aviso; el historial sigue legible).
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

`vacaciones-periodos.test.ts` (29): períodos sin traslape, bisiestos, borde vs real (casos Álvaro/Amílcar), fecha sospechosa (Elisa), 1 y 10 períodos, histórico completo, vencidos, prevención de traslape, no duplicar, cambio de fecha sin consumo, vacaciones existentes sin cambio, **y la congelación total**: (1) cambio de fecha + saldo 1 con consumo + saldo 2 sin consumo → 0 inserts / 0 updates / ningún saldo cambia / advertencia bloqueante; (2) cambio de fecha + consumo + período nuevo potencial → no se crea; (3) serie correcta + consumo → el siguiente período se crea normal; consumo en `Vencido`, sin año o fuera de serie → congela; idempotencia del estado bloqueado; bloqueantes vs informativas; fail-safe por año duplicado, sin año en la serie y traslape REAL (el borde de 1 día no bloquea).
`vacaciones-historial-db.test.ts` (19, BD en memoria sobre el código real): historial conservado sin DELETE, tope 30, vencimiento, idempotencia, Elisa sin escrituras, **conflicto histórico con consumo: sin INSERT ni UPDATE de saldos, sin `Vencido`, sin tope y `detalle_consumo_vacaciones` intacto** (también para un saldo sin consumo de la misma serie vieja y repetido N veces), serie correcta con consumo (crecimiento normal), estructura inconsistente, FIFO (9+1 con `incidencia_id/saldo_id/dias_tomados` exactos, orden por año laboral), `obtenerHistorialPeriodos` (también congelado).
`vacaciones-sql-contrato.test.ts` (5): preflight solo lectura, propuesta 100 % comentada, protección de saldos con consumo, Elisa.
