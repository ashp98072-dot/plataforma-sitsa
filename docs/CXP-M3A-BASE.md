# CxP M-3A — Base de Cuentas por Pagar (proveedores + facturas de proveedor)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests unitarios + MariaDB 11.8.9 desechable). **No probado con datos reales ni aprobado para producción.** La migración **no fue ejecutada** en ninguna base real.

## Alcance
Solo M-3A: maestro fiscal/contable del proveedor, factura de proveedor estructurada, saldo derivado y arquitectura lista para pagos. **No** incluye: fórmula de ISR desde Q30,000, pagos/aplicaciones, anticipos, notas de crédito, pólizas, FEL, factura especial, ni cambios sobre `cont_cxp`, CxC (`fact_*`) o clientes.

## Reglas de negocio confirmadas (Contabilidad)
- Proveedores: la retención aplicable es **ISR**; la empresa **no retiene IVA** en factura normal de proveedor.
- Pequeño contribuyente: **no se retiene**.
- Sujeto a ISR: **Q2,800.00–Q29,999.00 → 5 % sobre el valor neto** (base sin IVA).
- Una factura puede pagarse parcial/total; un pago puede aplicarse a varias facturas del proveedor; el excedente va a *Anticipo a proveedores locales*; pagada = saldo en cero; la nota de crédito reduce la cuenta del proveedor. **(Todo esto es de fases posteriores; el modelo lo prevé.)**

## Reglas NO codificadas (se rechaza, no se aproxima)
- Base > Q29,999.00 para un sujeto de ISR (incluye el hueco 29,999.01–29,999.99 y «desde Q30,000.00 → 7 %»): `ReglaIsrPendiente` → **422**, no se escribe nada.
- Factura especial (IVA e ISR sobre la base del pago): **422** hasta tener reglas.
- Base < Q2,800.00 → «sin retención» (interpretación; por confirmar).

## Modelo (2 tablas nuevas, ámbito `(empresa_id, entidad_id, …)`)
**`cxp_proveedor_fiscal`** — PK `(empresa_id, entidad_id, proveedor_id)`. Reutiliza `compras_proveedores` (FK `(empresa_id, proveedor_id)`), sin duplicar proveedores.
`regimen_fiscal` (`GENERAL|PEQUENO_CONTRIBUYENTE`), `sujeto_isr`, `cuenta_proveedor_id` (Pasivo), `cuenta_anticipo_id` (Activo), `cuenta_gasto_id` (Gasto), `activo`, auditoría de usuario/fecha. CHECK: pequeño contribuyente ⇒ `sujeto_isr = 0`. Las cuentas son FK de ámbito a `cont_cuentas` y el tipo se valida en el servidor.

**`cxp_facturas`** — `id`; ámbito + `proveedor_id` con **FK compuesta a la configuración fiscal** (no se puede facturar a un proveedor sin configurar para esa entidad). `tipo_documento`, `serie`/`numero` (+ `serie_norm`/`numero_norm`), `fecha_documento`, `fecha_vencimiento`, `base_neto`, `iva_monto`, `total_documento`, `isr_porcentaje`, `isr_monto`, `total_neto_pagar`, `regla_isr`, **fotografía** `regimen_fiscal_snapshot`/`sujeto_isr_snapshot`, `estado_admin`, anulación (usuario/fecha/motivo), `creado_*`.
CHECKs: total = base + IVA; neto = total − ISR; ISR solo si el snapshot es sujeto; pequeño ⇒ sin ISR; vencimiento ≥ fecha; coherencia de anulación.

### Anti-duplicado
`UNIQUE (empresa_id, proveedor_id, serie_norm, numero_norm, clave_activa)` con `clave_activa` = columna generada (1 si `REGISTRADA`, NULL si `ANULADA`): MariaDB no tiene UNIQUE parcial y los NULL no chocan, así que **una anulada libera la clave** y puede registrarse de nuevo. **No incluye `entidad_id` a propósito**: la misma factura de un proveedor no puede registrarse en dos entidades de la misma empresa (un documento fiscal tiene un solo receptor). Misma normalización que Compras (ceros y guiones significativos).

### Saldo y estados (sin columna `saldo`)
- Se persiste solo el estado **administrativo**: `REGISTRADA | ANULADA`.
- `saldo = total_neto_pagar − Σ aplicaciones vigentes` y el estado financiero `PENDIENTE | PARCIAL | PAGADA | ANULADA` se **derivan**. En M-3A no hay pagos: `obtenerAplicado()` devuelve 0 y es el **único punto** que cambiará cuando exista el módulo de pagos (anular ya lo consulta y rechazará facturas con pagos).
- Justificación: PARCIAL/PAGADA dependen de pagos que pueden anularse o reversarse; guardarlos obligaría a sincronizarlos a mano.
- **Pendiente de Contabilidad:** si la base del saldo es el *neto a pagar* (implementado) o el *total del documento* con la retención como aplicación.

## Permisos (propios, ningún rol por defecto; Admin pasa)
Filas dentro de «Contabilidad»: `cxp_facturas` (ver / editar = registrar), `cxp_anular` (editar), `cxp_proveedor_fiscal` (ver / editar). Guard `requireTenantCxp` sin fallback a `contabilidad:editar`. Exige el módulo Contabilidad de la empresa.

## Flujo
1. Compras mantiene el proveedor comercial.
2. Contabilidad configura el proveedor **por entidad** (régimen, ISR, cuentas) — `PUT …/contabilidad/cxp/proveedores/[id]/fiscal?entidad=`.
3. Registra la factura — `POST …/cxp/facturas?entidad=` (`…/facturas/preview` calcula sin guardar). El **servidor** calcula total, ISR (regla versionada `M3A_V1`) y neto; el cuerpo solo trae datos del documento.
4. Consulta `GET …/cxp/facturas`; anula con motivo `POST …/facturas/[id]/anular`.
5. UI: Contabilidad → Cuentas por pagar. Todo auditado (`cxp_*`).

## SQL propuesto (no ejecutado)
`sql/{preflight,migrate,postcheck}-2026-11-cxp-m3a-base.sql`, generados por `scripts/generar-sql-cxp-m3a.py` (DDL fuente: `scripts/cxp-m3a-ddl.sql`). Auditoría contractual exacta de **75 objetos** (2 tablas, columnas, índices, CHECK, FK RESTRICT) con `CLEAN | FINAL | DIVERGENTE`; solo tablas **nuevas**; migrate: CLEAN → DDL, FINAL → NOOP, otro → SIGNAL antes de DDL, reauditoría FINAL y conteos de tablas existentes idénticos. Postcheck: FINAL + SIGNAL si hay cuentas de tipo incorrecto o ISR incoherente.

## Pendientes por confirmar con Contabilidad
1. Fórmula de ISR desde Q30,000.00 (y el tramo 29,999.01–29,999.99).
2. ¿El umbral de Q2,800 aplica a la base sin IVA? (Milenium usa Q2,500 en Mónaco/KT.) ¿Y qué ocurre bajo el mínimo?
3. Redondeo del ISR (se usa mitad hacia arriba a 2 decimales).
4. Factura especial: IVA/ISR sobre la base del pago.
5. Base del saldo (neto vs total) y tratamiento de la retención en el pago.
6. ¿IVA obligatorio en 12 % o puede variar (pequeño contribuyente, exentos)? Hoy solo advierte.
7. Vencimiento por defecto desde `dias_credito` del proveedor (hoy es opcional y manual).
8. ¿Una misma factura puede dividirse entre entidades? Hoy no.
9. Acceso por entidad: `cont_entidad_usuarios` existe pero ningún código lo aplica; hoy el alcance es el permiso de módulo.
