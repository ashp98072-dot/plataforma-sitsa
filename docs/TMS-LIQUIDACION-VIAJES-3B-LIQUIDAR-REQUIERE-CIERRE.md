# TMS — Liquidación de viajes · FASE 3B: liquidar exige el viaje CERRADO

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local.** Sin SQL, sin cambio del cierre, sin cargos, sin facturación. **Corrige el
prerrequisito de secuencia** de la Fase 3 (que permitía liquidar con el viaje abierto) y **supersede** las frases de
[Fase 3](TMS-LIQUIDACION-VIAJES-3-LIQUIDAR-REABRIR.md) que decían que Cerrado/Cancelado no admiten ninguna transición.

## Secuencia real de Operaciones

1. Viaje realizado → 2. **Reporte recibido** → 3. Ajustes / cargos → 4. **Cerrar viaje** → 5. **Liquidar viaje** → 6. Facturación / reportes.

## Cómo se representa «Cerrado» hoy [CONFIRMADO en código]

- `tms_planes_viaje.estado = 'Cerrado'` (valor de texto), con `cerrado_por` (usuario) y `cerrado_en`; el cierre manual agrega `cierre_manual = 1`,
  `cierre_manual_motivo/comentario`.
- Cierre individual (`cerrarViaje`), manual (`cerrarViajeManual`), masivo (`cerrarViajesMasivo`) y por período (`cerrarViajesMasivoPorPeriodo`)
  terminan **todos** en esas dos funciones; no hay otra vía.
- **Ningún código reabre un viaje cerrado** (no existe `UPDATE … estado = 'Programado'/…` desde `Cerrado`); el cierre es hoy irreversible en el sistema.
- En Planes/Viajes un viaje `Cerrado` queda en la pestaña «Cerrados»: «Ver expediente», PDF; sin cierre, sin «Programación», edición bloqueada.

## Regla implementada

| Operación | Regla (validada en el SERVIDOR, bajo el lock del plan) |
|---|---|
| Liquidar (`REPORTE_RECIBIDO → LIQUIDADO`) | Solo con el viaje `Cerrado`; abierto ⇒ 409 `PLAN_NO_CERRADO`; `Cancelado` ⇒ 409 `PLAN_NO_ADMITE` |
| Liquidar nuevamente (`EN_AJUSTE → LIQUIDADO`) | Igual: solo `Cerrado` |
| Reabrir liquidación (`LIQUIDADO → EN_AJUSTE`) | Procede con el viaje `Cerrado` (y con abierto, para datos previos a la regla); `Cancelado` ⇒ 409. **El viaje permanece Cerrado** (opción A, ver abajo) |
| Confirmar reporte | **Sin cambios**: solo con el viaje abierto; réplica idempotente aunque el viaje ya se haya cerrado estando en `REPORTE_RECIBIDO` |

UI (Planes/Viajes): `REPORTE_RECIBIDO` / `EN_AJUSTE` con el viaje abierto ⇒ **no** se muestra «Liquidar viaje»/«Liquidar nuevamente» (solo
«Cerrar el viaje para liquidar»); con el viaje `Cerrado` ⇒ se ofrecen con su permiso; `LIQUIDADO` ⇒ «Reabrir liquidación». El modal tampoco permite
liquidar un viaje abierto (el servidor es la validación definitiva). Colores/badges sin cambios.

**Históricos:** una liquidación `LIQUIDADO` creada con la Fase 3 sobre un viaje aún abierto no se toca; puede reabrirse, pero no re-liquidarse hasta
que el viaje se cierre. Sin backfill, sin SQL.

## Análisis pendiente de decisión: ¿qué pasa al reabrir la liquidación de un viaje YA cerrado?

| | **A) Permanece Cerrado**; solo la liquidación entra en `EN_AJUSTE` | **B) También se reabre operativamente** (el viaje deja de estar Cerrado) |
|---|---|---|
| Patrón actual del sistema | **Coincide**: el cierre es irreversible; el modelo separa estado operativo y liquidación (dimensión aparte) | **No existe**: ningún código reabre un `Cerrado`; habría que construir la capacidad |
| Esfuerzo / riesgo | Bajo: ya implementado en esta PR | Alto: nuevo flujo sobre `cerrarViaje*`, permisos, auditoría, disponibilidad de unidad y personal |
| Facturación | El viaje sigue facturable/facturado (`Cerrado`); un ajuste de liquidación no libera nada | Un viaje reabierto **deja de ser facturable** y, si ya tiene factura viva (`UNIQUE(plan_id)` en `fact_factura_viajes`), hay que anularla antes o bloquear la reapertura |
| Programación | Sin efecto: el viaje no vuelve a Programación | Reabre edición de personal/unidad/tarifa/cuadrilla: puede contradecir el snapshot ya liquidado |
| Trazabilidad | Historia clara: evento `REABIERTO` + snapshots por versión | Dos historias (cierre y liquidación) que reconciliar; cierre manual/masivo con `cerrado_por/en` sobrescrito |
| Qué permite corregir | Ajustes de **liquidación** (observaciones, cargos) mientras no se mueva la operación | Cualquier dato operativo (tarifa, piloto, unidad…) |
| Riesgo si se decide mal | Que Operaciones necesite corregir datos operativos de un viaje cerrado y no pueda | Facturar/cerrar de nuevo con datos cambiados; descuadre con facturas, fondos y cuadrilla ya consumidos |

**Estado en esta PR:** se implementó **A** porque es lo único posible sin construir un flujo nuevo de reapertura del viaje y porque evita que una
liquidación (que ahora ocurre siempre con el viaje cerrado) quede imposible de reabrir. **No es una decisión de negocio tomada**: si se decide B, se
agrega después como capacidad aparte («reabrir viaje» con sus reglas de facturación) sin deshacer lo hecho aquí.

## Impactos en el plan de fases (a decidir antes de continuar)

1. **Fase 5 (gate del cierre) queda obsoleta tal como estaba**: «el cierre exige LIQUIDADO» contradice la secuencia real (cerrar **antes** de liquidar).
   La precondición que sí encaja es otra: p. ej. **facturar** (o los reportes de rentabilidad) exigiría `LIQUIDADO` — decisión de negocio.
2. **Fase 4 (cargos adicionales)**: la regla «EN_AJUSTE permite cambiar cargos» choca con «un viaje Cerrado no admite cambios»: los cargos viven en el
   paso 3 (antes de cerrar). Hay que decidir si, ya cerrado, un cargo solo se corrige reabriendo la liquidación (A) y qué campos son editables. El
   borrador de Fase 4 (fuera de esta PR) debe ajustarse a esto antes de continuar.
3. **Confirmar reporte con el viaje ya cerrado**: hoy un `Cerrado` **sin** reporte no puede confirmarlo y por tanto no puede liquidarse (callejón sin
   salida si se cerró antes de recibir el reporte). No se cambió: es decisión de negocio (¿permitir confirmar reporte en `Cerrado`?).
4. **Históricos cerrados sin liquidación** siguen mostrándose normales con «—»; no se liquidan automáticamente.

## Pruebas

Unitarias (acciones por estado y regla pura), endpoint (409 `PLAN_NO_CERRADO`), arquitectura (el cierre no consulta la liquidación) y BD con
concurrencia real (MariaDB desechable): liquidar con el viaje abierto en cada estado operativo ⇒ rechazo sin cambios; Cerrado ⇒ procede; reabrir con
el viaje Cerrado ⇒ EN_AJUSTE y el viaje sigue Cerrado; `EN_AJUSTE` + abierto ⇒ no re-liquida; carrera cierre vs liquidación bajo el lock del plan;
Cancelado no admite nada. Verificado con mutación (sin la regla fallan 4 pruebas).
