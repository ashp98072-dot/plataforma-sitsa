# PriceSmart KPI — capa de consulta y exportación (proyecto separado)

Estado: **VERIFICADO TÉCNICAMENTE** en el laboratorio (MariaDB 11.8.9 real). KPI es un proyecto **distinto** de la integración operativa (minuta 30/10/2026): esta capa no usa ni modifica los contratos de la API, no publica nada hacia PriceSmart y **no define el mecanismo de entrega** (SFTP, Data, API): eso sigue pendiente de acuerdo con PriceSmart. No hay endpoint público, SFTP ni credenciales.

## Qué existe
- `src/lib/integrations/pricesmart/kpi/kpi-model.ts` — funciones **puras** (`buildKpiRow`, `parseClub`, `kpiToCsv`, `csvCell`). Sin base de datos, reloj ni red.
- `src/lib/integrations/pricesmart/kpi/kpi-source.ts` — `loadKpiRows`: solo `SELECT`, con la función de consulta **inyectada** (puede correr con una cuenta de solo lectura). Acotada por **empresa** (obligatoria) y, opcionalmente, cliente y fechas; máximo 1000 filas.
- `src/lib/integrations/pricesmart/lab-demo/kpi-entry.ts` — pegamento de laboratorio/sandbox: exige un esquema `sandbox_api02_*` y que existan las tablas de PriceSmart; en producción responde `{ enabled: false }`.
- Ruta interna `GET /api/empresas/[slug]/tms/solicitudes-clientes/pricesmart/kpi?formato=json|csv&desde&hasta&clienteId&limite` — personal autenticado con el permiso **exportar Programación** (`requireTenantProgramacionExportar`); la empresa sale de la sesión. 404 fuera del laboratorio/sandbox.
- Separación verificada por prueba (`kpi.test.ts`): ningún módulo operativo importa `kpi/` (salvo `lab-demo/kpi-entry.ts`) y `kpi/` no importa runtime, transporte, M2M ni handlers (solo el evaluador puro `delivery-evidence`).

## Campos de la minuta
Una orden de PriceSmart se identifica por el **vínculo persistido** `ps_api12_tms_links.solicitud_id` (nunca por texto). Las fechas/horas son texto en la hora **local del TMS** (zona horaria sin ratificar: D07).
| Campo | Fuente real en SITSA | Vinculación con la orden | Disponibilidad | Calidad y precisión | Criterio de cálculo |
|---|---|---|---|---|---|
| **Número de orden** | `tms_solicitudes_cliente.referencia_cliente` (= `externalOrderId` que envió PriceSmart) | solicitud ↔ orden por `ps_api12_tms_links` | DISPONIBLE | Exacto; formato de ID pendiente (D03) | Copia literal |
| **Club** | texto de `tms_solicitudes_cliente.observaciones` escrito por la integración (`… · club X · …`) | ídem | DISPONIBLE solo con el contrato de laboratorio `lab-demo-1`; otro texto → SIN_DATO | **PROVISIONAL**: cada fila con club trae `clubFuente = OBSERVACIONES_PROVISIONAL_D06` (CSV: columna `club_fuente`); depende del contrato D06; el payload cifrado de la orden no se descifra aquí | Se extrae solo del formato conocido; nunca se adivina |
| **Fecha planificada** | `tms_planes_viaje.fecha_plan` | solicitud → `plan_id` (mismo empresa y cliente) | SIN_DATO hasta que Operaciones programa | Fecha calendario del plan (la fija Operaciones); puede reprogramarse | Copia; `null` si no hay plan |
| **Ventana de entrega** | **NO EXISTE** en SITSA (ni en la solicitud ni en el plan ni en las paradas; la orden de laboratorio trae solo `deliveryDate`) | — | **NO_DISPONIBLE** | — | Siempre `null`; requiere que PriceSmart la envíe (D06/D07) y que el TMS la guarde |
| **Fecha y hora de salida** | `flota_viajes.hora_salida` del viaje del plan (`flota_viajes.plan_id`), registrado por el piloto | plan → viaje | SIN_DATO hasta que el piloto registra la salida; un viaje sin vincular al plan (0 o 2+ candidatos) queda invisible | Marca del piloto/dispositivo, no GPS verificado; si hay varios viajes, la **primera** salida | `MIN(hora_salida)` |
| **Fecha y hora de entrega** | `tms_parada_confirmaciones.confirmado_en` (confirmación del piloto por parada con evidencia vinculada) | plan → paradas `Entrega` → confirmaciones vigentes | SIN_DATO salvo que **todas** las entregas del plan estén confirmadas con evidencia y sin revisión pendiente; NO_DISPONIBLE si la tabla aún no existe (migración «PARA REVISIÓN» sin aplicar) | **Es evidencia registrada por el piloto, NO entrega aceptada por PriceSmart (D13)**; nombre del campo: `entregaEvidenciadaEn` | Hora del **último** evento de confirmación; evidencia parcial, pendiente o incoherente → `null` |
| **Estado del servicio** | `tms_planes_viaje.estado` si hay plan; si no, `tms_solicitudes_cliente.estado` | solicitud → plan | DISPONIBLE | Valores **crudos del TMS** (no los estados provisionales de la API, D08) | Plan si existe; si no, solicitud. «Descargado»/«Cerrado» **no** implican entrega |
| **Cantidad de ítems** | **NO EXISTE** (el contrato de laboratorio no trae ítems; las entregas son paradas, no ítems) | — | **NO_DISPONIBLE** | — | Siempre `null`; depende de D06 |
| **Cumplimiento de entrega a tiempo** | derivado | — | DISPONIBLE solo si hay hora de entrega evidenciada **y** fecha comprometida; si no `NO_CALCULABLE` con motivo | Por **día**, no por hora: no hay ventana horaria ni zona horaria ratificadas (D07); la fecha comprometida es `fecha_solicitada` (la que envió PriceSmart) | `A_TIEMPO` si fecha de la evidencia ≤ fecha comprometida; `TARDE` si no; `cumplimientoMotivo` explica por qué no se calcula |
`confirmaEntrega` es **siempre `false`** en la fila y en el CSV mientras D13 no esté ratificado.

## Exportación CSV
Columnas fijas (`KPI_CSV_COLUMNS`). Un dato que SITSA no tiene → `NO_DISPONIBLE`; uno que existe pero aún no tiene valor → celda vacía. Las celdas que una hoja de cálculo interpretaría como fórmula (`= + - @`, tab, CR) se neutralizan; no incluye destinatario, dirección ni observaciones. Una fila por orden vinculada.

## Seguridad y protección de datos
Solo lectura; empresa de la sesión; permiso explícito de exportación; sin datos personales del destinatario; sin endpoint público. Para uso programático (fuera del TMS) se recomienda una **cuenta de solo lectura dedicada** (no creada aquí): la cuenta `monitor` del sandbox no puede leer órdenes por diseño.

## Pruebas
Unitarias `kpi.test.ts` (13): sin inventar, evidencia parcial/pendiente/incoherente, Descargado/Cerrado no generan entrega, CSV seguro, consulta acotada, entradas inválidas, separación. E2E `kpi.e2e.ts` K.1–K.5 con MariaDB real: orden sin programar, programada/en ruta con salida real, evidencia → a tiempo/tarde, incidencia pendiente, aislamiento por empresa/cliente, órdenes sin vínculo fuera, límite, CSV sin datos personales. Guardián de límites (`contract.test.ts`) ampliado para la ruta interna.

## Pendiente (no se pudo cerrar internamente)
Mecanismo de entrega a PriceSmart y credenciales (SFTP/Data/API); ventana de entrega y cantidad de ítems (requieren campos en el contrato y en el TMS: D06/D07); definición de «a tiempo» (hora y zona horaria: D07); entrega confirmada (D13).
