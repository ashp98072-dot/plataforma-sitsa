# TMS — Liquidación de viajes · FASE 1: modelo persistente mínimo

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (compilación, ESLint dirigido, pruebas unitarias/arquitectura y de BD y concurrencia
contra MariaDB 11.8.9 desechable). **NO probado en producción, NO aprobado para producción, SQL NO ejecutado en ninguna BD real.**
Decisiones de origen: [0 DISCOVERY](TMS-LIQUIDACION-VIAJES-0-DISCOVERY.md) y [0B DECISIONES](TMS-LIQUIDACION-VIAJES-0B-DECISIONES.md).

## Alcance

| Incluye | NO incluye (otras fases) |
|---|---|
| 3 tablas nuevas: `tms_liquidacion_config`, `tms_viaje_liquidaciones`, `tms_viaje_liquidacion_eventos` | UI, endpoints, colores, badges (Fase 2) |
| Dominio `src/lib/tms/liquidacion-viaje*.ts`: confirmar reporte, liquidar/re-liquidar, reabrir, lecturas, activación | Requisitos de negocio de la liquidación, snapshot de cuadrilla/km (Fase 3) |
| Helper de lectura segura `liquidacionExigidaParaPlan` + `obtenerFechaActivacionLiquidacion` | Cargos adicionales (Fase 4); **cambio del cierre (Fase 5)**; cuadres (Fase 6); facturación (Fase 7) |
| preflight / migrate / verify + `schema.sql` alineado | Permisos (se declararán con la primera UI/API); FEL, contabilidad, RRHH |

## Modelo

- **`tms_viaje_liquidaciones`** (estado VIGENTE, 1:1 por viaje): `UNIQUE (empresa_id, plan_id)`, FK compuesta
  `(empresa_id, plan_id) → tms_planes_viaje(empresa_id, id)` `RESTRICT`, `estado` ∈ `REPORTE_RECIBIDO | LIQUIDADO | EN_AJUSTE`,
  `version` ≥ 1, `reporte_recibido_en/por`, `liquidado_en/por` (última liquidación), `reabierto_en/por` (última reapertura). CHECKs de
  coherencia estado↔marcas. **La ausencia de fila = «sin liquidación registrada»** (todo el histórico); no existe un estado para históricos.
- **`tms_viaje_liquidacion_eventos`** (append-only): `tipo` ∈ `REPORTE_RECIBIDO | LIQUIDADO | REABIERTO | RELIQUIDADO`, `version` (la de la
  liquidación **después** de la transición), `estado_antes/despues`, `actor_id`, `detalle` (motivo; obligatorio ≥ 5 en `REABIERTO`, observación
  opcional en `REPORTE_RECIBIDO`), `snapshot_json` mínimo (`planEstado`, `fechaPlan`, `tarifaComercial`), `creado_en`. `UNIQUE (empresa_id,
  plan_id, version)` impide duplicar eventos; FK `RESTRICT` impide borrar la liquidación o el viaje con historia.
- **`tms_liquidacion_config`**: `empresa_id` PK, `fecha_activacion_liquidacion` DATE NULL, `actualizado_por/en`. Tabla propia para **no alterar
  `empresas`**. Sin fila o con fecha NULL ⇒ la liquidación no se exige.

## Versionado y transiciones

`version` empieza en 1 (`REPORTE_RECIBIDO`) y sube **uno por transición**; el evento lleva la versión resultante, de modo que la historia es la
secuencia 1..N sin huecos.

```
(sin fila) ─confirmar─▶ REPORTE_RECIBIDO v1 ─liquidar(v1)─▶ LIQUIDADO v2 ─reabrir(v2, motivo)─▶ EN_AJUSTE v3 ─liquidar(v3)─▶ LIQUIDADO v4
                                                            (evento LIQUIDADO)                    (REABIERTO)               (RELIQUIDADO)
```

`liquidar` y `reabrir` **exigen la versión que el usuario vio** (`versionEsperada`); una versión vieja es `CONFLICTO_VERSION`. Réplica
idempotente: mismo actor y `versión = esperada + 1` ⇒ devuelve el resultado sin evento nuevo. Los viajes `Cerrado`/`Cancelado` no admiten
transiciones. Las operaciones **solo leen** `tms_planes_viaje`; el estado operativo del viaje nunca cambia.

## Concurrencia

Toda transición toma, en este orden, `tms_planes_viaje … FOR UPDATE` (acotado por empresa; otra empresa = «no encontrado») y
`tms_viaje_liquidaciones … FOR UPDATE`; luego `UPDATE … WHERE version = ? AND estado = ?` verificando `affectedRows`. Es el mismo orden
(plan → liquidación) que usará el cierre en la Fase 5. Garantías finales: `UNIQUE (empresa_id, plan_id)` y `UNIQUE (empresa_id, plan_id,
version)`.

## Activación

`obtenerFechaActivacionLiquidacion(empresaId)` devuelve `YYYY-MM-DD` o `null` (sin fila, fecha NULL o **tablas aún no creadas** ⇒ `null`,
es decir, comportamiento actual intacto; cualquier otro error se propaga). `liquidacionExigidaParaPlan(activación, fechaPlan)` es
`fechaPlan >= activación` y **false** si falta cualquiera. `configurarFechaActivacionLiquidacion` es interna/auditada (sin endpoint): no
toca viajes ni liquidaciones. **Sin backfill**: fijar una fecha no crea ni marca nada.

## SQL (propuesto; NO ejecutado)

`sql/preflight-2026-10-tms-liquidacion-viajes-fase1.sql` (solo lectura) → `sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql` →
`sql/verify-2026-10-tms-liquidacion-viajes-fase1.sql`. Solo `CREATE TABLE IF NOT EXISTS` (NOOP estructural: no repara drift; preflight/verify
obligatorios). Sin ALTER, sin DROP, sin seeds, sin backfill. Requiere `uq_tmsplanes_empresa_id (empresa_id, id)` en `tms_planes_viaje` (ya
existe en producción según el preflight de cuadrilla). Reversión: las tres tablas quedan vacías tras migrar.

## Pendiente / riesgos

- La **no-modificación del historial** de eventos es contrato de aplicación (+ `RESTRICT` y `UNIQUE`); MariaDB sin triggers no impide un
  `UPDATE` manual. Lo protegen una prueba de arquitectura y el `verify` (invariantes a–c).
- `RESTRICT` sobre el viaje: una limpieza manual de `tms_planes_viaje` con liquidaciones fallará a propósito (hoy el código no borra planes).
- Los requisitos de negocio para LIQUIDADO (§4 de 0B) y el gate del cierre **no** existen aún; el estado LIQUIDADO de Fase 1 es solo de modelo.
- Los permisos (`viajes_confirmar_reporte`, `viajes_liquidar`, …) se propusieron en 0B y **no** se declararon ni concedieron.
