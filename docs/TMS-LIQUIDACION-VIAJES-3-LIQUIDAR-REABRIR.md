# TMS — Liquidación de viajes · FASE 3: liquidar, liquidar nuevamente y reabrir (con snapshot operativo)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (compilación, ESLint, pruebas unitarias/arquitectura/endpoints y pruebas de BD y
concurrencia contra MariaDB 11.8.9 desechable). **NO probado en producción ni aprobado para producción.** **Sin SQL nuevo**: usa las tablas de
Fase 1 (`snapshot_json` y `detalle` del evento). Continúa [Fase 1](TMS-LIQUIDACION-VIAJES-1-MODELO.md) y
[Fase 2](TMS-LIQUIDACION-VIAJES-2-REPORTE-RECIBIDO.md).

## Alcance

| Incluye | NO incluye |
|---|---|
| `POST …/planes/[id]/liquidar` y `POST …/planes/[id]/reabrir-liquidacion`; `GET …/planes/[id]/liquidacion` (historial + vista previa) | Cargos adicionales (Fase 4) |
| Permisos `viajes_liquidar` y `viajes_reabrir_liquidacion` | **Gate / cambio del cierre (Fase 5)**: cierre normal, manual, masivo y por período intactos |
| Snapshot operativo inmutable en el evento LIQUIDADO/RELIQUIDADO | Cuadres, facturación, fondos/gastos, viáticos, FEL, contabilidad |
| Modales «Liquidar viaje / Liquidar nuevamente» y «Reabrir liquidación» + historial en el detalle del viaje | Fecha de activación, «cuadrilla real» separada, reportes históricos |

## Reglas exactas de transición

| Operación | Desde | Hacia | Evento | Versión |
|---|---|---|---|---|
| Liquidar | `REPORTE_RECIBIDO` | `LIQUIDADO` | `LIQUIDADO` | +1 |
| Liquidar nuevamente | `EN_AJUSTE` | `LIQUIDADO` | `RELIQUIDADO` | +1 |
| Reabrir (motivo ≥ 5, ≤ 500) | `LIQUIDADO` | `EN_AJUSTE` | `REABIERTO` | +1 |

- **Nunca** se liquida sin liquidación previa (sin fila ⇒ 404 «no tiene un reporte recibido»), ni desde `LIQUIDADO` sin reabrir (409).
- `Cerrado`/`Cancelado` no admiten ninguna transición (409). Otra empresa ⇒ 404.
- `expectedVersion` (entero ≥ 1) es **obligatorio**; una versión vieja es 409 `CONFLICTO_VERSION`.
- Réplica segura solo donde el dominio ya la define: mismo actor y `versión = esperada + 1` (200 `idempotente: true`, sin evento nuevo).
- Orden de locks: plan `FOR UPDATE` → liquidación `FOR UPDATE` → `UPDATE … WHERE version = ? AND estado = ?` → un evento por versión
  (`UNIQUE (empresa, plan, version)`). Todo en una transacción; el snapshot se lee **dentro** de ella, bajo el lock del plan.
- Liquidar **no** cierra, **no** factura, **no** crea cargos y **no** mueve fondos/gastos; **no** modifica Programación.

## Contenido exacto del snapshot (`snapshot_json` del evento LIQUIDADO / RELIQUIDADO)

Evidencia histórica: se escribe una vez y no se actualiza. Además de las tres claves mínimas de Fase 1 (`planEstado`, `fechaPlan`, `tarifaComercial`):

`operativo` (versión 1):

| Bloque | Campos | Fuente |
|---|---|---|
| `plan` | `id`, `codigo`, `fechaPlan`, `estado`, `tipoViaje`, `referenciaCliente` | `tms_planes_viaje` |
| `cliente` | `id`, `nombre` | `tms_clientes` (misma empresa) |
| `ruta` | `codigo` (histórico), `origen`, `destino` (descarga histórica o catálogo) | `tms_planes_viaje`, `tms_lugares` |
| `tarifa` | `comercial`, `tarifaId`, `nombre`, `montoCatalogo`, `moneda` (snapshots del plan) | `tms_planes_viaje` |
| `unidad` | `id`, `placa` (o placa externa si es tercerizado) | `tms_unidades` |
| `tc` | `placa`, `origen` (INTERNO/EXTERNO) | `flota_vehiculos` / snapshots del plan |
| `piloto`, `pilotosExtra` | `personalId`, `nombre` | `tms_personal`, `tms_plan_pilotos_adicionales` |
| `auxiliares` | `personalId`, `nombre` (tabla de varios auxiliares; si no hay filas, el auxiliar legado) | `tms_plan_auxiliares` |
| `cuadrilla` | `tipo`, `empleadoId`, `nombre` — **sin identificación ni teléfono** | `tms_plan_cuadrilla` |
| `tercerizado` | `pilotoExterno`, `auxiliaresExternos`, `unidadExternaPlaca`, `unidadExternaDescripcion`, `transportistaExterno` (solo si `tipo_viaje = Tercerizado`) | `tms_planes_viaje` |
| `viajeFisico` | `estado`, `kmSalida`, `kmLlegada`, `kmRecorridos`, `horaSalida`, `horaLlegada` (último registro del piloto; `null` si no hay) | `flota_viajes` |
| `noDisponible` | lista de conceptos que no existen físicamente (ver abajo) | — |

`liquidacion`: `version`, `transicion` (`LIQUIDADO`/`RELIQUIDADO`), `estadoAntes`, `liquidadoPor` (id), `liquidadoPorUsuario`, `reporteRecibidoEn`,
`reporteRecibidoPor`, `reaperturaPrevia` (`version`, `actorId`, `motivo`, `creadoEn` del último `REABIERTO`; solo en RELIQUIDADO). El motivo de la
reapertura **también** permanece en el evento `REABIERTO`.

### Datos que NO se incluyeron y por qué

| Concepto | Motivo |
|---|---|
| Costos reales (combustible, viáticos, gastos), `costo_operativo_referencia`, `costo_tercerizado` | Son costos: pertenecen a otros módulos y a fases de cuadre; esta fase **no** crea costos |
| Cargos adicionales | Fase 4 |
| Incidencias estructuradas | No existen en el modelo (solo notas y evidencias) |
| «Cuadrilla real» distinta de la registrada | No existe: el snapshot guarda la cuadrilla **registrada en el viaje al liquidar** (puede reflejar ediciones de Programación) |
| Kilometraje confirmado por Operaciones | No existe: solo el registrado por el piloto en Flota |
| Identificación/teléfono de cuadrilla externa | Datos sensibles innecesarios para reconstruir la operación |
| Conteo/archivos de evidencias | No requerido; las evidencias siguen en su módulo |

## Permisos

`viajes_liquidar` («Viajes: liquidar») y `viajes_reabrir_liquidacion` («Viajes: reabrir liquidación»): filas propias en el módulo `programacion`,
`puedeEditar` = puede actuar, ≤ 40 caracteres (`usuario_modulo.modulo`), **ningún rol las trae por defecto** (Admin las recibe como todo el catálogo).
Separadas entre sí y de `viajes_confirmar_reporte` y `viajes_cerrar` (prueba de no-escalamiento). Guards `requireTenantViajesLiquidar` /
`requireTenantViajesReabrirLiquidacion` (exigen el módulo TMS de la empresa).

## UI (Planes/Viajes, vista operativa)

| Estado | Acción ofrecida (con su permiso) |
|---|---|
| Sin liquidación | «Confirmar reporte» (Fase 2); **no** «Liquidar» |
| `REPORTE_RECIBIDO` | «Liquidar viaje» |
| `EN_AJUSTE` | «Liquidar nuevamente» |
| `LIQUIDADO` | «Reabrir liquidación» |
| `Cerrado`/`Cancelado` o vista de reportes | ninguna |

- **Modal de liquidación**: resumen de lo que se congelará (viaje, cliente, ruta, unidad/placa, TC, piloto/extra, auxiliares, cuadrilla, tarifa
  base, registro del piloto, reporte recibido) leído de `GET …/liquidacion`; observación opcional; aviso explícito de que **no** cierra, **no**
  factura, **no** crea cargos y **no** mueve fondos/gastos; envía `expectedVersion`; un solo envío en vuelo (doble clic).
- **Modal de reapertura**: motivo obligatorio (≥ 5); explica que vuelve a «En ajuste», que la liquidación anterior permanece en el historial y que
  deberá liquidarse de nuevo.
- **Historial**: tabla (versión, evento, antes→después, usuario, fecha, detalle/motivo) en el detalle expandible del viaje.
- La semántica visual vigente (PR #458) **no cambia**: amarillo = sin reporte confirmado o en ajuste (requiere acción pendiente); fondo normal =
  reporte recibido, liquidado o histórico cerrado/cancelado sin liquidación («—»).

## Riesgos / pendientes

- **Vista previa vs. snapshot final**: la vista previa se lee sin lock; el snapshot definitivo se lee dentro de la transacción. Si Programación cambia entre
  ambos, el evento guarda lo vigente al liquidar (la versión protege solo cambios de la liquidación, no de Programación).
- **Usuario en el historial**: se muestra el id del actor (`#id`); el nombre visible llegará con una pantalla de historial dedicada (el snapshot ya
  guarda `liquidadoPorUsuario` en liquidaciones).
- La liquidación **no** exige requisitos de negocio adicionales (tarifa, km, cuadrilla): el snapshot registra lo que existe y lista lo que no.
  Los requisitos «obligatorios/advertencias» de 0B §4 quedan para el gate del cierre / fases posteriores.
- Sin revisión visual en navegador con datos reales.
