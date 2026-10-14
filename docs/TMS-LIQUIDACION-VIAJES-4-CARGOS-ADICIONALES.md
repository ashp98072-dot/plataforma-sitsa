# TMS — Liquidación de viajes · FASE 4: cargos adicionales facturables

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (tsc, ESLint, pruebas unitarias y de BD contra MariaDB 11.8.9 desechable).
**NO PROBADO manualmente en navegador contra datos reales. NO APROBADO PARA PRODUCCIÓN.** La migración SQL **no se ejecutó** en ninguna
base real. Sin IVA, sin FEL, sin líneas de factura, sin cambios al cierre.

## Decisiones de negocio confirmadas que rigen esta fase

1. **Reapertura = A.** Reabrir una liquidación NO reabre el viaje operativo: `Cerrado + LIQUIDADO → Cerrado + EN_AJUSTE → Cerrado + RELIQUIDADO`.
2. **Secuencia:** viaje realizado → reporte recibido → cerrar → liquidar → facturación/reportes. Los cargos viven **antes de liquidar**, con el
   viaje abierto o cerrado. La antigua Fase 5 («el cierre exige LIQUIDADO») queda eliminada; la futura regla de cierre será «para cerrar debe
   existir `REPORTE_RECIBIDO`» (individual, manual, masivo y por período) — fase posterior, no incluida aquí.
3. **Los cargos son de la liquidación/comercial, no de la operación física.** Se editan en estos casos:

| Viaje | Liquidación | Cargos |
|---|---|---|
| Abierto | sin registro | **editables** |
| Abierto | `REPORTE_RECIBIDO` | **editables** |
| `Cerrado` | `REPORTE_RECIBIDO` | **editables** |
| `Cerrado` | sin liquidación registrada (histórico) | **editables** (no está liquidado) |
| `Cerrado` | `EN_AJUSTE` | **editables** |
| cualquiera | `LIQUIDADO` (incluye RELIQUIDADO = versión > 1) | **bloqueados** — reabrir la liquidación primero |
| `Cancelado` | cualquiera | **bloqueados** (*supuesto a confirmar*: un viaje cancelado no se factura) |

«RELIQUIDADO» no es un estado propio del modelo: es `LIQUIDADO` con versión > 1 (el evento sí se llama `RELIQUIDADO`).

## Qué se implementó

- **Tablas nuevas** (`sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql`, sin ALTER de tablas existentes, sin seeds, sin backfill):
  - `tms_viaje_cargos_adicionales`: estado vigente del cargo (`concepto`, `monto DECIMAL(12,2) > 0`, `observacion`, `activo`, `version`
    optimista, `anulado_por/en/motivo`, `clave_envio` + `huella` para idempotencia, `creado_por/en`, `actualizado_por/en`). Nunca se borra:
    se anula con motivo y puede reactivarse. FK compuesta `(empresa_id, plan_id)` → `tms_planes_viaje(empresa_id, id)`.
  - `tms_viaje_cargo_eventos`: historia **append-only** (una fila por cambio con estado antes/después, `UNIQUE(empresa_id, cargo_id, version)`,
    `ON DELETE RESTRICT`).
- **Dominio** (`src/lib/tms/cargos-adicionales.ts`, validaciones puras en `cargos-adicionales-shared.ts`): crear (idempotente por
  `claveEnvio`), editar, anular (motivo ≥ 5), reactivar. Todo cambio toma el lock del plan y luego el de la liquidación (mismo orden que
  `liquidarViaje`), de modo que **liquidar y modificar cargos se serializan**.
- **Permiso** `viajes_cargos_adicionales` (fila propia en `usuario_modulo`, 25 caracteres, flag `editar`, **sin rol por defecto**, separado
  de `viajes_liquidar`, `viajes_reabrir_liquidacion` y `viajes_cerrar`). Admin recibe el catálogo completo, como en el resto.
- **Endpoints** (empresa y usuario salen de la sesión; esquemas `strict`):
  `GET/POST /tms/planes/[id]/cargos`, `PATCH /tms/planes/[id]/cargos/[cargoId]`, `POST …/anular`, `POST …/reactivar`,
  `GET /tms/planes/cargos-resumen?ids=…` (una consulta, sin N+1, máx. 500).
- **UI** en Programación → Ajustes rápidos: columna **«Cargos»** con «Cargos: n · Q total» y botón que abre el panel (agregar, editar,
  anular con motivo, reactivar, historial, creado/actualizado por/en). Los cargos guardan **de inmediato y con su propia auditoría**; no
  entran al borrador/validación/motivo de la tabla.
- **Totales:** «**Total comercial preliminar**» = tarifa base + cargos vigentes (Decimal, nunca float). No es «total factura»: no incluye IVA
  ni tratamiento fiscal. Sin tarifa base no se inventa un total (`null`).
- **Snapshot de liquidación** (aditivo, compatible hacia atrás): el evento `LIQUIDADO/RELIQUIDADO` congela también los cargos **vigentes**
  (`operativo.cargos`: concepto, monto, observación, total, `ivaPendiente: true`), leídos bajo el lock del plan. Los snapshots anteriores no
  traen el campo y siguen siendo válidos. Los costos internos **no** entran.
- Se corrigió un comentario desactualizado de `reabrir-liquidacion/route.ts` (decía que no admite viajes Cerrado).

## Tratamiento de IVA de cargos adicionales: PENDIENTE de definición de negocio/fiscal

Nada en esta fase suma, incluye ni excluye IVA, ni calcula retención sobre cargos, ni genera líneas de factura/FEL. Cuando se defina, el
cambio previsible es una columna (p. ej. `afecto_iva`) en la tabla de cargos y su uso en el armado de la factura; no requiere migrar los
datos existentes.

## Problema documentado: `fact_factura_viajes` tiene `UNIQUE(plan_id)`

[CONFIRMADO en `sql/migrate-2026-08-fact-1-facturas-pagos.sql`] `fact_factura_viajes` guarda **una sola fila viva por viaje**
(`UNIQUE KEY uq_factviaje_plan (plan_id)`) con un único `monto_asignado`. Es la garantía anti doble facturación y hoy modela «un viaje = una
línea facturada = un monto».

Consecuencias para los cargos:
- Un cargo adicional **no puede** representarse como una segunda fila del mismo `plan_id` sin romper la garantía.
- Hoy el monto asignado del viaje es **tarifa base**; los cargos no tienen dónde ir.
- [CONFIRMADO en `sql/migrate-2026-10-fact-4-lineas-contado-retencion.sql`] FACT-4 ya permite que un viaje esté en varias líneas de factura
  (`fact_factura_lineas` + `fact_factura_linea_viajes`, `UNIQUE(linea_id, plan_id)`), pero esas tablas **no participan de la defensa contra
  doble facturación**: el vínculo viaje↔factura ACTIVO sigue siendo `fact_factura_viajes` con `UNIQUE(plan_id)`.

Opciones para la fase de facturación (**no decididas, no implementadas**):
1. Sumar cargos al `monto_asignado` del viaje (simple, pierde el desglose; debe quedar en la línea de factura como descripción).
2. Una línea de factura por cargo, referenciando `cargo_id` (conserva desglose; exige que las líneas dejen de depender del `UNIQUE(plan_id)`
   y que la anti doble facturación se mueva a «cargo facturado una sola vez»).
3. Tabla puente `fact_factura_cargos (factura_id, cargo_id UNIQUE)`: cada cargo se factura a lo sumo una vez, sin tocar `UNIQUE(plan_id)`.
   Es la que menos riesgo introduce sobre lo ya productivo.

Esta fase deja los cargos listos (tabla propia, estado vigente, `activo`, `version`, snapshot) para cualquiera de las tres.

## Pregunta de negocio abierta que afecta a la UI

**Programación ya no lista viajes `Cerrado`** (`perteneceAlTableroProgramacion`: el historial vive en Planes / Viajes) y **Ajustes rápidos
solo muestra las filas visibles de Programación**. Por la regla confirmada, los cargos deben poder editarse con el viaje `Cerrado` y la
liquidación en `REPORTE_RECIBIDO` o `EN_AJUSTE`, pero esos viajes **no aparecen en Ajustes rápidos**. El servidor ya lo permite (probado);
falta decidir dónde se operan: (a) también en Planes / Viajes junto a «Liquidar viaje» (recomendado: ahí viven los viajes cerrados y la
acción de liquidar), (b) hacer que Ajustes rápidos incluya los cerrados pendientes de liquidar, o (c) ambas. **No se asumió.**

## Despliegue (NO ejecutado)

1. `sql/preflight-2026-10-tms-liquidacion-cargos-fase4.sql` (solo lectura) en la BD objetivo; aplicar solo con resultado APTO.
2. `sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql` (idempotente; dos tablas nuevas; sin datos).
3. `sql/verify-2026-10-tms-liquidacion-cargos-fase4.sql` (solo lectura): tablas en 0 filas e invariantes en 0.
4. Asignar `viajes_cargos_adicionales` manualmente desde Usuarios a quien deba gestionar cargos.
Las lecturas toleran tablas ausentes (lista vacía), de modo que el código puede desplegarse antes de migrar, pero **crear cargos fallará**
hasta aplicar la migración.

## Pruebas

- Unitarias/arquitectura (`cargos-adicionales.test.ts`): validaciones, Decimal, matriz de estados, permiso, endpoints estrictos, alcance (no
  importa cierre/facturación/FEL/contabilidad/fondos/gastos), SQL sin DROP/ALTER, UI («Total comercial preliminar», sin «total factura»).
- BD (`cargos-adicionales.db.test.ts`, MariaDB 11.8.9 desechable, migraciones dos veces): ciclo de vida y versiones, idempotencia, matriz de
  estados con liquidación real (reabrir sin reabrir el viaje; re-liquidación congela el cargo agregado en ajuste), aislamiento por empresa,
  edición concurrente, doble clic, **carrera crear cargo vs liquidar** (12 iteraciones), no escritura en facturación/FEL/contabilidad/
  fondos/gastos. Verificado con mutación (quitar el bloqueo `LIQUIDADO` falla 2 pruebas).
