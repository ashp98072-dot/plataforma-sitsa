# Milenium — M-2: preparación técnica de Cuentas por cobrar (discovery; sin implementación)

Estado: **DISCOVERY TÉCNICO DOCUMENTAL.** Sin código, sin SQL, sin migraciones, sin datos, sin producción, sin INFILE/FEL. **No implementa M-2.**
Base: `main` = `0d8e6874` (incluye #468). Fecha: 2026-10-15.

Etiquetas: **CPU** confirmado por usuario/Contabilidad · **CEM** visto en Milenium · **CEC** confirmado en código de `main` · **INF** inferido ·
**PEND** pendiente. Evidencia de Milenium y calibración: [`MILENIUM-M1B-CALIBRACION-PROCESOS` §4.6](MILENIUM-M1B-CALIBRACION-PROCESOS.md).

> **Regla de la fase:** *no inventar las partes de CxC que todavía faltan calibrar.* Donde falta evidencia, este documento dice «PEND» y
> no propone una fórmula.

## 1. Qué gobierna M-2 (resumen de la evidencia)

| Hecho | Etiqueta |
|---|---|
| Factura real a crédito 30 días, **Q14,400.00**, póliza `004`: D Clientes 14,400.00 / H IVA 1,542.86 / H Ventas 12,857.14 (IVA incluido **en ese documento**) | CEM |
| Descripción «12 servicios prestados» con **cantidad 1** y total de línea Q14,400.00 → **no** «1 viaje = 1 línea» | CEM |
| Cobro desde **Bancos → Nota de Crédito Bancaria con Abono a Clientes**; digitado a mano desde el estado de cuenta; **un pago puede aplicarse a varias facturas**; D Banco / H Clientes; número de factura en «Explicación» | CEM |
| Ejemplo: pago Q701.12 aplicado a Q461.44 + Q239.68 → saldo Q0.00 | CEM |
| **Antigüedad por fecha de vencimiento**; rangos No vencido / 1–30 / 31–60 / 61–90 / 91+; existe **fecha de corte** (≠ fecha de impresión) | CEM |
| Factura con saldo Q0.00 **deja de aparecer** en el reporte de antigüedad (no se afirma que se borre); se desea **historial del cliente** | CPU |
| **Pendiente:** retención real aplicada, NC parcial, anticipo, sobrepago, reverso de pago, factura anulada con aplicaciones, orden de aplicación, saldo a favor | PEND |

## 2. Inventario de datos en `main` (qué existe hoy)

| Tabla | Qué guarda (relevante a CxC) | Lo que **no** guarda | Etiqueta |
|---|---|---|---|
| `fact_facturas` | `empresa_id`, `cliente_id`, `numero_factura` (único por empresa), `fecha_emision`, `monto_total`, `estado_admin` (Borrador / Emitida / Anulada), `moneda`, `subtotal`, `iva_monto`, snapshots de cliente (nombre, NIT, dirección), `entidad_id` (NULL en facturas previas a FACT-4), `modelo_lineas`, **`condicion_pago`** (CREDITO / CONTADO / NULL), `cuenta_bancaria_*`, **retención IVA esperada** (`retencion_iva_pct`, `_cliente_pct`, `_monto`) | **`fecha_vencimiento`, `dias_credito`** ni vencimiento alguno; serie, establecimiento, autorización (FEL/Milenium); estado financiero persistido | CEC |
| `fact_factura_lineas` | Orden, cantidad, descripción, precio unitario, clasificación SERVICIO/BIEN, IVA incluido/agregado, %, base, IVA, total | — | CEC |
| `fact_factura_linea_viajes` | **Varios viajes por línea** (UNIQUE por línea+plan) | — | CEC → **soporta** el caso «12 servicios en 1 línea» |
| `fact_factura_viajes` | Vínculo activo factura↔viaje (UNIQUE `plan_id`) | Histórico de anuladas (está en `fact_factura_viajes_anuladas`) | CEC |
| `fact_pagos` | **Un** pago → **una** factura (`factura_id`): fecha, monto, referencia, medio, observaciones, registrado_por | Banco/cuenta, entidad, estado (anulación/reverso), **identificador de pago/lote**, aplicación a varias facturas, tipo de aplicación (pago/retención/NC/anticipo) | CEC |
| `fact_pago_confirmaciones` | Confirmación **bancaria** por factura: cuenta bancaria de la entidad, monto, fecha de acreditación, referencia, evidencia, estado CONFIRMADA/ANULADA, `pago_id` opcional, idempotencia | No modifica `fact_pagos` ni el saldo; su total se acota por `monto_total` | CEC |
| `clientes` | Código, nombre, razón social, NIT, correo, dirección, contacto, estado, `tms_cliente_id` | **Días/límite de crédito estructurados**, tipo de identificación | CEC |
| `tms_clientes` | Cliente operativo (viajes); puente con `clientes` | — | CEC |
| `fact_cliente_perfil` | Respuestas del cuestionario en **JSON libre**, entre ellas `dias_credito` (campo numérico **sin validar ni versionar**) y «¿retiene impuestos?» | Dato estructurado y consultable | CEC |
| `cont_cxc` | Registro **manual**: cliente en texto, documento en texto, fecha, vencimiento, monto, saldo (= monto al crear), estado | Vínculo a `fact_facturas`/`clientes`; aplicaciones; actualización de saldo | CEC |
| `cont_cuentas_bancarias` | Banco/alias/cuenta contable por entidad | Movimientos | CEC |
| `fel_documentos` | Identidad certificada (autorización, serie, número) del dominio FEL **inerte** (MOCK) | Facturas emitidas en Milenium | CEC |

## 3. Qué se puede construir **hoy** (sin cambiar esquema)

| # | Capacidad | ¿Hoy? | Con qué | Limitación |
|---|---|---|---|---|
| 1 | **Cartera abierta** (facturas con saldo > 0) | **Sí** | `fact_facturas` Emitida + `fact_pagos` | «Registradas en plataforma»; **no** es la cartera legal; retención no reduce saldo (CT-08) |
| 2 | **Historial del cliente** (pagadas, saldo 0, anuladas) | **Sí, parcial** | `fact_facturas` (todos los estados) + `fact_pagos` + `fact_pago_confirmaciones` + `fact_factura_viajes_anuladas` | Sin retenciones aplicadas ni NC (no existen); pagos sin identificador de lote |
| 3 | **Facturas pendientes** | **Sí** | `estadoFinanciero` ya derivado («Sin pagos» / «Pago parcial») | Igual que 1 |
| 4 | **Facturas pagadas** | **Sí** | «Cobrado» (pagos ≥ total) | Una factura con retención real **no** llegaría a «Cobrado» con el pago neto (CT-08) |
| 5 | **Detalle de pagos** | **Sí** | `listarPagos` y confirmaciones | Un cobro bancario aplicado a 2 facturas aparece como 2 filas sin lote |
| 6 | **Saldo informativo** | **Sí** | `monto_total − Σ fact_pagos` (ver §4) | **No** es saldo legal; sin retenciones/NC/anticipos |
| 7 | **Futura antigüedad** | **No** | — | Falta **vencimiento** (§6): no hay `fecha_vencimiento` ni `dias_credito` congelados |
| 8 | Estado de cuenta por cliente (facturas + pagos + saldo) | **Sí** (informativo) | 1–6 por `cliente_id` | Mismo rótulo |
| 9 | Referencia del documento fiscal (serie/establecimiento/autorización) | **No** | — | Solo `numero_factura` digitado (M-3) |

## 4. Saldo informativo HOY vs. saldo legal de Milenium

**Plataforma (CEC, `src/lib/facturacion/facturas.ts`):**

```text
total_pagado = Σ fact_pagos.monto  (de la factura)
saldo        = monto_total − total_pagado
estado       = Sin pagos (total_pagado ≤ 0) | Pago parcial | Cobrado (total_pagado ≥ monto_total)   -- solo si estado_admin = Emitida
```
Reglas relacionadas (CEC): solo se registra pago a facturas **Emitida**; el pago **no puede exceder** el saldo (no hay sobrepago ni saldo a
favor); una factura **con pagos no se puede anular**; la **retención esperada** se guarda congelada y se muestra como «neto a cobrar» en la
previsualización, pero **no entra** en el saldo ni en el estado.

**Milenium (CEM + PEND):** el saldo se **deriva** (factura − aplicaciones; `PAGADA` sin uso); las aplicaciones incluyen **pagos** y, según
las auditorías, retenciones y notas de crédito. **La fórmula global no está confirmada.**

| Concepto | Saldo informativo de plataforma | Saldo legal de Milenium |
|---|---|---|
| Pago aplicado | Resta | Resta (CEM) |
| Un pago a varias facturas | **No soportado** (1 fila por factura, sin lote) | Soportado (CEM) |
| Retención de IVA | **No resta** (solo informativa) | Resta como aplicación (CEM, FCM §H.1) — monto real **PEND** |
| Nota de crédito | No existe | Existe (CEM) |
| Anticipo / saldo a favor | No existe | Existe (CEM) |
| Sobrepago | Bloqueado | PEND |
| Reverso de pago | No existe (no hay borrado/anulación de `fact_pagos`) | PEND |
| Factura anulada con aplicaciones | No permitido anular con pagos | PEND |

> **No declarar equivalencia** hasta calibrar retención, NC, anticipos y reversos. Toda cifra se rotula **«Saldo informativo (registrado
> en plataforma)»**, nunca «saldo del cliente» ni «cartera».

## 5. Estados: persistidos vs. derivados (solo análisis)

| Estado propuesto | ¿Derivable hoy? | Regla derivada (informativa) | ¿Persistir? |
|---|---|---|---|
| `SIN_PAGOS` | Sí | Emitida y Σ pagos = 0 | **No** |
| `PARCIAL` | Sí | Emitida y 0 < Σ pagos < total | **No** |
| `PAGADA` | Sí (con la salvedad de retención) | Emitida y Σ pagos ≥ total | **No** |
| `ANULADA` | Sí | `estado_admin = Anulada` | Ya persistido |
| `NO_VENCIDA` / `VENCIDA` | **No** | Requiere `fecha_vencimiento` y fecha de corte | **No** (derivado) cuando exista el vencimiento |

**Principio:** `estado_admin` (Borrador / Emitida / Anulada) es el único estado persistido; los demás son **derivables** y no deben
guardarse (evita divergencias, igual que Milenium, que no persiste «vencida»). Con retenciones/NC futuras, `PAGADA` pasaría a significar
«Σ aplicaciones = total», **no** «Σ pagos ≥ total».

## 6. Vencimiento (verificado de nuevo en `main`)

| Dato | ¿Existe en `fact_facturas`? | Evidencia |
|---|---|---|
| `fecha_vencimiento` | **No** | Esquema FACT-1…FACT-4 y FEL-2A |
| `dias_credito` congelado | **No** | ídem |
| **Condición de pago congelada** | **Sí, parcial**: `condicion_pago` = CREDITO / CONTADO / NULL (NULL en facturas anteriores a FACT-4) | FACT-4 |
| Días de crédito del cliente | **Solo** en `fact_cliente_perfil.respuestas_json` (campo libre, sin validar) | `cuestionario.ts` |

**Consecuencia:** hoy **no se puede** calcular antigüedad por vencimiento (la base confirmada de Milenium). Calcularla con
`fecha_emision + dias_credito del cliente (vivo)` sería **incorrecto**: cambia el pasado.

### 6.1 Necesidad de congelar (análisis)
Escenario: factura emitida el 2026-08-01 con crédito de **30** días (vence 2026-08-31). En octubre el cliente pasa a **60** días.
- Si el vencimiento se **calcula** con el dato vivo del cliente → la factura histórica pasaría a vencer 2026-09-30: **incorrecto**.
- Para que el pasado no cambie hay que **congelar en la factura**, al momento en que corresponda, al menos uno de:
  `dias_credito` y/o `fecha_vencimiento`.
- En Milenium el crédito es **por factura** (`DIASCR`, CEM); un cambio de condición del cliente no reescribe facturas emitidas (INF).

### 6.2 Qué habría que agregar (diseño; **no** se crea migración)
| Elemento | Propósito | Notas / decisiones abiertas |
|---|---|---|
| `dias_credito` (entero, NULL = desconocido) en la factura | Dato fuente congelado | ¿Se captura al **crear el borrador** o al **emitir**? ¿editable en Borrador? Contado ⇒ 0 |
| `fecha_vencimiento` (fecha, NULL = desconocida) en la factura | Base de antigüedad (CEM) | Derivable de `fecha_emision + dias_credito` **solo al congelar**; permitir excepción manual (PEND) |
| Origen del valor por defecto | Evitar digitación | `dias_credito` **estructurado** en el cliente (hoy solo JSON libre) o en parametrización de la entidad |
| Facturas **históricas** | No inventar | Dejarlas con NULL = «vencimiento desconocido» y excluirlas de antigüedad hasta capturarlo (decisión de Contabilidad: ¿carga inicial?) |
| Índice de consulta | Rendimiento de cartera por vencimiento | por (`empresa_id`, `estado_admin`, `fecha_vencimiento`) |
| Estado financiero | **No** persistir | Derivar (§5) |

### 6.3 Qué NO se debe hacer
No inferir vencimiento para facturas históricas; no usar el crédito vivo del cliente; no usar `fecha_emision` como sustituto de vencimiento;
no mostrar rangos de antigüedad hasta tener `fecha_vencimiento`.

## 7. `cont_cxc` — ¿participa en M-2?

**Recomendación: NO.** `cont_cxc` queda **fuera** de M-2.

| Criterio | `cont_cxc` | `fact_facturas` + `fact_pagos` |
|---|---|---|
| Vínculo con factura/cliente | **Ninguno** (texto libre) | FK a `clientes`/`fact_facturas` |
| Origen del dato | Captura manual contable | Flujo de Facturación |
| Saldo | `saldo` = `monto` al crear; **nadie lo actualiza** | Derivado de pagos |
| Aislamiento por entidad | `entidad_id` (libros KT/Mónaco) | `entidad_id` en facturas FACT-4 |
| Uso en el código | Solo libro contable manual (`registros.ts`, `ambito.ts`) y limpieza admin | Facturación, KPIs, reportes TMS |

**Fuente única propuesta para la vista informativa de Facturación:** `fact_facturas` (+ `fact_pagos`).
`fact_pago_confirmaciones` se muestra como **atributo separado** («confirmado en banco»), **no** se suma ni se resta al saldo (CT-10).
`cont_cxc` **no se lee, no se suma, no se concilia y no se modifica** en M-2. Su futuro (retirarlo, enlazarlo o generarlo desde facturas)
es una decisión **posterior**, ligada a la contabilidad (no a M-2).

**Riesgos de tener las tres fuentes:**

| Riesgo | Efecto | Mitigación en M-2 |
|---|---|---|
| Sumar `fact_pagos` + `cont_cxc` | Doble cómputo | Prohibido; una sola fuente |
| Tratar el saldo informativo como cartera legal | Decisiones con cifra distinta de Milenium | Rótulo y fecha de corte; sin «cartera legal» |
| Dos «pendientes» en plataforma (`saldo` y `saldoPendiente` de confirmación) | Confusión | Una definición en la pantalla; la otra, como atributo |
| Cobro registrado en Milenium y no en plataforma (o viceversa) | Saldos distintos | Mostrar «último pago registrado» y fecha; conciliación manual **fuera** de M-2 |
| Retención real no reflejada | Facturas «pendientes» que Milenium ya considera saldadas | Marcar la factura con retención esperada y rotular «neto a cobrar esperado» (informativo) |
| Facturas emitidas en Milenium **no** registradas en plataforma | Estado de cuenta incompleto | Rótulo «solo documentos registrados» (M-3 introduce la referencia externa) |

## 8. Diseño conceptual propuesto de M-2

```text
Facturación
  └── Cuentas por cobrar            (solo lectura; rótulo «registrado en plataforma»)
       ├── Cartera abierta           facturas Emitida con saldo informativo > 0
       ├── Historial                 todas: pagadas, saldo 0, anuladas, pagos, confirmaciones
       └── Cliente                   (una ficha por cliente)
            ├── Facturas
            ├── Pagos                 (y confirmaciones bancarias como atributo)
            ├── Aplicaciones          (hoy: solo pagos; retenciones/NC/anticipos: cuando existan)
            └── Saldo informativo
```

### 8.1 Campos y soporte actual
| Campo | ¿Soportado hoy? | Fuente / nota |
|---|---|---|
| cliente | **Sí** | `fact_facturas.cliente_id` + snapshot de nombre/NIT |
| factura (número, id) | **Sí** | `numero_factura` (único por empresa; ver riesgo §9) |
| fecha emisión | **Sí** | `fecha_emision` |
| fecha vencimiento | **No** | §6 |
| días crédito | **No** | §6 (solo `condicion_pago` CREDITO/CONTADO) |
| monto original | **Sí** | `monto_total` (+ `subtotal`, `iva_monto`) |
| pagos | **Sí** | `fact_pagos` (1 factura por fila) |
| otras aplicaciones (retención real, NC, anticipo) | **No** | No existen; retención solo esperada |
| saldo (informativo) | **Sí** | `monto_total − Σ pagos` |
| estado | **Sí, derivado** | §5 |
| días vencidos | **No** | requiere vencimiento y fecha de corte |
| rango de antigüedad | **No** | requiere vencimiento; rangos CEM: No vencido, 1–30, 31–60, 61–90, 91+ |
| fecha de corte | **No** | parámetro de consulta (futuro) |
| referencia bancaria / boleta | **Parcial** | `referencia` del pago y de la confirmación |
| serie / establecimiento / autorización | **No** | M-3 |
| entidad emisora (KT / Mónaco) | **Parcial** | `entidad_id` (NULL en facturas previas a FACT-4) |

## 9. Qué necesita cambios de esquema (lista; **sin SQL**)

| # | Cambio | ¿Necesario para M-2a (solo lectura)? | Para qué |
|---|---|---|---|
| 1 | `dias_credito` + `fecha_vencimiento` congelados en la factura (§6.2) | **No** | Antigüedad (M-2b) |
| 2 | Crédito del cliente **estructurado** (días / límite) | No | Valor por defecto del #1 |
| 3 | **Identificador de pago/lote** o cabecera de pago con **aplicaciones** a varias facturas | **No** (se puede rotular) | Reflejar un cobro bancario → varias facturas (CT-09) |
| 4 | Entidad «aplicación» tipificada (pago / retención / NC / anticipo) y **reverso** | No | Saldo legal comparable (CT-08) |
| 5 | Retención **aplicada** (constancia, % real, verificación SAT) | No | HOM §14 #3–#4 |
| 6 | Notas de crédito | No | Fase fiscal |
| 7 | Referencia del documento fiscal (establecimiento, serie, número, autorización) | No | M-3 |
| 8 | Unicidad de `numero_factura` por **serie/entidad** (hoy único por `empresa_id`) | No (pero riesgo) | KT y Mónaco comparten tenant; Milenium numera por serie |

## 10. Propuesta exacta de M-2 (sin implementar)

### M-2a — «Cuentas por cobrar informativa» (sin cambio de esquema)
- **Alcance:** pantalla de **solo lectura** en Facturación: *Cartera abierta*, *Historial* y *Cliente* (facturas, pagos, confirmaciones, saldo informativo).
- **Fuente única:** `fact_facturas` + `fact_pagos` (+ confirmaciones como atributo). **Sin** `cont_cxc`. **Sin** tablas nuevas.
- **Reglas de presentación:**
  1. Rótulo permanente: «Saldo informativo — documentos registrados en plataforma. No es la cartera legal de Milenium».
  2. Mostrar `retención esperada` y «neto a cobrar esperado» como **dato aparte**, sin restarlo del saldo.
  3. Estados derivados (§5); no persistir.
  4. Sin rangos de antigüedad ni «vencida»; mostrar «vencimiento: no disponible».
  5. Facturas pagadas **no desaparecen**: viven en *Historial* (CPU, D13/D14).
  6. Filtros: cliente, entidad (KT/Mónaco), estado derivado, rango de fechas de emisión, texto de número de factura.
  7. Alcance por **empresa y entidad** de la sesión (el cuerpo/URL no decide el tenant); respeta el alcance por rol de Facturación existente.
- **Permisos:** reutilizar lectura de Facturación; **sin** permisos nuevos; sin escrituras.
- **Exportación:** Excel/CSV con las mismas columnas y el rótulo.
- **Pruebas previstas:** saldo informativo, estados derivados, aislamiento por empresa/entidad, ningún `cont_cxc`, ninguna escritura,
  paginación/anti N+1, factura anulada, factura con retención esperada.

### M-2b — Antigüedad por vencimiento (**requiere** migración aprobada)
- **Prerrequisito:** §6.2 aprobado por Contabilidad (cuándo se congela, valor por defecto, tratamiento de históricas).
- **Alcance:** columnas días de crédito / vencimiento / días vencidos / rango, y reporte «Detalle de antigüedad» con **fecha de corte**
  explícita (≠ fecha de impresión), rangos **No vencido, 1–30, 31–60, 61–90, 91+** (CEM).
- **Fuera:** facturas sin vencimiento (se listan aparte como «sin vencimiento»).

### M-2c — (posterior, P3) aplicaciones tipificadas, retención real y NC
Depende de la calibración pendiente de CxC y del hito fiscal. **No** se diseña aquí.

## 11. Riesgos de M-2

| # | Riesgo | Nivel | Mitigación |
|---|---|---|---|
| R1 | Presentar saldo informativo como cartera legal | Alto | Rótulo y fecha; no usar «cartera» sin calificativo |
| R2 | `cont_cxc` vs `fact_pagos` vs Milenium | Alto | Fuente única; `cont_cxc` fuera (§7) |
| R3 | Retención real no reflejada → «pendiente» falso | Alto | Dato aparte; no igualar con Milenium (CT-08) |
| R4 | Vencimiento recalculado con crédito vivo | Alto | No calcular antigüedad sin congelado (§6) |
| R5 | `numero_factura` único por empresa (no por serie) | Medio | Documentar; resolver en M-3 |
| R6 | Facturas de Milenium no registradas | Medio | Rótulo «solo documentos registrados» |
| R7 | Pagos de un mismo cobro bancario como filas sueltas | Medio | Agrupar por referencia **solo para visualizar**, sin inferir lote |
| R8 | Entidad NULL en facturas previas a FACT-4 | Medio | Mostrar «sin entidad»; no asignar |
| R9 | Datos de clientes duplicados (`clientes`/`tms_clientes`/perfil) | Medio | Usar `clientes.id` de la factura y su snapshot |

## 12. Preguntas abiertas (para Contabilidad / usuarios)

1. ¿Cómo se determina el **vencimiento** de una factura en Milenium: siempre `fecha + DIASCR` de la factura? ¿se modifica a mano?
2. ¿Cuándo debe **congelarse** el crédito en plataforma: al crear el borrador o al emitir?
3. ¿Qué hacer con las **facturas históricas** ya registradas (sin vencimiento): carga inicial, dejarlas fuera de antigüedad?
4. ¿Cuál es la **fecha de corte** habitual del reporte? ¿se usa la fecha de hoy o el fin de mes?
5. ¿La retención real **reduce el saldo** en el momento de registrarse la constancia o al cobrar? ¿monto real vs. esperado? (PEND)
6. ¿Orden de aplicación de un pago a varias facturas (por antigüedad / manual)? ¿admite sobrepago o saldo a favor? (PEND)
7. ¿Cómo se **revierte** un pago aplicado por error? ¿qué ve el reporte de antigüedad? (PEND)
8. ¿Cómo se trata una factura **anulada** que ya tenía aplicaciones? (PEND)
9. ¿El historial del cliente debe incluir también documentos de Milenium no registrados en plataforma?
10. ¿Qué entidad (KT / Mónaco) debe ver cada usuario en la vista de CxC?

## 13. Qué NO hace esta fase ni M-2a

No crea tablas ni columnas; no ejecuta SQL; no modifica `fact_*` ni `cont_cxc`; no registra pagos ni aplicaciones; no calcula
antigüedad; no integra con Milenium ni con INFILE; no define IVA, retenciones ni «total factura»; no cambia permisos.

---

## 14. M-2a implementado

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (tsc, ESLint, pruebas unitarias y de BD contra MariaDB 11.8.9 desechable).
**No** probado manualmente en navegador; **no** aprobado para producción. **Sin migración, sin SQL de producción, sin escrituras.**

### 14.1 Alcance
Pestaña **«Cuentas por cobrar»** dentro de Facturación, con tres secciones —**Cartera abierta**, **Historial** y **Por cliente**— y exportación
a Excel del conjunto filtrado. Rótulo permanente: «Saldo informativo — documentos registrados en plataforma. No es la cartera legal de
Milenium.»

| Pieza | Archivo |
|---|---|
| Lógica pura (saldo, estados, filtros, columnas) | `src/lib/facturacion/cuentas-por-cobrar-shared.ts` |
| Servicio de lectura | `src/lib/facturacion/cuentas-por-cobrar.ts` |
| Excel | `src/lib/facturacion/cuentas-por-cobrar-excel.ts` |
| Rutas (solo `GET`, permiso `facturacion:ver`) | `src/app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/{route,clientes/route,clientes/[clienteId]/route,export/route}.ts` |
| UI | `src/components/facturacion/cuentas-por-cobrar-panel.tsx` + pestaña en `facturacion-client.tsx` |

### 14.2 Reglas implementadas
- **Fuente única:** `fact_facturas` + `fact_pagos`; `fact_pago_confirmaciones` solo como atributo. **`cont_cxc` no se lee ni se nombra.**
- **Saldo informativo** = `monto_total − Σ fact_pagos.monto`. **No** resta retención esperada ni confirmaciones bancarias.
- **Cartera abierta:** `estado_admin = Emitida` y saldo informativo > 0.
- **Historial:** Emitidas (pendientes, parciales, pagadas) y Anuladas; la factura pagada **no desaparece**. El **Borrador no participa**.
- **Estados derivados (no persistidos):** `ANULADA` · `SIN_PAGOS` (pagado ≤ 0) · `PARCIAL` (0 < pagado < total) · `PAGADA` (pagado ≥ total).
- **Facturas anuladas:** estado `ANULADA`, **sin saldo** (no son cobrables) y excluidas de las sumas.
- **Entidad:** columna y filtro; `entidad_id IS NULL` se muestra «Sin entidad» y **nunca** se asigna. Los **totales y resúmenes van por entidad**:
  KT y Mónaco no se suman entre sí.
- **Retención esperada y neto esperado:** columnas aparte, informativas; no tocan el saldo.
- **Vencimiento:** «No disponible». **No** hay días vencidos, rangos de antigüedad ni estado «vencida».

### 14.3 Consultas principales (sin N+1)
| # | Consulta | Cuándo | Por página |
|---|---|---|---|
| 1 | Facturas + cliente + entidad + **pagos agregados por factura** (JOIN a un `GROUP BY factura_id`), `ORDER BY`, `LIMIT/OFFSET` | siempre | 1 |
| 2 | Totales y conteo agrupados **por entidad** sobre el **mismo filtro** | siempre | 1 |
| 3 | Pagos de las facturas de la página (`factura_id IN (…)`) → última referencia | siempre | 1 |
| 4 | Confirmaciones bancarias de las facturas de la página | siempre | 1 |
| 5 | Resumen de un cliente (agregado por entidad) · lista de pagos · lista de confirmaciones | vista por cliente | 3 |
| 6 | Índice de clientes (agregado por cliente × entidad, ordenado por saldo) + conteo | vista «Por cliente» | 2 |

La prueba de BD verifica que el **número de consultas no cambia** entre una página de 1 y de 100 facturas. Cada consulta lleva `empresa_id`
(de la sesión) como primer predicado; la empresa **nunca** sale de la query string.

### 14.4 Filtros y paginación
`clienteId`, `entidad` (id o «sin»), `estado` (derivado), `estadoAdmin`, `fechaDesde/Hasta` (emisión), `numeroFactura` (contiene; comodines
escapados), `textoCliente` (snapshot, nombre o razón social) y, en Historial, `alcance` = Todas / Abiertas / Pagadas / Anuladas.
Parseo estricto: lo desconocido se ignora. **Paginación en backend** (`LIMIT/OFFSET`, 25 por defecto, máximo 100) con total exacto.
La **exportación** ejecuta el mismo filtro **sin paginar** (tope 20 000; si lo excede responde 400 pidiendo acotar, nunca trunca).

### 14.5 Campos
| Campo | Estado en M-2a |
|---|---|
| cliente, factura, entidad, fecha emisión, monto original, total pagado, saldo informativo, estado, condición de pago | **Sí** |
| retención esperada, neto esperado (aparte) | **Sí** (solo si la factura la tiene) |
| último pago (fecha), referencia (último pago) | **Sí** |
| confirmación bancaria (estado, monto, acreditación, referencia, cuenta) | **Sí**, como atributo |
| fecha de vencimiento, días de crédito, días vencidos, rango de antigüedad | **No** (§6) |
| retenciones reales, notas de crédito, anticipos, saldo a favor, reversos | **No** |
| agrupación de un pago bancario en varias facturas (lote) | **No** (cada pago es de una factura) |

### 14.6 Limitaciones y diferencias conocidas con Milenium
1. **No es la cartera legal.** Solo cuenta documentos registrados en plataforma; facturas de Milenium no registradas no aparecen.
2. **Retención real:** en Milenium reduce el saldo; aquí no (solo la esperada, aparte). Un cliente retenedor puede figurar «pendiente»
   en plataforma aunque Milenium ya lo considere saldado (CT-08).
3. **Un pago a varias facturas:** Milenium lo soporta; aquí son filas por factura sin lote (CT-09). Las referencias iguales se ven en
   *Pagos asociados* del cliente.
4. **Estado «PAGADA»** significa «Σ pagos ≥ total», no «Σ aplicaciones = total».
5. **Confirmación bancaria ≠ pago:** se muestra aparte y no modifica nada (CT-10).
6. **Sin antigüedad:** Milenium clasifica por fecha de vencimiento; aquí no existe ese dato (M-2b).
7. Facturas **anteriores a FACT-4** pueden carecer de entidad y condición de pago (se muestran «Sin entidad» / «—»).

### 14.7 Pruebas
| Archivo | Cobertura |
|---|---|
| `cuentas-por-cobrar-shared.test.ts` | saldo (1000/400/1000), estados, cartera abierta, filtros estrictos, paginación, columnas de exportación, rótulos y **arquitectura** (sin `cont_cxc`, sin escrituras, solo GET, sin vencimiento inventado) |
| `cuentas-por-cobrar.test.ts` | modelo base sin FACT-4 (sin `cont_entidades`, entidad «Sin entidad»), empresa como primer parámetro |
| `cuentas-por-cobrar-rutas.test.ts` | 403 sin permiso en todas las rutas, empresa desde la sesión, filtros validados, cliente 400/404/200, exportación y tope, sin métodos de escritura |
| `cuentas-por-cobrar.db.test.ts` (MariaDB 11.8.9 desechable, SQL real) | A saldo · B estados · C aislamiento empresa/entidad/«Sin entidad» · D `cont_cxc` no participa (cambiarlo no altera nada) · E confirmaciones · F retención esperada · G paginación · H anti N+1 · I historial · J filtros · K por cliente · L Excel exacto con rótulo · M **huella idéntica** de todas las tablas y ningún INSERT/UPDATE/DELETE |

### 14.8 Rendimiento e índices (solo documentado; no se agregó nada)
- La subconsulta de pagos agrega **todos** los pagos de la empresa (`GROUP BY factura_id`) en cada solicitud, igual que el listado de
  facturas existente. Hoy `fact_pagos` solo tiene `idx_pagos_factura(factura_id)` y `idx_pagos_empresa(empresa_id)`.
- **Sugerencia futura (requiere migración, NO aplicada):** índice compuesto `fact_pagos (empresa_id, factura_id)` (idealmente cubriendo
  `monto` y `fecha_pago`) y, para antigüedad (M-2b), `fact_facturas (empresa_id, estado_admin, fecha_vencimiento)`.
- Con volúmenes grandes de pagos, evaluar limitar la agregación a las facturas del filtro en vez de a toda la empresa.
