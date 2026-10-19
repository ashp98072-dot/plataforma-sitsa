# CxP M-3B1 — Pagos a proveedores y retención de ISR de facturas normales

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests unitarios + MariaDB 11.8.9 desechable local). **No probado con datos reales ni aprobado para producción.** Las migraciones **no fueron ejecutadas** en ninguna base real. Rama `feat/cxp-m3b1-pagos-isr`, base `main` `bf19db81`.

## Discovery (M-3A, antes de cambiar código)
| Tema | Hallazgo en M-3A |
|---|---|
| Tablas | `cxp_proveedor_fiscal` (PK `empresa_id, entidad_id, proveedor_id`) y `cxp_facturas` (UNIQUE `uq_cxpf_ambito (empresa_id, entidad_id, id)`; UNIQUE `uq_cxpf_documento (empresa_id, proveedor_id, serie_norm, numero_norm)`). `cont_cxp` es histórico y no se toca |
| Importes en la factura | `base_neto` (valor neto sin IVA), `iva_monto`, `total_documento = base + IVA`, `isr_porcentaje`, `isr_monto`, `total_neto_pagar = total − ISR`, todos `DECIMAL(14,2)` inmutables, con CHECK de coherencia. El servidor calcula; el cliente solo captura neto e IVA |
| Estados | Solo `estado_admin` (`REGISTRADA`/`ANULADA`). **No había saldo ni pagos**: `obtenerAplicado()` era un stub en 0.00 y `saldo.ts` exigía una "base" porque Contabilidad no había definido si el saldo era neto o total |
| Ámbito | Todo por `(empresa_id, entidad_id)` con FK compuestas; permisos propios `cxp_*` (ningún rol por defecto) |
| Reglas que **contradecían** las confirmaciones nuevas | (1) `BASE_BAJO_MINIMO` bloqueaba neto < Q2,800 (ahora: Q0.00); (2) `BASE_SOBRE_TRAMO` bloqueaba > Q29,999.00, incluido el hueco 29,999.01–29,999.99 y ≥ Q30,000 (ahora: 5 % hasta < Q30,000 y fijo + 7 % desde Q30,000); (3) el saldo no se exponía (ahora: base = monto pagadero); (4) la no-liberación del número de una anulada era "provisional" (ahora: confirmada) |
| Históricos | No se modifican. Las facturas con `regla_isr = M3A_V2:*` conservan su cálculo (el 5 % de M-3A coincide con la fórmula nueva en su rango, y por M-3A no pudo existir ninguna factura con neto < Q2,800 ni ≥ Q29,999.01) |

**Conclusión del discovery:** el modelo de M-3A (importes inmutables, ámbito por entidad, FK compuestas, anulación con motivo) **sí permite** agregar pagos de forma segura sin tocar `cxp_facturas`. No hubo necesidad de detenerse. Una sola decisión de negocio sigue abierta (redondeo, ver más abajo) y se **bloquea** en lugar de improvisarla.

## Retención de ISR — fórmula implementada (`isr-proveedor.ts`, regla `M3B1_V1`)
Solo para **factura normal** de proveedor sujeto a ISR. La base es **exclusivamente el valor neto sin IVA**.

| Valor neto | ISR | `regla_isr` | `isr_porcentaje` (tasa marginal) |
|---|---|---|---|
| `< Q2,800.00` | `Q0.00` | `M3B1_V1:BAJO_MINIMO_SIN_RETENCION` | 0.00 |
| `Q2,800.00 ≤ neto < Q30,000.00` | `5 % × neto` | `M3B1_V1:TRAMO_5_PCT` | 5.00 |
| `neto ≥ Q30,000.00` | `Q1,500.00 + 7 % × (neto − Q30,000.00)` | `M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE` | 7.00 |

* **Continuidad exacta en Q30,000.00:** 5 % × 30,000 = 1,500 = 1,500 + 7 % × 0, sin salto. Justo antes (Q29,999.99) el 5 % da Q1,499.9995.
* Ejemplo confirmado: total Q35,000, IVA Q3,750, neto Q31,250 → excedente Q1,250 → 7 % = Q87.50 → ISR **Q1,587.50** → monto pagadero **Q33,412.50** (cubierto en pruebas puras y contra MariaDB).
* Pequeño contribuyente y proveedor "no sujeto a ISR" siguen sin retención (regla ya confirmada en M-3A; no se agregó ninguna regla nueva).
* **No implementado y bloqueado/separado:** factura especial (422 `FACTURA_ESPECIAL_PENDIENTE`), retención de IVA (no existe en el código), cualquier otro impuesto.
* **Redondeo — PENDIENTE (bloquea):** Contabilidad confirmó "conservar los centavos"; no confirmó qué hacer con una **fracción menor a un centavo**. Resulta cuando el 5 % de un neto con centavos no es exacto (p. ej. Q2,800.10 → Q140.005; Q29,999.99 → Q1,499.9995) o el 7 % del excedente (exacto en centavos **solo si el excedente es de quetzales enteros**, porque 7 y 100 son coprimos). Estos casos se rechazan con 422 `REGLA_ISR_PENDIENTE` y no se escribe nada. `calcularIsrProveedor(entrada, modo)` acepta un modo de redondeo **explícito** (probado) para cuando se confirme; ningún flujo de producción lo pasa. Ver "Preguntas bloqueantes".

## Modelo de pagos (migración `2026-11-cxp-m3b1-pagos`, 2 tablas nuevas, sin ALTER)
* **`cxp_pagos`** — un pago pertenece a **un proveedor** y a **una entidad**: `fecha_pago`, `monto_total`, `medio_pago`, `referencia`, `observaciones`, `clave_idempotencia` (UNIQUE por empresa+entidad), `huella` (SHA-256 del contenido), `estado` (`REGISTRADO | REVERSADO`), creación y reversión (usuario, fecha, motivo). FK compuesta a `cxp_proveedor_fiscal`.
* **`cxp_pago_aplicaciones`** — `pago_id`, `factura_id`, `monto`; UNIQUE `(pago, factura)`; FK compuestas a `cxp_pagos` y a `cxp_facturas` por `(empresa_id, entidad_id, id)`: una aplicación **no puede cruzar entidad ni empresa**. `ON DELETE/UPDATE RESTRICT`: nada se borra.
* **Un pago → varias facturas** (hasta 50, todas del mismo proveedor) y **una factura → varios pagos**. El **total del pago es la suma de sus aplicaciones, calculada en el servidor** (el cuerpo nunca trae total, empresa, entidad, usuario ni estado). No hay "pago sin aplicar" (los anticipos quedan fuera de esta fase).
* **Sobreaplicación imposible:** en una transacción `READ COMMITTED` las facturas se bloquean `FOR UPDATE` en orden de id (sin interbloqueos entre pagos cruzados), el pagado vigente se lee bajo ese bloqueo y cada aplicación debe ser `≤ saldo`. Todo o nada. Probado con 4 pagos simultáneos por el saldo completo (solo uno entra) y con anulación en paralelo.
* **Idempotencia:** la UI genera una clave por formulario. El mismo envío repetido devuelve el pago original (200, `repetido: true`); la misma clave con otro contenido es 409; envíos simultáneos con la misma clave producen un solo pago.
* **Reversión/anulación con trazabilidad:** `reversarPago` pasa el pago **completo** a `REVERSADO` con usuario, fecha y motivo (la fila y sus aplicaciones se conservan); el saldo de sus facturas se recupera. No hay reversa parcial. Una factura con pagos vigentes **no se puede anular** (409 `TIENE_PAGOS`; primero se reversan) y una factura anulada **no admite pagos**. Su serie+número **sigue reservado** (confirmado).
* **Auditoría:** `cxp_registrar_pago` y `cxp_reversar_pago` (usuario, entidad, proveedor, aplicaciones, montos, motivo), en la misma transacción.
* **Permisos nuevos** (ningún rol por defecto): `cxp_pagos` (ver / registrar) y `cxp_reversar_pago`. Guard `requireTenantCxp`.
* **Endpoints** (`?entidad=` obligatorio y único): `GET/POST /contabilidad/cxp/pagos`, `GET /pagos/[id]`, `POST /pagos/[id]/reversar`. Las facturas (`GET /facturas`) ahora incluyen el desglose financiero.

## Cálculo del saldo (`saldo.ts`, derivado, nunca columna)
```
total factura (total_documento)   = valor neto + IVA
retención ISR (isr_monto)         = se RESTA del total; NO es un pago bancario ni una aplicación
monto pagadero (total_neto_pagar) = total − retención
pagado                            = suma de aplicaciones de pagos REGISTRADOS (los REVERSADOS no cuentan)
saldo                             = monto pagadero − pagado      (jamás negativo)
estado financiero                 = PENDIENTE (pagado 0) | PARCIAL | PAGADA (saldo 0) | ANULADA
```
Si las tablas de pagos aún no existen (migración sin aplicar), las **lecturas** de facturas devuelven pagado 0.00 (exacto, porque no puede haber pagos); las **escrituras** de pagos responden 503 `MIGRACION_PENDIENTE`.

## UI (Contabilidad → Cuentas por pagar)
* Registro de factura: desglose con **valor neto, IVA, total, retención ISR (con "Q1,500 + 7 % del excedente" cuando aplica), monto pagadero**.
* Tabla de facturas: valor neto, IVA, total, retención ISR, monto pagadero, pagado, **saldo** y situación. Vencimiento sigue manual.
* Pestaña **Pagos** (solo con permiso): historial, registro de un pago a varias facturas de un proveedor ("Pagar saldo" copia el saldo del servidor), reversión con motivo.
* El cliente **no calcula** ISR ni saldos; solo muestra lo que devuelve el servidor (más la suma de lo tecleado como ayuda visual).

## SQL propuesto (no ejecutado)
`sql/{preflight,migrate,postcheck,rollback}-2026-11-cxp-m3b1-pagos.sql` (generador `scripts/generar-sql-cxp-m3b1.py`, DDL fuente `scripts/cxp-m3b1-ddl.sql`).
* **Preflight** (solo lectura): `CLEAN | FINAL | DIVERGENTE` sobre **43 objetos** exactos (tablas, columnas, índices, CHECK, FK). Exige M-3A aplicada; sin ella es `DIVERGENTE`.
* **Migrate**: `CLEAN` → DDL; `FINAL` → `NOOP`; otro → `SIGNAL` **antes** de cualquier DDL; reaudita `FINAL` y verifica conteos de M-3A idénticos. Solo `CREATE TABLE` de tablas nuevas: sin ALTER, sin DML, sin backfill (los saldos de facturas históricas se derivan).
* **Postcheck**: `FINAL` + integridad lógica con `SIGNAL`: pago = suma de aplicaciones, mismo proveedor pago/factura, sin pagos vigentes sobre facturas anuladas, sin sobreaplicación, y **ISR de cada factura `M3B1_V1` dentro de su tramo** (nota: el postcheck de M-3A solo conoce el 5 % y marcaría como error una factura del tramo alto; después de M-3B1 usar este postcheck).
* **Rollback**: solo desde `FINAL` y **solo con ambas tablas vacías**; con cualquier pago (aunque reversado) se detiene. Estrategia de recuperación con datos: respaldo previo → reversar desde la aplicación (traza) → conservar las tablas o, con autorización expresa, restaurar el respaldo.

## Pruebas
Puras (`cxp-puro`, `pagos-puro`, `cxp-http`, `cxp-ui`) y contra MariaDB 11.8.9 desechable (`cxp-m3b1.db`, `cxp-m3b1-rollout.db`, y `cxp-m3a*.db` actualizadas): `LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp --no-file-parallelism`. Cubren: Q2,799.99 → Q0; Q2,800.00 → 5 %; Q29,999.99 (tramo 5 %, fracción de centavo bloqueada); Q30,000.00 (continuidad); Q31,250 → Q1,587.50; centavos; pagos parciales y múltiples; un pago a varias facturas; reversión/anulación; serie+número no reutilizable tras anular; multiempresa/entidad; permisos; concurrencia; idempotencia; migración (CLEAN/FINAL/DIVERGENTE/NOOP/rollback/postcheck).

## Preguntas todavía bloqueantes (para Contabilidad)
1. **Redondeo de fracciones de centavo del ISR** (ver arriba). Hasta responderlo, un neto con centavos cuyo 5 % no sea exacto (y casi todo neto ≥ Q30,000 con centavos) se rechaza. Se necesita: modo (mitad arriba / truncar / etc.) y si aplica por factura.
2. ¿Un pago puede ir a facturas de **varios proveedores**? (hoy: un solo proveedor por pago).
3. ¿Se requiere **reversa parcial** o basta reversar el pago completo?
4. ¿Hay **anticipos** (pago sin factura) en la siguiente fase?
5. Factura especial, retención de IVA y pequeño contribuyente "con regla propia": siguen fuera de alcance.
6. Cuenta bancaria / medio de pago: hoy son texto libre (medio y referencia); no hay catálogo de bancos ni pólizas.
7. (Heredada de M-3A) Acceso por entidad: `cont_entidad_usuarios` existe pero ningún código lo aplica.
