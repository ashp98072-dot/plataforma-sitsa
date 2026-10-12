# Diseño — pago confirmado, retención esperada/verificada, porcentaje configurable y reverso contable

> **Fase de DISEÑO.** No implementa pólizas reales, no migra, no ejecuta SQL, no modifica FACT-4 ni producción. Los fragmentos de DDL son **propuestas ilustrativas** (no están en `sql/`, no se ejecutan).
> **Base:** respuestas directas de Contabilidad (2026-10-12, resumen en `docs/CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO.md` §14) y `main` = `c67a9141`.
> **Certeza:** `[CONFIRMADO]` (Contabilidad) · `[DISEÑO]` (propuesta técnica a revisar) · `[PENDIENTE CONTABILIDAD]`.
> **Regla del proyecto:** un motor común; las diferencias entre Mónaco y KT son **datos por entidad** (cuentas por rol, bancos, plantilla). Nada de `if MONACO` / `if KT`.

## 0. Resumen

| Tema | Decisión de Contabilidad | Qué falta en la plataforma | Fase propuesta |
|---|---|---|---|
| Contado | D BANCO **solo si el pago está confirmado**; visible en estado de cuenta | No existe «pago confirmado»: `fact_pagos` no tiene banco, estado ni confirmación | **FACT-6** |
| Crédito | D CLIENTES | Nada (regla simple) | CONT-P2 |
| Retención | Calcular desde el inicio; **verificar después en SAT** | Solo existe la **esperada** congelada en la factura; no hay constancia/verificación | **FACT-7** |
| Porcentaje | 15 %, 30 % y **80 %**; depende del cliente; no limitar a 0/15/30 | Validación **hardcode 0/15/30** en ≥ 9 puntos de la aplicación | **FACT-5 (bloqueante)** |
| Anulación | Si hay registro contable, **reversarlo** (aunque sea meses después); la nota de crédito también produce efecto | `cont_asientos` no tiene origen/idempotencia ni vínculo original↔reverso | **CONT-P1** |
| Ventas de bienes | Cuenta separada «VENTA DE BIENES» | Rol sin cuenta: falta **código** | Contabilidad |

**Orden sugerido:** FACT-5 (porcentaje configurable) → CONT-P1 (columnas de origen/reverso en asientos) → FACT-6 (pago confirmado) → FACT-7 (retención verificada) → CONT-P2 (póliza de venta automática **después** de FEL) → CONT-P3 (cobro, retención verificada, reverso y nota de crédito). Ninguna emite pólizas reales hasta que la anterior esté aprobada.

## 1. Punto de partida (qué existe hoy)

- **Factura (FACT-4):** `condicion_pago` (CREDITO/CONTADO), `cuenta_bancaria_id` (banco **declarado**, FK compuesta a la entidad), retención **esperada y congelada** (`retencion_iva_pct`, `retencion_iva_monto`, `retencion_iva_cliente_pct`), líneas con SERVICIO/BIEN. `poliza-venta.ts` calcula la partida por **roles** (función pura, sin escribir).
- **Pagos (`fact_pagos`):** `fecha_pago`, `monto`, `referencia`, `medio_pago`, `observaciones`, `registrado_por`. Solo contra facturas **Emitidas**; no admite sobrepago sobre `monto_total`; **sin banco, sin estado de confirmación**, sin entidad.
- **Asientos (`cont_asientos` / `cont_asiento_detalle`):** `numero`, `fecha`, `glosa`, `estado` (Borrador/Registrado); `registrarAsiento` valida cuadre, cuentas activas de la misma entidad, transacción y auditoría. **Sin** tipo de póliza, **sin** origen, **sin** vínculo a documento.
- **Cartera (`cont_cxc`):** texto libre (cliente, documento, monto, saldo); **sin** vínculo a `fact_facturas`.
- **Resolución de cuentas:** solo `cont_cuentas_bancarias` (por banco). **No existe** `rol → cuenta` por entidad (diseño en `sql/propuesta-…-homologacion-milenium.sql` §5).

## 2. Pago confirmado (venta CONTADO)

### 2.1 Regla `[CONFIRMADO]` + dependencia
```
CRÉDITO                       → D CLIENTES
CONTADO  + pago CONFIRMADO    → D BANCO   (cuenta del banco donde realmente entró el pago)
CONTADO  sin confirmación     → NO se genera póliza de banco
```
**Seleccionar CONTADO en la factura no basta.** «Confirmado» debe poder verse en el estado de cuenta.

### 2.2 Definición `[DISEÑO]`
Una venta CONTADO está **confirmada** cuando existe ≥ 1 pago de esa factura en estado `CONFIRMADO` y la suma confirmada cubre el **neto a cobrar** (`total − retención esperada`). La retención esperada no se cobra al cliente: queda como saldo hasta la constancia (§3).

### 2.3 Datos que faltan `[DISEÑO]` (propuesta; sin ejecutar)
```sql
-- fact_pagos: aditivo (columnas NULL/DEFAULT; no reescribe filas)
ALTER TABLE fact_pagos
  ADD COLUMN entidad_id INT NULL,                        -- la de la factura (se copia al registrar)
  ADD COLUMN cuenta_bancaria_id INT NULL,                -- banco donde ENTRÓ el pago (real, no el declarado)
  ADD COLUMN estado VARCHAR(12) NOT NULL DEFAULT 'REGISTRADO',  -- REGISTRADO | CONFIRMADO | RECHAZADO
  ADD COLUMN referencia_bancaria VARCHAR(120) NULL,      -- n.º de boleta/transferencia (sin datos sensibles)
  ADD COLUMN confirmado_por INT NULL, ADD COLUMN confirmado_en DATETIME NULL,
  ADD CONSTRAINT fk_pago_banco_ambito FOREIGN KEY (empresa_id, entidad_id, cuenta_bancaria_id)
    REFERENCES cont_cuentas_bancarias(empresa_id, entidad_id, id);
```
- **Compatibilidad:** los pagos existentes quedan `REGISTRADO` y sin banco; **no** se reinterpretan como confirmados (no se inventa evidencia).
- **Banco real vs. declarado:** `fact_facturas.cuenta_bancaria_id` es la intención; la póliza usa el banco del **pago confirmado** (misma entidad por FK compuesta). Si difieren, manda el del pago.
- **Quién confirma:** acción propia `confirmar_pagos`, distinta de «Pagos» (segregación: quien registra no confirma). La confirmación queda en auditoría.
- **Evidencia** `[PENDIENTE CONTABILIDAD]`: ¿boleta/depósito con referencia, conciliación bancaria posterior, confirmación manual? ¿pagos parciales? ¿moneda distinta?
- **Estado de cuenta** (lectura derivada, sin saldo almacenado): por factura → total, retención esperada, pagos `REGISTRADO` / `CONFIRMADO` / `RECHAZADO`, retención verificada, **saldo** y **estado de pago** (`POR CONFIRMAR`, `CONFIRMADO`, `PARCIAL`).

### 2.3.1 Qué pasa con CONTADO sin confirmar `[PENDIENTE CONTABILIDAD]`
La venta ya ocurrió y el IVA se declara con la factura certificada. Opciones a decidir (ninguna es «D BANCO» sin pago):
- **A.** Póliza de venta **diferida**: no se asienta nada hasta confirmar (simple; el IVA queda fuera del libro hasta entonces).
- **B.** Póliza de venta contra **CLIENTES** al certificar (como crédito) y, al confirmar, un **cobro** `D BANCO / H CLIENTES`.
Hasta que Contabilidad elija, el motor **no** genera póliza para CONTADO sin confirmación.

### 2.4 Reglas por evento `[DISEÑO]`
| Evento | Condición | Asiento (roles) |
|---|---|---|
| `VENTA` crédito | factura certificada (FEL) | D CLIENTES · D RETENCION_IVA (esperada) · H VENTAS_* · H IVA_POR_PAGAR |
| `VENTA` contado | certificada **y** pago confirmado ≥ neto | D BANCOS (banco del pago) · D RETENCION_IVA (esperada) · H VENTAS_* · H IVA_POR_PAGAR |
| `COBRO` (crédito) | pago `CONFIRMADO` | D BANCOS · H CLIENTES |
| `RETENCION_VERIFICADA` | constancia verificada | sin asiento si coincide con lo esperado (§3.3) |

La póliza de venta nace **después de FEL** (ya confirmado). Todos los eventos con la clave de idempotencia de §5.1.

## 3. Retención: esperada vs. verificada

### 3.1 Dos conceptos distintos `[CONFIRMADO]`
| | A) Retención **esperada / calculada** | B) Constancia **confirmada / verificada** |
|---|---|---|
| Cuándo | Al preparar la factura (se congela) | Después: el cliente emite la constancia; se verifica en SAT |
| Qué es | `IVA × porcentaje` | Documento real del cliente |
| Dónde (hoy) | `fact_facturas.retencion_iva_pct / _monto` | **No existe** |
| Efecto contable | D RETENCION_IVA en la póliza de venta | Cambia el **estado** (y, si difiere o no llega, un ajuste) |

### 3.2 Datos `[DISEÑO]`
```sql
CREATE TABLE fact_factura_retencion_iva (        -- una fila por factura con retención esperada
  factura_id INT PRIMARY KEY,                    -- FK fact_facturas(id)
  empresa_id INT NOT NULL, entidad_id INT NOT NULL,
  porcentaje_esperado DECIMAL(5,2) NOT NULL,     -- copia congelada
  monto_esperado DECIMAL(14,2) NOT NULL,         -- copia congelada de la factura
  estado VARCHAR(20) NOT NULL DEFAULT 'ESPERADA',-- ESPERADA | CONSTANCIA_RECIBIDA | VERIFICADA_SAT | RECHAZADA | NO_EMITIDA
  numero_constancia VARCHAR(60) NULL, fecha_constancia DATE NULL, monto_constancia DECIMAL(14,2) NULL,
  referencia_sat VARCHAR(120) NULL,              -- n.º/código de verificación (sin credenciales)
  verificado_por INT NULL, verificado_en DATETIME NULL, observaciones VARCHAR(500) NULL,
  asiento_ajuste_id INT NULL                     -- si hubo diferencia/no emisión
);
```
- **Transiciones:** `ESPERADA → CONSTANCIA_RECIBIDA → VERIFICADA_SAT`, o `→ RECHAZADA` / `NO_EMITIDA`. Cada una con usuario, fecha y auditoría. El valor esperado **no se edita** una vez emitida la factura.
- **Trazabilidad que la póliza debe conservar** `[CONFIRMADO]`: porcentaje esperado, monto calculado, estado de verificación y constancia/SAT cuando exista.

### 3.3 Qué pasa si la verificación difiere `[PENDIENTE CONTABILIDAD]`
Si SAT no confirma, o el monto/porcentaje de la constancia difiere: ¿se **reclasifica** (D CLIENTES / H RETENCION_IVA por lo no reconocido) y se reclama al cliente?, ¿plazo de verificación?, ¿qué ocurre con la liquidación mensual del IVA? El diseño reserva `asiento_ajuste_id` y el estado, **sin** fijar el asiento.

## 4. Porcentaje de retención configurable (80 %) — DEUDA TÉCNICA / BLOQUEANTE

### 4.1 Hallazgo
FACT-4 limita la retención a **0, 15 o 30** en la aplicación; Contabilidad confirmó que **80 %** (y otros por cliente) es válido. La **base de datos no lo impide**: ambas columnas son `TINYINT UNSIGNED` (0-255) **sin** `CHECK`. El bloqueo está en código:

| Archivo | Qué hace hoy |
|---|---|
| `src/lib/facturacion/lineas-factura.ts` | `RETENCIONES_IVA_PERMITIDAS = [0, 15, 30]`, `RetencionIvaPct`, `esRetencionIvaValida` |
| `src/lib/facturacion/poliza-venta.ts` | `calcularRetencionIva` y `proponerPartidaVenta` lanzan/rechazan fuera de 0/15/30 |
| `src/lib/facturacion/facturas.ts` (`resolverContextoFact4`) | rechaza `retencionIvaPct` y `retencionIvaClientePct` fuera del conjunto |
| `src/lib/facturacion/entrada-fact4.ts` | `falla("…debe ser 0, 15 o 30 %.")` |
| `src/lib/facturacion/contexto-factura.ts` | `guardarRetencionIvaCliente` lanza `RangeError`; **`leerRetencionIvaCliente` devuelve 0 si el valor guardado no es 0/15/30** (degrada **en silencio** un 80 % cargado por otra vía) |
| `src/app/api/…/clientes/[clienteId]/route.ts` | `z.union([literal(0), literal(15), literal(30)])` y lista expuesta al cliente |
| `src/app/api/…/facturas/contexto/route.ts` | expone `retencionesPermitidas` |
| `src/components/facturacion/facturacion-client.tsx` | `<option>` 0/15/30 **hardcodeados** |
| `src/components/facturacion/factura-lineas-form.tsx` | cae a `[0, 15, 30]` si el contexto no trae lista |

### 4.2 Diseño propuesto `[DISEÑO]` (fase FACT-5)
1. **Una sola regla de validación** (`validarPorcentajeRetencionIva`): número finito, `0 ≤ pct ≤ 100`. **Recomendado: enteros 0-100** (la columna actual los soporta: **sin migración**). Decimales (p. ej. 12.5) requerirían `DECIMAL(5,2)` → migración aditiva, solo si Contabilidad lo pide.
2. **Quitar el conjunto cerrado**: ninguna constante 0/15/30 en validación. Los valores habituales (15, 30, 80) pasan a ser **sugerencias** de la interfaz (atajos), no restricciones.
3. **Seguridad:** el porcentaje por cliente solo lo cambia quien tiene `editar_requisitos`; el override por factura sigue exigiendo el mismo permiso (ya implementado) y queda congelado con la factura. **Auditoría** de cada cambio de cliente: usuario, fecha, valor anterior y nuevo.
4. **Lectura honesta:** `leerRetencionIvaCliente` debe **fallar** (no devolver 0) ante un valor fuera de rango.
5. **Cálculo:** `retención = ROUND(IVA × pct / 100, 2)` half-up, siempre `0 ≤ retención ≤ IVA ≤ total`; el neto `total − retención` nunca negativo. Ejemplo 80 %: total Q3,000.00 IVA incl. → IVA 321.43 → retención **257.14** → neto **2,742.86**; DEBE = HABER = 3,000.00.
6. **Pruebas mínimas:** 0, 15, 30, **80**, 100, 101, −1, 12.5 (según se decida), NaN/texto, cliente A→B, y la partida cuadrada al centavo con 80 %.
7. **Datos existentes:** las facturas FACT-4 con 0/15/30 siguen válidas; no hay migración de datos.
8. **Por antigüedad del cliente:** Contabilidad dijo que se «reconoce por comportamiento/antigüedad». Se mantiene **manual por cliente** (no se infiere automáticamente); el origen del valor puede registrarse como nota de auditoría.

## 5. Reverso contable

### 5.1 Idempotencia y vínculo `[DISEÑO]`
```sql
-- cont_asientos: aditivo
ALTER TABLE cont_asientos
  ADD COLUMN origen_tipo VARCHAR(30) NULL,              -- 'FACTURA' | 'PAGO' | 'NOTA_CREDITO' | 'RETENCION' | 'MANUAL'
  ADD COLUMN origen_id   INT NULL,
  ADD COLUMN evento      VARCHAR(30) NULL,              -- 'VENTA' | 'COBRO' | 'REVERSO_ANULACION' | 'NOTA_CREDITO' | …
  ADD COLUMN revierte_asiento_id INT NULL,              -- original al que reversa este asiento
  ADD UNIQUE KEY uq_asiento_origen_evento (empresa_id, entidad_id, origen_tipo, origen_id, evento),
  ADD UNIQUE KEY uq_asiento_revierte (revierte_asiento_id),
  ADD CONSTRAINT fk_asiento_revierte FOREIGN KEY (empresa_id, entidad_id, revierte_asiento_id)
    REFERENCES cont_asientos(empresa_id, entidad_id, id);
```
- `UNIQUE(origen…, evento)`: reintentos, doble clic o reproceso **no duplican**; un original tiene **a lo sumo un** reverso (`uq_asiento_revierte`).
- El original **no se borra ni se edita**: se marca `Reversado` y apunta a su reverso; el reverso apunta al original (**vínculo en ambos sentidos**).

### 5.2 Cómo se construye `[DISEÑO]`
- Se arma **desde el asiento guardado** (mismas cuentas, DEBE↔HABER invertidos), **no** recalculando con datos vivos: por eso se congelan líneas, retención y banco. Incluye el reverso de D RETENCION_IVA y de cualquier cobro ya registrado.
- **Fecha contable** del reverso `[PENDIENTE CONTABILIDAD]`: la de la anulación (período abierto) vs. la de la factura. Funciona **días o meses después**: el efecto se corrige en el período vigente sin tocar el original.
- **Estado del documento:** factura certificada y anulada → reverso + (si procede fiscalmente) **nota de crédito**; factura **no** contabilizada → sin reverso (nada que revertir).
- **Con pagos confirmados:** la anulación directa se rechaza (regla vigente); se corrige por nota de crédito y devolución del pago (cada una con su evento).

### 5.3 Nota de crédito `[CONFIRMADO]` + `[DISEÑO]`
La nota de crédito **también** produce efecto contable y se vincula a la factura. Evento propio `NOTA_CREDITO` con su asiento y su documento fiscal (FEL, fase posterior). **Cuentas** `[PENDIENTE CONTABILIDAD]`: exacto-inverso (VENTAS + IVA) o, como Milenium, D IVA_POR_PAGAR + D **DEVOLUCIONES_VENTAS** / H CLIENTES; el rol `DEVOLUCIONES_VENTAS` ya está homologado, así que ambas opciones son configurables sin cambiar el motor.
**Regla de exclusión:** la suma de efectos (reverso + notas de crédito) sobre una factura **no puede exceder** su asiento original; una nota de crédito **total** y un reverso por anulación son **mutuamente excluyentes** (para no revertir dos veces).

### 5.4 Relación con Milenium (referencia)
En Milenium una factura anulada **no deja póliza** y la corrección de un documento certificado es una nota de crédito (`D IVA + D DEV. SOBRE VENTAS / H CLIENTES`). La decisión de Contabilidad **amplía** eso: si ya hay registro, se reversa; la nota de crédito también registra su efecto. Ambos caminos conviven bajo la misma clave de idempotencia.

## 6. Dependencias y orden

```
FACT-5 porcentaje configurable ─┐
CONT-P1 origen/reverso en asientos ─┼─> CONT-P2 póliza de venta (después de FEL) ─> CONT-P3 cobro/retención/reverso/NC
FACT-6 pago confirmado ────────────┤
FACT-7 retención verificada ───────┘
VENTAS_BIENES: código de cuenta (Contabilidad) ──> habilita líneas BIEN en CONT-P2
```
- **Sin FEL real no hay póliza** (la póliza de venta se dispara con la certificación).
- **Sin cuentas por rol** (`cont_cuentas_rol`) no hay póliza: hoy los roles solo existen como constantes en `poliza-venta.ts`.
- **Sin las 18 cuentas cargadas** (`sql/homologacion-2026-10-contabilidad-cuentas-kt-monaco.sql`, propuesta) no hay a qué apuntar.

## 7. Pendientes contables

1. **Código de VENTAS_BIENES** (por entidad). No usar `41101001`/`41101002` automáticamente.
2. **CONTADO sin confirmar:** opción A (diferida) o B (CLIENTES + cobro) — §2.3.1.
3. **Evidencia de pago confirmado**, pagos parciales y moneda — §2.3.
4. **Retención no verificada/rechazada o con diferencia:** asiento de ajuste y plazo — §3.3.
5. **Porcentaje:** ¿enteros o decimales?, ¿tope?, ¿quién lo define y con qué respaldo? — §4.2.
6. **Reverso:** fecha contable, período cerrado, nota de crédito parcial vs. total, cuentas de la NC — §5.
7. **Naturaleza formal**, clases 6 «otros gastos» y 7 «otros ingresos» (¿se amplía el conjunto de `tipo`?), «nivel 5» como regla (no confirmada).
8. **Bancos** a cargar en `cont_cuentas_bancarias` y la cuenta de prueba `32234`.
