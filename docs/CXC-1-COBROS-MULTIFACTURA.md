# CxC-1 — Cobro multi-factura + anulación de cobro

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests contra MariaDB 11.8.9 local con la migración real). No probado manualmente en navegador, no aprobado para producción.
**Requiere migración** (propuesta, NO ejecutada): `sql/migrate-2026-10-cxc-cobros-multifactura.sql` (+ `preflight-…` y `postcheck-…`).
Origen: discovery `docs/MILENIUM-CXC-DISCOVERY-VS-PLATAFORMA.md` (A1 cobro a varias facturas, A2 anulación de cobro).

## Decisiones aprobadas
1. Modelo **cabecera de cobro + aplicaciones** (`fact_cobros` + `fact_cobro_aplicaciones`). `fact_pagos` no se extiende ni se migra.
2. Un cobro con **confirmación bancaria activa vinculada** no se puede anular; la confirmación NO se anula en cascada.

## Modelo
| Tabla | Contenido |
|---|---|
| `fact_cobros` | empresa, **entidad**, **cliente**, moneda, fecha, `monto_total` (= Σ aplicaciones, calculado por el servidor), medio, referencia, observaciones, clave de idempotencia + huella, `estado` VIGENTE/ANULADO, quién/cuándo creó, quién/cuándo/**motivo** anuló. |
| `fact_cobro_aplicaciones` | cobro, factura, monto (> 0). UNIQUE (cobro, factura). FK compuesta al cobro; FK a la factura. |
| `fact_pago_confirmaciones.cobro_id` | columna NULL nueva: vínculo opcional de una confirmación bancaria con un cobro. |

Un cobro anulado **no se borra**: conserva cabecera y aplicaciones y solo cambia de estado. Nada hace DELETE de estas tablas.

## Reglas (todas en UNA transacción, facturas bloqueadas `FOR UPDATE` por id)
* Misma **empresa** (la de la sesión), misma **entidad** (la del libro; la factura debe tener entidad = la del cobro), mismo **cliente** (todas las facturas del cliente del cobro), facturas **Emitida**, misma moneda.
* Una o muchas facturas, aplicaciones parciales, una aplicación por factura por cobro; `monto_total` = Σ aplicaciones.
* **Sin sobreaplicación**: el cobrado vigente se lee bajo el bloqueo y cada aplicación ≤ saldo (aritmética `Decimal`, montos como texto).
* **Idempotencia**: clave por (empresa, entidad); mismo contenido → devuelve el cobro original (200); otro contenido → 409 `CLAVE_REUTILIZADA`; la carrera de dos envíos idénticos se resuelve como repetido.
* **Anulación**: motivo obligatorio (≥ 3 caracteres), cobro completo (no parcial), 409 si ya está anulado, 409 `CONFIRMACION_ACTIVA` si tiene confirmación bancaria activa. Orden de bloqueo: facturas → cobro → confirmaciones (igual que la confirmación bancaria; sin interbloqueos).
* **No** genera póliza, retención, notas de crédito ni anticipos.

## Convivencia con `fact_pagos` (estrategia de transición — sin duplicar saldos)
* **Una sola definición de «cobrado»**: `SQL_COBRADO` (`src/lib/facturacion/cobrado.ts`) = pagos legados (`fact_pagos`) + aplicaciones de cobros VIGENTES. Reemplaza `SUM(fact_pagos)` en: listado/KPIs/detalle de Facturación, `registrarPago`, anulación de factura, la CxC informativa (M-2a, Facturación y Contabilidad) y los KPI de cobro de los reportes de viajes TMS.
* **Cada dinero entra por un solo camino**: o `fact_pagos` (flujo legado de Facturación y el «Cobrar» de una factura) o `fact_cobros` (cobro nuevo). **Nada se copia ni se migra**: los pagos históricos siguen valiendo tal cual (un pago = una factura) y no se reinterpretan como cobros.
* `registrarPago` legado ahora resta también lo aplicado por cobros vigentes (y compara con `Decimal`): no se puede sobreaplicar mezclando caminos.
* Una factura con aplicaciones de un cobro VIGENTE no se puede anular; si el cobro se anula, sí.
* El detalle de la factura lista las aplicaciones vigentes junto con sus pagos (fila «Cobro múltiple #N»), para que el listado cuadre con el total pagado.
* Un cobro anulado deja de contar en todas esas lecturas.
* Cuándo retirar el flujo legado: decisión posterior (no en este PR).

## Auditoría
* Por **cada factura afectada**, evento de bitácora (`registrar_cobro_multiple` / `anular_cobro_multiple`) con actor, entidad, monto, medio, referencia, **saldo antes→después** y número de cobro (aparece en la bitácora de la factura y en la de CxC).
* Un resumen por cobro en `auditoria` (módulo contabilidad): `cxc_registrar_cobro` / `cxc_anular_cobro` con cobro, cliente, total, **facturas y montos**, usuario y **motivo**.
* Todo dentro de la misma transacción que el movimiento.

## Permisos
Ver historial = `cxc_cuentas:ver` · registrar = `cxc_cobros:editar` · anular = **`cxc_anular_cobro:editar`** (fila nueva, requiere `cxc_ver`, ningún rol la trae por defecto; Admin por catálogo). El cuerpo no puede traer empresa, entidad, usuario, totales ni estado (esquema estricto).

## Superficie
* `GET|POST /api/empresas/[slug]/contabilidad/cxc/cobros-aplicados?entidad=` · `POST …/[id]/anular?entidad=` · `GET …/clientes?entidad=` · `GET …/facturas?entidad=&clienteId=`.
* UI: Contabilidad → Cuentas por cobrar → **Cobros a varias facturas** (cliente → facturas pendientes con total, pagado/aplicado, saldo y monto a aplicar; total del cobro; historial con aplicaciones; Anular con motivo; la anulación se desactiva con la confirmación activa).
* Confirmaciones bancarias: la API acepta `cobroId` (excluyente con `pagoId`) y el panel lista los cobros vigentes de la factura como opción de vínculo.

## Despliegue (orden obligatorio)
1. `preflight` (resultado APLICAR) → 2. `migrate` → 3. `postcheck` (todos los controles en 0 filas) → 4. desplegar el código.
**Desplegar antes de migrar rompe las lecturas de saldos** (`SQL_COBRADO` referencia las tablas nuevas). Sin la migración, el módulo responde `MIGRACION_PENDIENTE` (503) en las rutas de cobros.

## Limitaciones / pendientes (no inventados)
* Solo facturas con **entidad** (las históricas sin entidad siguen en el flujo legado).
* Sin reversa **parcial** de un cobro, sin retención real, notas de crédito, anticipos, saldo a favor ni pólizas (fases posteriores; ver discovery).
* La unicidad «misma empresa/entidad/cliente entre cobro y factura» la garantiza el servicio dentro de la transacción (no hay clave compuesta en `fact_facturas`); `postcheck` la verifica.
* Los pagos legados no se pueden anular (no existe reverso de `fact_pagos`); solo los cobros nuevos.
* Rendimiento: `SQL_COBRADO` es una unión de dos agregados por empresa; índice compuesto sugerido para `fact_pagos (empresa_id, factura_id)` queda documentado en M-2a (no aplicado).
