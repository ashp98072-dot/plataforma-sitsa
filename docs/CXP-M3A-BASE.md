# CxP M-3A — Base de Cuentas por Pagar (proveedores + facturas de proveedor)

> **Actualización M-3B1:** varias reglas "PENDIENTE" de este documento quedaron resueltas por Contabilidad y están implementadas en [CXP-M3B1-PAGOS-ISR.md](CXP-M3B1-PAGOS-ISR.md): neto < Q2,800 → ISR Q0; 5 % hasta < Q30,000; Q1,500 + 7 % del excedente desde Q30,000; saldo = monto pagadero (total − retención) − pagos; una factura anulada NO libera su serie+número. Siguen pendientes: redondeo de fracciones de centavo, factura especial y retención de IVA. Lo que dice abajo sobre esas reglas es el estado de M-3A (histórico).

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests unitarios + MariaDB 11.8.9 desechable). **No probado con datos reales ni aprobado para producción.** La migración **no fue ejecutada** en ninguna base real.

## Principio de esta fase
M-3A **no persiste decisiones contables que Contabilidad no haya confirmado**. Lo no confirmado se **bloquea** (422, sin escribir nada) o se deja **explícitamente provisional y reversible**.

## Alcance
Maestro fiscal/contable del proveedor, factura de proveedor estructurada y arquitectura lista para pagos. **No** incluye: ISR desde Q30,000, factura especial, pagos/aplicaciones, anticipos, notas de crédito, pólizas, FEL, ni cambios sobre `cont_cxp`, CxC (`fact_*`) o clientes. **No expone saldo.**

## Reglas confirmadas y su tratamiento

| Regla | Estado | Qué hace M-3A |
|---|---|---|
| Sujeto a ISR, base Q2,800.00–Q29,999.00 → 5 % sobre el valor neto | CONFIRMADA | Se calcula **solo si el importe es exacto en centavos** |
| Pequeño contribuyente → no se retiene | CONFIRMADA | ISR 0 en cualquier monto |
| Proveedor marcado «no sujeto a ISR» (config explícita) | Configuración | ISR 0 |
| Sin retención de IVA en factura normal de proveedor | CONFIRMADA | No se calcula IVA retenido |
| Base < Q2,800.00 (sujeto a ISR) | **PENDIENTE** | **BLOQUEA** (`BASE_BAJO_MINIMO`). No se asume «sin retención» |
| Redondeo del ISR (5 % con fracción de centavo, p. ej. Q2,800.10 → Q140.005) | **PENDIENTE** | **BLOQUEA** (`REDONDEO`). Ninguna modalidad (ni mitad arriba/abajo ni truncar) queda codificada; hay test que lo verifica |
| Base > Q29,999.00 (incluye 29,999.01–29,999.99 y «desde Q30,000.00 → 7 %») | **PENDIENTE** | **BLOQUEA** (`BASE_SOBRE_TRAMO`) |
| Factura especial | **PENDIENTE** | **BLOQUEA** (`FACTURA_ESPECIAL_PENDIENTE`) |
| Base del saldo (neto a pagar vs total con la retención como aplicación) | **PENDIENTE** | **No se expone saldo** (ver abajo) |
| ¿Se divide una factura entre entidades? | **PENDIENTE** | UNIQUE restrictivo **provisional** (ver abajo) |
| ¿Una factura anulada libera su número? | **PENDIENTE** | **No lo libera** (provisional, ver abajo) |

La regla de ISR está versionada (`M3A_V2`) y cada factura guarda con qué regla se calculó. Cuando Contabilidad responda se cambia `isr-proveedor.ts` y se levanta el bloqueo; las facturas existentes conservan su regla.

## Modelo (2 tablas nuevas, ámbito `(empresa_id, entidad_id, …)`)
**`cxp_proveedor_fiscal`** — PK `(empresa_id, entidad_id, proveedor_id)`; reutiliza `compras_proveedores` (FK `(empresa_id, proveedor_id)`). `regimen_fiscal` (`GENERAL|PEQUENO_CONTRIBUYENTE`), `sujeto_isr`, `cuenta_proveedor_id` (Pasivo), `cuenta_anticipo_id` (Activo), `cuenta_gasto_id` (Gasto), `activo`, auditoría. CHECK: pequeño contribuyente ⇒ `sujeto_isr = 0`.

**`cxp_facturas`** — ámbito + `proveedor_id` con FK compuesta a la configuración fiscal. `tipo_documento`, `serie`/`numero` (+ normalizados), fechas, `base_neto`, `iva_monto`, `total_documento`, `isr_porcentaje`, `isr_monto`, `total_neto_pagar`, `regla_isr`, fotografía del régimen, `estado_admin` (`REGISTRADA|ANULADA`), anulación (usuario/fecha/motivo). CHECKs de coherencia (total = base + IVA, neto = total − ISR, ISR solo si el snapshot es sujeto, etc.).

### Saldo: no se cierra
No hay columna `saldo` y **la API/UI de M-3A no muestran saldo ni estado PENDIENTE/PARCIAL/PAGADA**. La factura conserva los tres importes inmutables (`total_documento`, `isr_monto`, `total_neto_pagar`), de modo que **cualquiera** de las dos bases posibles se deriva sin migrar datos. `saldo.ts` (puro, no conectado) exige la base como parámetro explícito y tiene tests para ambas. `total_neto_pagar` se conserva como importe informativo («lo que se paga al proveedor»), no como definición de saldo. El módulo de pagos fijará la base con la respuesta de Contabilidad; `obtenerAplicado()` es el punto de extensión (hoy 0 y solo lo usa la anulación, que ya rechaza facturas con pagos).

### Anti-duplicado (provisional, restrictivo)
`UNIQUE (empresa_id, proveedor_id, serie_norm, numero_norm)` — **sin `entidad_id` y sin distinguir estado**.
- Consecuencias: (1) la misma factura de un proveedor no puede registrarse en dos entidades de la misma empresa (bloquea una división entre entidades); (2) una factura **anulada mantiene reservado su número**: si se capturó mal, no se puede volver a registrar con ese mismo número (se necesitará una función de corrección/edición o la decisión de Contabilidad).
- Por qué es la opción segura: **relajar** una UNIQUE después (agregar `entidad_id` o liberar anuladas) es un cambio de índice sin pérdida de datos ni conflictos; **endurecerla** con duplicados ya guardados no sería posible sin limpiar datos. Si Contabilidad confirma otra regla, es una migración chica y reversible.
- Mensajes: si el existente está anulada, el error lo dice y remite a Contabilidad.
- Normalización idéntica a Compras (ceros y guiones significativos).

## Permisos (propios, ningún rol por defecto; Admin pasa)
Filas dentro de «Contabilidad»: `cxp_facturas` (ver / editar = registrar), `cxp_anular` (editar), `cxp_proveedor_fiscal` (ver / editar). Guard `requireTenantCxp` sin fallback a `contabilidad:editar`. Exige el módulo Contabilidad de la empresa.

## Flujo
1. Compras mantiene el proveedor comercial. 2. Contabilidad lo configura **por entidad** (`PUT …/contabilidad/cxp/proveedores/[id]/fiscal?entidad=`). 3. Se registra la factura (`POST …/cxp/facturas?entidad=`; `…/facturas/preview` calcula sin guardar). El servidor calcula total, ISR y neto; el cuerpo solo trae datos del documento. 4. Consulta y anulación con motivo. 5. UI: Contabilidad → Cuentas por pagar. Todo auditado (`cxp_*`).

## SQL propuesto (no ejecutado)
`sql/{preflight,migrate,postcheck}-2026-11-cxp-m3a-base.sql` (generador `scripts/generar-sql-cxp-m3a.py`, DDL fuente `scripts/cxp-m3a-ddl.sql`). Auditoría contractual exacta de **74 objetos** con `CLEAN | FINAL | DIVERGENTE`; solo tablas nuevas; migrate: CLEAN → DDL, FINAL → NOOP, otro → SIGNAL antes de DDL, reauditoría FINAL y conteos de tablas existentes idénticos. Postcheck: FINAL + SIGNAL si hay cuentas de tipo incorrecto o un ISR que no sea exactamente `base × porcentaje` (sin `ROUND`).

## Pendientes por confirmar con Contabilidad
1. Tratamiento de una base menor a Q2,800.00 para un sujeto de ISR (Milenium usa Q2,500 en Mónaco/KT).
2. Regla de redondeo del ISR.
3. Fórmula desde Q30,000.00 y el tramo 29,999.01–29,999.99.
4. Factura especial.
5. Base del saldo (neto vs total con la retención como aplicación).
6. ¿Una factura se divide/registra entre entidades? (define si la UNIQUE lleva `entidad_id`).
7. ¿La anulada libera su número? ¿Habrá edición/corrección en lugar de anular y recapturar?
8. ¿IVA obligatorio al 12 %? Hoy solo advierte.
9. Vencimiento por defecto desde los días de crédito del proveedor (hoy manual y opcional).
10. Acceso por entidad: `cont_entidad_usuarios` existe pero ningún código lo aplica.
