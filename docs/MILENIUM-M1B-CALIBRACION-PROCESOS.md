# Milenium — M-1b: levantamiento funcional y calibración de procesos y cálculos

Estado: **DOCUMENTO VIVO DE DESCUBRIMIENTO.** Sin código, sin SQL, sin migraciones, sin datos, sin producción, sin INFILE/FEL, sin
conectores a Milenium. Preparado para **llenarse con las entrevistas**. Base: `main` = `4dc04cd1` (incluye #467). Fecha: 2026-10-15.

Complementa a [`MILENIUM-DISCOVERY-FUNCIONAL`](MILENIUM-DISCOVERY-FUNCIONAL.md) (qué procesos hace Milenium y cómo se clasifican); este
documento responde otra pregunta:

> **«¿Cómo llega Milenium, exactamente, de los datos de entrada al resultado final?»**

## 0. Reglas de la fase y etiquetas de evidencia

**Reglas.** Esta fase es documental. **No** se implementa lógica nueva, **no** se crean cartera/CxP/bancos/planilla contable/pólizas
automáticas/diario/mayor, **no** se escriben integraciones DBF. **No se asume ninguna fórmula**, aunque la plataforma tenga reglas
actuales (se muestran solo como *contraste*, nunca como regla de Milenium). **Nunca se convierte una inferencia en regla.**

| Etiqueta | Significado | Cómo se trata |
|---|---|---|
| **CPU** — CONFIRMADO POR USUARIO | Lo afirmó directamente el usuario o Contabilidad en este proyecto | Regla de negocio vigente |
| **CEM** — CONFIRMADO EN MILENIUM | Visto en los **datos/archivos** de una copia de Milenium por las auditorías estáticas previas (solo lectura; datos hasta 2026-05-27). **No re-verificado en esta fase** | Hecho observado; la **regla** detrás puede seguir PENDIENTE |
| **CEC** — CONFIRMADO EN CÓDIGO | Está en `main` de plataforma-sitsa | Describe la plataforma, **no** a Milenium |
| **INF** — INFERIDO | Deducido de nombres, estructura o patrones; **puede estar equivocado** | Hipótesis a calibrar; **prohibido usarla como regla** |
| **PEND** — PENDIENTE | No se sabe; requiere entrevista, ejemplo numérico o al proveedor | Pregunta abierta |

**Procedencia de los CEM:** [`AUDITORIA-MILENIUM-CONTABILIDAD-FACTURACION`](AUDITORIA-MILENIUM-CONTABILIDAD-FACTURACION.md) (AUD),
[`FACTURACION-CONTABILIDAD-MILENIUM-DISCOVERY`](FACTURACION-CONTABILIDAD-MILENIUM-DISCOVERY.md) (FCM),
[`CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO`](CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO.md) (HOM),
[`MILENIUM-INVENTARIO-FUNCIONAL`](MILENIUM-INVENTARIO-FUNCIONAL.md) (INV),
[`CONTABILIDAD-DISENO-PAGO-RETENCION-REVERSO`](CONTABILIDAD-DISENO-PAGO-RETENCION-REVERSO.md) (RET).

## 1. Metodología

### 1.1 Qué se necesita por proceso
Para **cada** proceso (§4–§12) se completa una **ficha** con: *entrada · cálculo · reglas · estados · autorizaciones · documento
generado · póliza generada · efecto en saldo · fecha efectiva · reversos/anulaciones · relación con otros módulos*.

### 1.2 Cinco elementos obligatorios por proceso
1. un caso **NORMAL**;
2. un caso **PARCIAL**;
3. un caso con **CORRECCIÓN / ANULACIÓN** (si existe);
4. un **ejemplo numérico real o anonimizado** (con importes exactos, no redondeados «de cabeza»);
5. el **resultado esperado** tal como lo muestra Milenium (pantalla o reporte).

### 1.3 Procedimiento de entrevista (por caso)
1. Elegir un documento real **ya cerrado** (no uno en captura) y anotar su identificador interno **sin NIT ni nombres**.
2. Pedir que muestren en pantalla/reporte: documento, aplicaciones, saldo, póliza (si la hay), y la fecha de cada paso.
3. Registrar **tal cual** lo que muestra Milenium (cifras con sus decimales). **No** corregir ni «arreglar» lo que no cuadre.
4. Recién después escribir la **fórmula inferida** y comprobarla contra **al menos 2 casos más** antes de marcarla CONFIRMADA.
5. Si el resultado contradice una etiqueta previa, abrir una entrada en §16 (contradicciones); **no** sobrescribir.

### 1.4 Criterio de cierre de un caso
Un caso pasa a **CONFIRMADO** solo con: (a) captura/reporte de Milenium **o** confirmación del responsable, (b) cifras que reproducen la
fórmula **sin diferencias** (o con la diferencia explicada), y (c) fecha y nombre de quién confirmó. Mientras tanto es **PENDIENTE**.

### 1.5 Datos y privacidad
Los ejemplos se anonimizan (cliente «CLI-A», proveedor «PRO-A», empleado «EMP-A»). **No** se copian NIT, cuentas bancarias, nombres de
personas ni llaves/credenciales al repositorio. Importes: reales o proporcionalmente escalados, pero **consistentes** entre sí.

## 2. Plantillas reutilizables

### 2.1 Ficha de proceso
| Atributo | Valor | Etiqueta | Fuente / fecha / quién |
|---|---|---|---|
| Entrada (qué dato inicia el proceso y de dónde viene) | | | |
| Cálculo (fórmula exacta, orden de operaciones, redondeo) | | | |
| Reglas (condiciones, topes, validaciones, bloqueos) | | | |
| Estados (valores posibles y transiciones) | | | |
| Autorizaciones (quién hace / revisa / autoriza) | | | |
| Documento generado (tipo, serie, numeración) | | | |
| Póliza generada (tipo, origen → débitos → créditos) | | | |
| Efecto en saldo (qué saldo y en qué sentido) | | | |
| Fecha efectiva (cuál manda: documento, captura, banco, contable) | | | |
| Reversos / anulaciones (cómo, con qué documento, qué póliza) | | | |
| Relación con otros módulos | | | |

### 2.2 Caso de calibración
| Campo | Valor |
|---|---|
| ID | `XXX-NN` |
| Tipo | NORMAL / PARCIAL / CORRECCIÓN / REDONDEO / BORDE |
| ENTRADA | (documentos, montos, fechas, parámetros) |
| OPERACIÓN | (qué se hizo en Milenium, en qué pantalla) |
| RESULTADO MILENIUM | (lo que **muestra** Milenium: saldo, estado, póliza) |
| FÓRMULA INFERIDA | (marcada INF hasta confirmar) |
| ESTADO | PENDIENTE / CONFIRMADA / REFUTADA |
| Confirmó / fecha | |

### 2.3 Pregunta y contradicción
Pregunta: `ID · texto · a quién · respuesta · etiqueta · fecha`. Contradicción: `ID · A dice · B dice · cómo se resuelve · quién decide`.

## 3. Índice de módulos y grado de levantamiento

| § | Módulo | Qué ya se sabe | Qué falta | Grado |
|---|---|---|---|---|
| 4 | **A. Cuentas por cobrar** | Tipos de documento, saldo derivado, retención y pólizas (CEM) | Fórmula exacta, vencimiento, antigüedad, sobrepagos, reversos | ◐ |
| 5 | **B. Cuentas por pagar** | Existencia de tablas, rangos de retención, cuentas (CEM) | Casi todo el flujo | ○ |
| 6 | **C. Bancos / cobros / pagos** | Tipos de movimiento observados, pólizas de depósito y tránsito (CEM) | Semántica de tipos, conciliación, reversos | ◐ |
| 7 | **D. Planilla** | Uso confirmado por el usuario; tipo de póliza «PLA» (CEM) | **Todo el flujo** (cálculo, pago, póliza) | ○ |
| 8 | **E. Contabilidad general** | Catálogo, tipos de póliza, signo de monto, pólizas automáticas (CEM) | Períodos, numeración, cierres, reversos | ◐ |
| 9 | **F. Libro diario** | Existencia del reporte (CEM) | Contenido, orden, filtros, anuladas | ○ |
| 10 | **G. Libro mayor** | Existencia; signo del monto (CEM) | Cálculo y presentación del saldo por tipo de cuenta | ○ |
| 11 | **H. Impuestos / retenciones** | IVA 12 % incluido, retención de IVA, rangos CxP, cuentas (CEM) | Redondeo, compras, constancias, ISR | ◐ |
| 12 | **I. Relación entre módulos** | Origen de pólizas automáticas por módulo (CEM) | Orden temporal y dependencias exactas | ◐ |
| 13 | **J. Balanza / estados financieros** | Existencia de reportes (CEM) | Si los usan, períodos y cierres | ○ |

Leyenda: ○ casi nada · ◐ parcial (estructura observada, **sin** regla confirmada) · ● calibrado con casos confirmados. **Ninguno está en ●.**

---

## 4. A. CUENTAS POR COBRAR

### 4.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| La **factura a crédito** es el documento de cartera; hay días de crédito por factura (`DIASCR`) | CEM | AUD §10, FCM §I |
| El **saldo no se almacena**: `PAGADA` = falso en las 721 facturas de Mónaco y 0 de 12 529 en KT; el saldo se deriva (factura − aplicaciones) | CEM | AUD §10, FCM §I |
| Vencimiento = fecha + `DIASCR` (verificado en XML) y **no se persiste un estado «vencida»** | CEM | FCM §I |
| Tipos de cobro (`cc05.TIPODOC`): `R` recibo/cobro, `E` aplicación directa (retenciones y otros), `C` nota de crédito (serie `NF`), `D` nota de débito/cargo (serie `FL`, 12), `A` anticipo (2, KT) | CEM (volumen); semántica de `D` y `A`: INF | FCM §I |
| Aplicación: `cc03` una línea por documento aplicado, **monto negativo = reduce saldo**, con referencia a la factura | CEM | FCM §I |
| Límite de crédito (`LIMCRE`) y días de crédito existen en `cc01`; **uso real** | CEM (existen) / PEND (uso) | FCM §I |
| Cheques posfechados `cc30` (consignación/rechazo): 95 en Mónaco | CEM | FCM §I |
| Facturación recurrente (meses/día por cliente) y utilitario «Generar facturación automática» | CEM (existen) / PEND (uso) | FCM §I |
| Reportes: antigüedad de saldos, estado de cuenta, cobrar a clientes, contratos, adeudos y cobros por artículo/vendedor | CEM (menú) / PEND (uso) | AUD §10 |
| Contabilización de CxC: automática (con `f10`) o manual | CEM | AUD §10 |
| Un recibo `R` con depósito (95/95) y banco (72/95); `TOTCHPRE` = cheques prefechados | CEM | FCM §J |
| **Plataforma:** saldo informativo = `monto_total` − `fact_pagos`; estados «Sin pagos / Pago parcial / Cobrado»; **sin vencimiento**, sin aplicaciones múltiples | CEC | `facturas.ts` |

### 4.2 Ficha del proceso (prellenada; lo vacío es PEND)
| Atributo | Valor conocido | Etiqueta |
|---|---|---|
| Entrada | Factura certificada a crédito (¿**crea** la CxC automáticamente o hay un paso aparte?) | PEND |
| Cálculo | saldo = factura − Σ aplicaciones (negativas en `cc03`). **Orden, redondeo y qué incluye cada aplicación: sin confirmar** | INF |
| Reglas | Contado/crédito por serie/`CREDIT`; límite de crédito (¿bloquea?) | PEND |
| Estados | No hay estado persistido (`PAGADA` sin uso); «vencida» se deriva en reporte | CEM |
| Autorizaciones | Hecho/revisado/autorizado en bancos (`HECHOP/REVP/AUTP`); en CxC | PEND |
| Documento | Recibo `R`, aplicación directa `E`, NC `C`, nota de cargo `D`, anticipo `A` | CEM |
| Póliza | Ver §8.3 (recibo → tránsito; `E` retención; `C` NC) | CEM |
| Efecto en saldo | Línea negativa en `cc03` reduce el saldo de la factura referenciada | CEM |
| Fecha efectiva | ¿fecha del recibo, del depósito o de captura? | PEND |
| Reversos | ¿anular recibo? ¿rehabilitar? ¿póliza de reverso? | PEND |
| Relación | Facturación (origen), Bancos (depósito/tránsito), Contabilidad (póliza) | CEM |

### 4.3 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| CXC-Q01 | ¿Qué crea una cuenta por cobrar? ¿La factura certificada la crea sola o hay un paso aparte? | PEND |
| CXC-Q02 | ¿La fecha de la factura o la de vencimiento determina cada reporte? ¿cómo se define el crédito (por cliente, por factura)? | PEND |
| CXC-Q03 | ¿Hay límite de crédito? ¿Bloquea la facturación o solo avisa? | PEND |
| CXC-Q04 | ¿Qué tipos de aplicación reducen el saldo (pago, retención, NC, anticipo, descuento, ajuste)? ¿En qué orden se aplican? | PEND |
| CXC-Q05 | ¿Varios pagos a una factura? ¿un pago a varias facturas? ¿cómo se distribuye? | PEND |
| CXC-Q06 | ¿Cómo quedan los saldos a favor y los sobrepagos? ¿cuenta contable? | PEND |
| CXC-Q07 | ¿Cómo se determina pendiente / parcial / pagada / vencida? ¿qué pasa con el valor `PAGADA`? | PEND |
| CXC-Q08 | ¿Qué fecha manda en la antigüedad (emisión o vencimiento)? ¿rangos 0-30/31-60/…? ¿fecha de corte? | PEND |
| CXC-Q09 | ¿Se calcula mora o interés? ¿La «nota de cargo» (`D`) es eso? | PEND |
| CXC-Q10 | ¿Cómo se revierte un recibo, una NC o una retención aplicada por error? ¿qué pasa con la póliza? | PEND |
| CXC-Q11 | ¿Qué significan exactamente `R`, `E`, `C`, `D`, `A` y la serie `FL`? | PEND |
| CXC-Q12 | ¿Cómo se trata una factura anulada que ya tenía aplicaciones? | PEND |

### 4.4 Casos de calibración
Importes **sintéticos de diseño** (no son datos de Milenium). La columna «Fórmula inferida» es INF y **no** es regla.

| ID | Tipo | ENTRADA | OPERACIÓN | RESULTADO MILENIUM | FÓRMULA INFERIDA | ESTADO |
|---|---|---|---|---|---|---|
| CXC-01 | PARCIAL | Factura Q10,000.00 (IVA incluido), crédito 30 días | Recibo de Q4,000.00 | *[por registrar]* | 10,000.00 − 4,000.00 = **6,000.00** (INF) | PENDIENTE |
| CXC-02 | NORMAL | Factura Q10,000.00 | Recibo Q4,000.00 + **retención IVA** | *[por registrar: monto de la retención y saldo]* | Con la regla empírica «15 % del IVA» (INF): IVA = 10,000.00/1.12×0.12 = 1,071.43; retención = 160.71; saldo = 10,000.00 − 4,000.00 − 160.71 = **5,839.29** | PENDIENTE |
| CXC-03 | NORMAL | Factura Q10,000.00 | Recibo por (total − retención) | *[estado final y saldo]* | saldo = **0.00** → ¿«cobrada»? (INF) | PENDIENTE |
| CXC-04 | PARCIAL | Factura Q10,000.00 | 3 recibos: Q2,000 / Q3,000 / Q1,500 en fechas distintas | *[saldo tras cada uno]* | 10,000 − 6,500 = **3,500.00** | PENDIENTE |
| CXC-05 | NORMAL | 3 facturas (Q5,000 / Q3,000 / Q2,000) | **Un** recibo de Q9,000 | *[cómo distribuye y qué saldo queda en cada una]* | ¿orden por antigüedad o elección manual? (PEND) | PENDIENTE |
| CXC-06 | BORDE | Factura Q10,000.00 | Recibo Q10,500.00 | *[¿lo permite? ¿saldo a favor? ¿cuenta?]* | PEND | PENDIENTE |
| CXC-07 | CORRECCIÓN | Factura Q10,000.00 ya con recibo Q4,000 | NC parcial Q1,000 (IVA incluido) y NC total | *[saldo, póliza, IVA]* | 10,000 − 4,000 − 1,000 = **5,000.00** | PENDIENTE |
| CXC-08 | NORMAL | Anticipo de cliente Q3,000 (tipo `A`) | Se aplica a una factura posterior de Q5,000 | *[saldo de la factura y del anticipo]* | 5,000 − 3,000 = **2,000.00** | PENDIENTE |
| CXC-09 | REDONDEO | Factura 2026-07-15, `DIASCR`=30; corte 2026-10-15 | Antigüedad de saldos | *[rango en que cae]* | Vence 2026-08-14 → **62 días vencida** (rango 61-90) si manda el vencimiento; **92 días** (rango 91-120) si manda la emisión | PENDIENTE |
| CXC-10 | CORRECCIÓN | Recibo Q4,000 aplicado a una factura | Anular/revertir el recibo | *[saldo restaurado, estado del recibo, póliza]* | saldo vuelve a 10,000.00 (INF) | PENDIENTE |
| CXC-11 | CORRECCIÓN | Factura certificada con recibos | Anular la factura | *[¿lo impide? ¿qué pasa con aplicaciones y póliza?]* | PEND | PENDIENTE |
| CXC-12 | NORMAL | Cheque posfechado Q2,500 | Consignación y caso de rechazo | *[efecto en saldo y póliza]* | PEND | PENDIENTE |
| CXC-13 | NORMAL | Aplicación `E` por concepto distinto de retención (intereses, devolución) | Aplicar a una factura | *[efecto y póliza]* | PEND (ver §8.3) | PENDIENTE |

### 4.5 Entregable específico: **fórmula exacta del saldo de una factura**
**Estado: NO CONFIRMADA.** Hipótesis a calibrar con CXC-01…CXC-08: `saldo = monto_total − Σ|aplicaciones| (recibos, retenciones, NC, anticipos)`.
No escribir la fórmula definitiva hasta tener al menos **tres facturas reales** (una con retención, una con NC, una con varios pagos) cuyo
saldo en Milenium coincida **al centavo**.

---

## 5. B. CUENTAS POR PAGAR

### 5.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| Tablas `cc06` (cabecera, 40 275) y `cc08` (detalle, 72 580) en el conjunto auditado; `cc09` relacionada | CEM | AUD §4, INV |
| Capacidades del menú: contraseñas de pago, notas, liquidación de documentos varios, anticipos, programación de pagos, reporte de retenciones | CEM (menú) | AUD §9 |
| Pólizas automáticas de CxP con origen `P/*` (5 936 líneas en Mónaco) | CEM | FCM §D.1 |
| Rangos de retención `cc17`: Mónaco «ISR 5 %» para 2,500.00–30,000.00 y «ISR 7 %» desde 30,000.01 (`MONRET`=1,500; `MONRES`=30,000); KT: un rango al 5 % | CEM (configuración); mecánica «cuota fija + % sobre el excedente»: INF | FCM §G |
| Cuentas observadas: ISR por pagar (retenciones a proveedores) 21301002; ISR/IVA de facturas especiales 21301004 / 21401009; IVA por cobrar (crédito) 11302001 | CEM | FCM §E.2 |
| Retenciones de IVA/ISR de CxP implementadas; **uso real** | CEM (existe) / PEND (uso) | AUD §9 |
| **Plataforma:** `cont_cxp` es un registro manual (proveedor en texto, saldo = monto); `compras_*` cubre requerimientos, no pagos | CEC | `contabilidad`, `compras` |

### 5.2 Ficha del proceso
| Atributo | Valor conocido | Etiqueta |
|---|---|---|
| Entrada | Factura/documento del proveedor (¿captura manual? ¿desde el requerimiento de compras de plataforma?) | PEND |
| Cálculo | saldo proveedor = documentos − aplicaciones válidas. **Sin fórmula confirmada** | PEND |
| Reglas | Rangos de retención por monto; crédito del proveedor; autorización de pago | PEND |
| Estados | Sin información | PEND |
| Autorizaciones | ¿Quién autoriza el pago? ¿contraseña de pago? | PEND |
| Documento | Contraseña de pago, cheque, transferencia, nota | PEND |
| Póliza | `P/*` automática; estructura exacta por tipo | PEND |
| Efecto en saldo | Reduce saldo del proveedor | INF |
| Fecha efectiva | ¿documento, vencimiento, pago? | PEND |
| Reversos | ¿Anular cheque / pago? | PEND |
| Relación | Bancos (pago), Contabilidad (póliza), IVA (crédito fiscal) | CEM (relación general) |

### 5.3 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| CXP-Q01 | ¿Cuándo nace una CxP (al capturar la factura, al recibir la mercadería, al autorizarla)? | PEND |
| CXP-Q02 | ¿Qué fechas se registran (documento, recepción, vencimiento) y cuál manda para pago y reportes? | PEND |
| CXP-Q03 | ¿Cómo se define el crédito del proveedor? ¿se usa el dato de plataforma (`días de crédito`)? | PEND |
| CXP-Q04 | ¿Pagos parciales? ¿anticipos a proveedores? ¿cómo se aplican? | PEND |
| CXP-Q05 | ¿Qué retenciones se aplican (ISR, IVA)? ¿sobre qué base (con o sin IVA)? ¿cuándo se reconocen? | PEND |
| CXP-Q06 | ¿Cómo funcionan los rangos `cc17`? ¿cuota fija + porcentaje sobre el excedente, o porcentaje sobre el total? | PEND |
| CXP-Q07 | ¿Notas de crédito de proveedor? ¿descuentos? ¿efecto en IVA? | PEND |
| CXP-Q08 | ¿Cheques, transferencias, «contraseñas»? ¿quién autoriza y cómo queda constancia? | PEND |
| CXP-Q09 | ¿Se usan facturas especiales (FESP)? ¿qué póliza producen? | PEND |
| CXP-Q10 | ¿Cómo se reversa un pago o una factura de proveedor? ¿póliza? | PEND |

### 5.4 Casos de calibración
| ID | Tipo | ENTRADA | OPERACIÓN | RESULTADO MILENIUM | FÓRMULA INFERIDA | ESTADO |
|---|---|---|---|---|---|---|
| CXP-01 | NORMAL | Factura de proveedor Q5,600.00 (IVA incl.), crédito 30 días | Pago total por cheque | *[saldo, estado, póliza]* | 5,600.00 − 5,600.00 = 0.00 | PENDIENTE |
| CXP-02 | PARCIAL | Factura Q5,600.00 | Pago Q2,000.00 | *[saldo, póliza]* | 5,600.00 − 2,000.00 = **3,600.00** | PENDIENTE |
| CXP-03 | BORDE | Retención ISR por rango: bases 2,499.99 / 2,500.00 / 10,000.00 / 30,000.00 / 30,000.01 / 50,000.00 | Registrar el documento | *[retención de cada una]* | **Hipótesis A** (porcentaje total): 5 % ó 7 % de la base. **Hipótesis B** (cuota fija + excedente): para 50,000.00 → 1,500.00 + 7 % × 20,000.00 = **2,900.00** (A daría 3,500.00). ¿La base lleva IVA? PEND | PENDIENTE |
| CXP-04 | NORMAL | Factura especial (compra a no contribuyente) | Registrar | *[IVA, ISR, póliza]* | PEND | PENDIENTE |
| CXP-05 | CORRECCIÓN | Factura Q5,600 con pago de Q2,000 | Nota de crédito del proveedor Q600 | *[saldo e IVA]* | 5,600 − 2,000 − 600 = **3,000.00** | PENDIENTE |
| CXP-06 | NORMAL | Anticipo a proveedor Q1,000 | Aplicarlo a una factura posterior | *[saldo, póliza]* | PEND | PENDIENTE |
| CXP-07 | CORRECCIÓN | Cheque emitido y luego anulado | Anular el pago | *[saldo restaurado, póliza]* | PEND | PENDIENTE |
| CXP-08 | NORMAL | Contraseña de pago con varias facturas | Emitirla y pagar | *[efecto]* | PEND | PENDIENTE |

### 5.5 Entregable específico
**saldo proveedor = documentos − aplicaciones válidas** — **no se escribe fórmula definitiva** hasta confirmarla con CXP-01…CXP-08 (el
encargo lo prohíbe expresamente).

---

## 6. C. BANCOS / COBROS / PAGOS

### 6.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| Tabla de movimientos `b03` con 29 366 registros; campos `TIPOTR`, `NUMDOC`, `MONTO`, `ANULAD`, `HECHOP`, `REVP`, `AUTP` | CEM | AUD §4, INV |
| `TIPOTR` toma valores (2/3/5/0/1); **solo el `5` está asociado a cobro de cliente con aplicación `B/5` en `cc03`** | CEM; resto PEND | FCM Anexo 1 |
| Saldos por período `b06` (`SALIN`, `SALFIN`) y fecha de conciliación `bfechaconcilia` | CEM (existen) | INV |
| Capacidades: cheques, depósitos, notas, programación de pagos, **conciliación bancaria**, disponibilidad, listados de cheques | CEM (menú) | AUD §9, §14 |
| Pólizas: recibo → D Traslado en tránsito / H Clientes (95/95); depósito → D Banco / H Traslado en tránsito (127); cobro directo → D Banco / H Clientes (177 + 4) | CEM | FCM §D.2 |
| Sin integración electrónica bancaria (conciliación por captura) | CEM | AUD §15 |
| Moneda GTQ en todo; tipo de cambio sin uso real | CEM | AUD §9 |
| **Plataforma:** solo catálogo `cont_cuentas_bancarias` y `fact_pago_confirmaciones` (confirmación de cobro con evidencia) | CEC | PR B |

### 6.2 Ficha del proceso
| Atributo | Valor conocido | Etiqueta |
|---|---|---|
| Entrada | Cobro (recibo, depósito), pago (cheque, transferencia), notas bancarias | CEM (tipos) / PEND (semántica) |
| Cálculo | Saldo del banco = saldo anterior ± movimientos no anulados. **Sin confirmar** | INF |
| Reglas | Hecho / revisado / autorizado; anulado; conciliado | INF (por los nombres de campos) |
| Estados | `ANULAD`; conciliado (por fecha) | CEM (existen) / PEND (valores) |
| Autorizaciones | `HECHOP`, `REVP`, `AUTP` (nombres de campo) | CEM; significado INF |
| Documento | Cheque, depósito, nota (D/C) | CEM (menú) |
| Póliza | Ver arriba | CEM |
| Efecto en saldo | Cuenta bancaria; CxC/CxP cuando hay aplicación | INF |
| Fecha efectiva | ¿contable vs. bancaria? | PEND |
| Reversos | ¿anular y póliza? | PEND |
| Relación | CxC (cobros), CxP (pagos), Contabilidad (pólizas), Planilla (¿pago?) | CEM / PEND |

### 6.3 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| BAN-Q01 | ¿Un cobro se registra primero en CxC o en Bancos? ¿Cuándo se usa el recibo con «tránsito» y cuándo el cobro directo? | PEND |
| BAN-Q02 | ¿Un pago a proveedor nace en CxP o en Bancos? | PEND |
| BAN-Q03 | ¿Qué significa cada valor de `TIPOTR`? ¿qué genera la póliza en cada uno? | PEND |
| BAN-Q04 | ¿Cuándo queda conciliado un movimiento y quién lo marca? ¿qué se hace con partidas en tránsito? | PEND |
| BAN-Q05 | ¿Fecha contable vs. fecha bancaria? ¿cuál manda para saldos y reportes? | PEND |
| BAN-Q06 | ¿Número de documento y referencia: quién los asigna? ¿se valida duplicidad? | PEND |
| BAN-Q07 | ¿Cómo se revierte un movimiento (anular vs. nota contraria)? ¿póliza? | PEND |
| BAN-Q08 | ¿Puede existir un movimiento bancario sin aplicación a CxC/CxP (gastos, comisiones, intereses)? ¿qué cuenta usa? | PEND |
| BAN-Q09 | ¿Qué beneficiario/origen se registra? ¿cuenta bancaria y moneda? | PEND |
| BAN-Q10 | ¿Cheques posfechados y rechazados: cuentas y flujo? | PEND |

### 6.4 Casos de calibración
| ID | Tipo | ENTRADA | OPERACIÓN | RESULTADO MILENIUM | FÓRMULA INFERIDA | ESTADO |
|---|---|---|---|---|---|---|
| BAN-01 | NORMAL | Recibo de Q5,000 con cheque | Registrar recibo; luego depósito | *[póliza de cada paso; saldo de «tránsito»]* | Recibo: D Tránsito / H Clientes; depósito: D Banco / H Tránsito (CEM, estructura) | PENDIENTE |
| BAN-02 | NORMAL | Cobro Q5,000 por transferencia | Registro directo en Bancos (tipo `5`) con aplicación | *[póliza y aplicación en CxC]* | D Banco / H Clientes (CEM, estructura) | PENDIENTE |
| BAN-03 | NORMAL | Pago a proveedor Q3,000 con cheque | Emitir, cobrar, conciliar | *[póliza, saldo CxP, estado conciliado]* | PEND | PENDIENTE |
| BAN-04 | CORRECCIÓN | Cheque emitido y anulado | Anular | *[saldo del banco, póliza]* | PEND | PENDIENTE |
| BAN-05 | NORMAL | Comisión bancaria Q25 (nota de débito) | Registrar sin aplicación | *[cuenta, póliza]* | PEND | PENDIENTE |
| BAN-06 | PARCIAL | Cierre de mes: saldo libros vs. saldo banco, 2 cheques en tránsito | Conciliar | *[reporte de conciliación]* | saldo banco − cheques en tránsito + depósitos en tránsito = saldo libros (INF) | PENDIENTE |
| BAN-07 | BORDE | Depósito sin identificar | Registrar | *[¿se permite sin aplicación? ¿cuenta?]* | PEND | PENDIENTE |

---

## 7. D. PLANILLA (BLOQUE CRÍTICO)

### 7.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| Milenium **se usa hoy** para el **control de pagos de planilla** | **CPU** | Usuario (2026-10-15) |
| Existe el módulo «Planilla» en el producto y un tipo de póliza `PLA — NOMINAS Y PLANILLA` | CEM | AUD §5, FCM §D.1 |
| Existen formatos preimpresos de planillas y la vista `pvlistaausencias` | CEM | AUD §2.1, §4 |
| **Cómo calcula, qué conceptos procesa, cómo contabiliza, bancos, descuentos, IGSS/ISR, relación con RRHH** | **PEND** | — |
| El módulo no fue revisado en la auditoría («no revisado») | CEM (limitación) | AUD §9 |

> **Contraste con la plataforma (solo para detectar divergencias; NO son reglas de Milenium).** La plataforma **sí** tiene un módulo de
> planillas (`rrhh_planilla_periodos`, `rrhh_planilla_lineas`; generar, autorizar, marcar pagos, exportar). Reglas actuales **CEC**:
> IGSS laboral **4.83 %** sobre sueldo ordinario; aporte patronal estimado **12.67 %** (IGSS + IRTRA + INTECAP); motor ISR 2026;
> horas extra = sueldo ÷ **240** × **1.5** × horas; falta = sueldo base ÷ divisor (**30** por defecto); forma de pago por empleado
> (`transferencia` por defecto); **no** genera póliza contable. **Nada de esto se asume para Milenium.**

### 7.2 Separación obligatoria: A cálculo · B pago · C contabilización
| Bloque | Preguntas que lo definen | Dónde ocurre hoy | Etiqueta |
|---|---|---|---|
| **A. Cálculo** (ingresos, descuentos, líquido) | ¿Milenium calcula o solo recibe cifras? | PEND (¿Milenium? ¿plataforma? ¿Excel?) | PEND |
| **B. Pago** (cheque / transferencia / archivo bancario) | ¿Cómo se genera el pago? ¿qué módulo? | **Milenium** (control de pagos) | CPU (existe) / PEND (mecánica) |
| **C. Contabilización** (póliza) | ¿qué póliza produce y desde dónde? | PEND (tipo `PLA` existe) | PEND |

### 7.3 Ficha del proceso
| Atributo | Valor | Etiqueta |
|---|---|---|
| Entrada | PEND (¿horas extra, ausencias, descuentos y bonos entran por captura, Excel o importación?) | PEND |
| Cálculo | PEND (salario bruto, período, base 30 días, ausencias, vacaciones, horas extra, IGSS, ISR, líquido) | PEND |
| Reglas | PEND | PEND |
| Estados | PEND | PEND |
| Autorizaciones | PEND | PEND |
| Documento | PEND (recibo/boleta, planilla impresa, archivo bancario) | PEND |
| Póliza | PEND (tipo `PLA` existe) | CEM (tipo) / PEND (contenido) |
| Efecto en saldo | PEND (¿cuentas por pagar a empleados? ¿banco?) | PEND |
| Fecha efectiva | PEND | PEND |
| Reversos | PEND | PEND |
| Relación | Bancos (pago), Contabilidad (póliza), RRHH de plataforma (¿datos?) | PEND |

### 7.4 Preguntas
**Cálculo**
| ID | Pregunta | Etiqueta |
|---|---|---|
| PLA-Q01 | ¿Qué parte exacta de la planilla se realiza en Milenium? | PEND |
| PLA-Q02 | ¿Milenium calcula el salario bruto o solo registra y paga? | PEND |
| PLA-Q03 | ¿Período: mensual, quincenal, otro? ¿base 30 días? | PEND |
| PLA-Q04 | ¿Cómo trata ausencias, faltas y tardanzas? ¿divisor? | PEND |
| PLA-Q05 | ¿Cómo trata vacaciones (pago, goce, provisión)? | PEND |
| PLA-Q06 | ¿Cómo calcula horas extra? ¿divisor, porcentaje, tope? | PEND |
| PLA-Q07 | ¿Cómo maneja la bonificación incentivo? ¿comisiones, bonos y otros ingresos? | PEND |
| PLA-Q08 | ¿IGSS se calcula o se digita? ¿base, porcentaje, patronal? | PEND |
| PLA-Q09 | ¿ISR se calcula o se digita? ¿con qué método? | PEND |
| PLA-Q10 | ¿Cómo ingresan horas extra, ausencias, descuentos y bonificaciones (captura, Excel, importación)? | PEND |
| PLA-Q11 | ¿Cómo se registran préstamos y anticipos y cómo se descuentan (cuotas, saldo)? | PEND |
| PLA-Q12 | ¿Cómo sale el líquido a pagar? ¿qué descuentos internos existen? | PEND |
**Pago y contabilización**
| ID | Pregunta | Etiqueta |
|---|---|---|
| PLA-Q13 | ¿Cómo se genera el pago: cheque, transferencia, archivo bancario? | PEND |
| PLA-Q14 | ¿Se relaciona con Bancos? ¿cuenta y movimiento por empleado o por planilla? | PEND |
| PLA-Q15 | ¿Qué póliza contable produce? ¿cuentas y centros de costo? ¿provisiones (aguinaldo, bono 14, indemnización)? | PEND |
| PLA-Q16 | ¿Cómo se corrige una planilla ya pagada o contabilizada? | PEND |
| PLA-Q17 | ¿Qué datos podrían provenir en el futuro del módulo RRHH de plataforma? ¿hoy se re-digitan? | PEND |
| PLA-Q18 | ¿Quién autoriza la planilla y quién ejecuta el pago? | PEND |

### 7.5 Casos de calibración
La columna «Referencia plataforma (CEC)» es **solo contraste**: sirve para ver si Milenium coincide, no para asumirlo.

| ID | Tipo | ENTRADA (sintética, a reemplazar por real) | RESULTADO MILENIUM | Referencia plataforma (CEC, contraste) | ESTADO |
|---|---|---|---|---|---|
| PLA-01 | NORMAL | EMP-A: sueldo mensual Q4,000.00, sin incidencias | *[bruto, IGSS, ISR, líquido, póliza]* | IGSS laboral 4.83 % × 4,000.00 = **193.20** | PENDIENTE |
| PLA-02 | NORMAL | EMP-B: sueldo Q4,000.00 + 8 horas extra | *[monto horas extra, base, líquido]* | 4,000/240 × 1.5 × 8 = **200.00** | PENDIENTE |
| PLA-03 | PARCIAL | EMP-C: sueldo Q4,000.00, **1 falta** | *[descuento y efecto en IGSS/ISR]* | 4,000/30 = **133.33** (IGSS/ISR sin cambio en la plataforma) | PENDIENTE |
| PLA-04 | PARCIAL | EMP-D: 5 días de vacaciones en el período | *[pago, goce o descuento]* | PEND (sin referencia confirmada) | PENDIENTE |
| PLA-05 | CORRECCIÓN | EMP-E: préstamo Q1,200 en 6 cuotas; anticipo Q300 | *[descuento del período y saldo del préstamo]* | PEND | PENDIENTE |
| PLA-06 | NORMAL | EMP-F: sueldo con ISR (alto) | *[ISR retenido y método]* | Motor ISR 2026 (CEC; **no** se asume) | PENDIENTE |
| PLA-07 | NORMAL | EMP-G: con bonificación incentivo y comisión | *[conceptos y totales]* | PEND | PENDIENTE |
| PLA-08 | NORMAL | Planilla del período con 3 empleados | *[total a pagar, archivo/cheques/transferencias]* | PEND | PENDIENTE |
| PLA-09 | NORMAL | Misma planilla | *[póliza: origen → débitos → créditos]* | (la plataforma **no** genera póliza) | PENDIENTE |
| PLA-10 | CORRECCIÓN | Planilla pagada con un error de monto en un empleado | *[corrección, reverso, póliza]* | PEND | PENDIENTE |

---

## 8. E. CONTABILIDAD GENERAL

### 8.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| Catálogo de cuentas multinivel (658 cuentas); estructura configurable; multimoneda opcional (sin uso: todo GTQ) | CEM | AUD §9 |
| `TIPO_CTA`: 1 Activo · 2 Pasivo · 3 Capital · 4 Ingreso · 5 Gasto («van de cajón siempre»); `MULTIP_CTA`: +1 deudora, −1 acreedora | **CPU** (tipos, 2026-10-12); `MULTIP` INF | HOM §14 |
| Tipos de póliza (`co05`): 001 APERTURA · 002 BANCOS · 003 FACTURACION · 004 CUENTA POR COBRAR · 005 CUENTA POR PAGAR · 099 VARIAS · PLA NOMINAS Y PLANILLA | CEM | FCM §D.1 |
| Detalle `co03`: `MONTO` **con signo** (positivo = Debe, negativo = Haber), centro de costo, proyecto, moneda/tasa | CEM | FCM §D.1 |
| Las pólizas **automáticas no tienen cabecera** en `co02`; se identifican por (`SISTEMA`, `MODULO`, `NUMPOL`) | CEM | FCM §D.1 |
| Todas las pólizas observadas **cuadran** (Σ monto = 0): 616/616 ventas, 360/360 `C/E`, 95/95 recibos | CEM | FCM §D.2 |
| Períodos (`co06`): fiscal de enero a diciembre desde 2004-07-01 (antes julio–junio) | CEM | FCM §D.1 |
| Numeración manual de 15 dígitos por período | CEM (existe); regla PEND | FCM §D.3 |
| Factura anulada: **sin póliza** (0 de 94) | CEM | FCM §D.2 |
| Parametrización `f10`: **si falta una cuenta, la póliza no se genera** | CEM (manual p. 130) | FCM §D.2 |
| Milenium permite *rehabilitar* y *modificar* documentos emitidos; **cómo se corrige la póliza ya generada** | CEM (utilitarios) / PEND (efecto) | FCM §D.3 |
| Contabilidad: la plataforma debe **reversar** el registro de una factura anulada aunque sea meses después; la NC también tiene efecto contable | **CPU** | HOM §14 #5 |
| Contado: D Bancos solo con pago **confirmado**; crédito: D Clientes | **CPU** | HOM §14 #2 |

### 8.2 Ficha de «póliza» (modelo de datos observado)
| Atributo | Valor | Etiqueta |
|---|---|---|
| Entrada | Cabecera manual (`co02`) o automática por módulo | CEM |
| Cálculo | Σ monto con signo = 0 por póliza | CEM (observado) |
| Reglas | Cuenta de movimiento, período abierto, cuadre; **cuáles bloquean** | PEND |
| Estados | Normal / anulada / rehabilitada | INF |
| Autorizaciones | ¿quién crea, revisa, aprueba, cierra? | PEND |
| Documento | Impresión de partida; explicación (`co04`, texto libre) | CEM |
| Efecto en saldo | Mayor por cuenta | INF |
| Fecha efectiva | ¿fecha del documento origen o de captura? | PEND |
| Reversos | PEND | PEND |
| Relación | Módulos origen (§12) | CEM |

### 8.3 Origen de pólizas: ORIGEN → DÉBITOS → CRÉDITOS
Estructuras **observadas** (CEM, con importes sintéticos de FCM §D.2). **Cuentas = roles**, no se fijan números aquí.

| Origen | Débitos | Créditos | Frecuencia (Mónaco) | Etiqueta |
|---|---|---|---|---|
| Factura de venta (FCAM) | Clientes (total) | IVA por pagar; Ventas de servicios (base) | 613 de 616 | CEM |
| Factura exenta | Clientes | Ventas exentas | 2 | CEM |
| Recibo de cobro | Traslado en tránsito | Clientes | 95 de 95 | CEM |
| Depósito que cierra el tránsito | Banco | Traslado en tránsito | 127 | CEM |
| Cobro directo en Bancos | Banco | Clientes (a veces + Otros ingresos / Anticipo de clientes) | 177 + 4 | CEM |
| Retención de IVA del cliente (`C/E`) | Retenciones de IVA | Clientes | 306 de 360 | CEM |
| Otras aplicaciones `E` | Intereses / Dev. s/ventas / Provisión retenciones / IVA por pagar + Dev. s/ventas | Clientes | 49 | CEM (significado de negocio PEND) |
| Nota de crédito (NCRE) | IVA por pagar; Dev. sobre ventas varias | Clientes | 6 de 6 | CEM |
| Liquidación mensual de IVA (manual) | IVA por pagar | IVA por cobrar (crédito); Retenciones de IVA | 8 (+5) | CEM |
| Factura de compra / CxP | PEND | PEND | 5 936 líneas `P/*` | **PEND** |
| Pago a proveedor | PEND | PEND | — | **PEND** |
| Planilla | PEND | PEND | — | **PEND** |
| Ajuste manual | libre | libre | 527 (`0/0`) | CEM |
| Factura anulada | — (sin póliza) | — | 0 de 94 | CEM |

### 8.4 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| CON-Q01 | ¿Qué tipo de póliza lleva cada origen? Los datos muestran `004` para ventas, no `003`: ¿es la intención? | PEND (P-D1) |
| CON-Q02 | ¿La fecha contable es la del documento o la de captura? ¿se permite fecha de otro período? | PEND |
| CON-Q03 | ¿Numeración: por tipo, por período, automática o manual? ¿huecos? | PEND |
| CON-Q04 | ¿Cómo se cierra un período? ¿qué bloquea después? ¿se puede reabrir? | PEND |
| CON-Q05 | ¿Cómo se corrige una póliza automática ya generada (rehabilitar, modificar, póliza de reverso)? | PEND |
| CON-Q06 | ¿Centros de costo: cuándo son obligatorios? ¿«proyecto»? | PEND |
| CON-Q07 | ¿Referencia externa (documento origen) en la póliza? ¿cómo se rastrea una póliza a su documento? | PEND |
| CON-Q08 | ¿Quién crea, revisa y aprueba pólizas manuales? ¿constancia? | PEND |
| CON-Q09 | ¿Qué pasa si falta una cuenta parametrizada: bloquea la emisión o sale sin póliza? ¿se detecta después? | PEND |
| CON-Q10 | ¿Qué importaciones masivas de pólizas/cuentas se usan hoy (Excel)? ¿de dónde vienen los archivos? | PEND |

### 8.5 Casos de calibración
| ID | Tipo | ENTRADA | OPERACIÓN | RESULTADO MILENIUM | FÓRMULA INFERIDA | ESTADO |
|---|---|---|---|---|---|---|
| CON-01 | NORMAL | Factura de servicios Q1,120.00 (IVA incl.) a crédito | Certificar/guardar | *[póliza: líneas y centros de costo]* | D Clientes 1,120.00 / H IVA 120.00 / H Ventas 1,000.00 (estructura CEM) | PENDIENTE |
| CON-02 | REDONDEO | 3 líneas de Q1.05 (IVA incl.) | Facturar | *[IVA de la póliza]* | Por línea: 3 × 0.11 = **0.33**; por total: 3.15/1.12×0.12 = **0.34** (INF) → distingue el método | PENDIENTE |
| CON-03 | NORMAL | Factura Q2,085.10 (2 × 1,042.55) | Facturar | *[base e IVA]* | IVA = 2,085.10/1.12×0.12 = **223.40**; base **1,861.70** (INF) | PENDIENTE |
| CON-04 | CORRECCIÓN | Factura con póliza | Anular la factura | *[¿póliza anulada? ¿reverso? ¿mes distinto?]* | CEM: anulada sin póliza; con póliza previa: PEND | PENDIENTE |
| CON-05 | NORMAL | Póliza manual de 3 líneas | Capturar | *[numeración, tipo, período]* | Σ debe = Σ haber | PENDIENTE |
| CON-06 | BORDE | Documento de un mes ya cerrado | Contabilizar | *[¿bloquea? ¿fecha efectiva?]* | PEND | PENDIENTE |
| CON-07 | CORRECCIÓN | Póliza automática con error | «Modificar»/«rehabilitar» | *[efecto en mayor y diario]* | PEND | PENDIENTE |

---

## 9. F. LIBRO DIARIO

### 9.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| El reporte «Libro diario» existe en el menú de Contabilidad (15 reportes en total) | CEM (menú) | AUD §9, §14 |
| Tecnología de reportes: FRX → vista previa → PDF/XLS/HTML o impresora | CEM | AUD §14 |
| Regla de cuadre observada por póliza (Σ monto con signo = 0) | CEM | FCM §D.2 |
| Contenido, orden, filtros, cierres, tratamiento de anuladas/reversos | **PEND** | — |
| **Plataforma:** consulta de las últimas 100 partidas con totales y detalle; sin libro diario formal | CEC | C3B |

### 9.2 Ficha
| Atributo | Valor | Etiqueta |
|---|---|---|
| Entrada | Pólizas del período (manuales y automáticas) | INF |
| Cálculo | Σ débitos = Σ créditos por póliza y por período | CEM (por póliza) / INF (período) |
| Reglas | Qué estados entran (¿anuladas?); orden | PEND |
| Documento | Reporte impreso/exportable | CEM |
| Fecha efectiva | ¿fecha de la póliza? | PEND |

### 9.3 Preguntas y casos
| ID | Pregunta / caso | Etiqueta |
|---|---|---|
| DIA-Q01 | ¿Qué registros aparecen (todas las pólizas, también anuladas/rehabilitadas)? ¿en qué orden (fecha, tipo, número)? | PEND |
| DIA-Q02 | ¿Qué columnas muestra (fecha, número, tipo, descripción, cuenta, debe, haber, referencia)? ¿filtros? | PEND |
| DIA-Q03 | ¿Cómo muestra reversos y pólizas de cierre? ¿se excluyen en reportes de período? | PEND |
| DIA-01 | **Caso:** un día con ≥ 3 pólizas (venta, recibo, manual): *[registrar el reporte tal cual]*; verificar Σ debe = Σ haber del día. Estado: PENDIENTE | PEND |
| DIA-02 | **Caso:** mes con una póliza reversada: *[¿aparecen ambas? ¿netean?]* | PEND |
| DIA-03 | **Caso:** período cerrado: *[¿incluye pólizas de cierre?]* | PEND |

---

## 10. G. LIBRO MAYOR

### 10.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| Existen «diario mayor» y «balance de saldos» en el menú | CEM (menú) | AUD §9 |
| `MONTO` con signo (positivo = Debe) por línea de póliza | CEM | FCM §D.1 |
| Naturaleza: deudora/acreedora por `MULTIP_CTA` (+1/−1) | INF (tipos CPU; naturaleza formal sin confirmar) | HOM §14 #1, #7 |
| **Cálculo del saldo, signo por tipo de cuenta, presentación (debe/haber/saldo anterior/acumulado)** | **PEND** | — |

### 10.2 Hipótesis a calibrar (INFERIDO, **no** regla)
`saldo final = saldo inicial + Σ(débitos) − Σ(créditos)` para cuentas deudoras (Activo, Gasto) y `saldo inicial + Σ(créditos) − Σ(débitos)`
para acreedoras (Pasivo, Capital, Ingreso). **No** asumir el signo: confirmar cómo **muestra** Milenium cada tipo.

### 10.3 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| MAY-Q01 | ¿Cómo presenta el saldo de una cuenta acreedora (en positivo o con signo)? | PEND |
| MAY-Q02 | ¿Qué es «saldo anterior»: al inicio del rango, del ejercicio o del período? ¿cómo se arrastra al abrir un año? | PEND |
| MAY-Q03 | ¿Saldo acumulado línea a línea? ¿ordenado por fecha o por número de póliza? | PEND |
| MAY-Q04 | ¿Cuentas de ingreso y gasto se cierran contra resultados al cerrar el ejercicio? ¿póliza de cierre? | PEND |
| MAY-Q05 | ¿El mayor incluye cuentas padre/agrupadoras con suma de hijas? ¿niveles? | PEND |

### 10.4 Casos de calibración (uno por tipo de cuenta)
| ID | Tipo | ENTRADA | RESULTADO MILENIUM | FÓRMULA INFERIDA | ESTADO |
|---|---|---|---|---|---|
| MAY-01 | Activo | Saldo inicial 1,000.00; D 400.00; H 150.00 | *[debe, haber, saldo]* | 1,000 + 400 − 150 = **1,250.00** (deudora) | PENDIENTE |
| MAY-02 | Pasivo | Saldo inicial 800.00; D 100.00; H 500.00 | *[¿1,200.00 o −1,200.00?]* | 800 + 500 − 100 = **1,200.00** (acreedora) | PENDIENTE |
| MAY-03 | Capital | Saldo inicial 5,000.00; H 1,000.00 | *[signo]* | 6,000.00 | PENDIENTE |
| MAY-04 | Ingreso | Acumulado del año 10,000.00; H 2,000.00 | *[signo y acumulado]* | 12,000.00 | PENDIENTE |
| MAY-05 | Gasto | Acumulado del año 3,000.00; D 700.00; H 100.00 | *[signo]* | 3,600.00 | PENDIENTE |
| MAY-06 | Reverso | Cuenta con póliza y su reverso en otro mes | *[saldo mensual y acumulado]* | neto 0 al final | PENDIENTE |
| MAY-07 | Cambio de año | Cuentas de resultado al 1 de enero | *[saldo inicial: ¿cero?]* | PEND | PENDIENTE |

---

## 11. H. IMPUESTOS / RETENCIONES RELACIONADOS

### 11.1 Lo que ya se sabe
| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| IVA 12 % **incluido en el precio** de cada línea; `IVA = total/1.12×0.12` en 718 de 721 facturas (±Q0.02) | CEM | FCM §F |
| IVA por ítem (`NombreCorto=IVA`, monto gravable y monto impuesto) y total; bien o servicio por línea (`S`) | CEM | AUD §8, FCM §F |
| Exentas: 3 de 721 (Mónaco), 290 de 12 529 (KT); póliza con «Ventas exentas» | CEM | FCM §F |
| Tabla de tasas de IVA configurable; parámetro «en las facturas pide el total» | CEM (menú, manual) | FCM §F |
| Retención de IVA del cliente: documento `E`, constancia del cliente en `NUMFEL`, **15 % del IVA** en 497 de 573 aplicaciones, 30 % en 23, 53 con otras proporciones; en KT 15/30/**80** %, 10/24/60 % | CEM (empírico) | FCM §H.1, RET |
| **El porcentaje depende del cliente** y no se confirmó qué valores están vigentes ni si el 80 % sigue vigente | **CPU** | HOM §14 #4 |
| **Calcular la retención desde el inicio; verificar después en SAT** | **CPU** | HOM §14 #3 |
| La retención **no reduce Ventas ni IVA por pagar**: D Retención IVA (IVA × %) + D Cliente/Banco (total − ret.) / H Ventas + H IVA | **CPU** | memoria de proyecto, RET |
| Desfase factura → constancia: mediana 4 días, p90 11, máx. 86 | CEM | FCM §H.1 |
| Los documentos `E` llevan `NOLIVE=true` (no entran al libro de ventas) | CEM (flag); semántica INF | FCM §H.1 |
| ISR en ventas: **no se calcula** (`RETISR*` = 0); leyenda «Sujeto a pagos trimestrales»; retención de ISR del cliente: sin uso | CEM | FCM §G |
| Retención ISR a **proveedores** por rangos (5 % / 7 %) en CxP | CEM (configuración) | FCM §G |
| Compras: IVA por cobrar (crédito) en 1 594 líneas; facturas especiales (ISR/IVA) con sus cuentas | CEM | FCM §E.2 |
| Libro de ventas, libro de compras y archivo ASISTE LIBROS existen; **resoluciones autorizadas** del libro | CEM (menú) | FCM §F |
| **Plataforma:** IVA por línea (incl./agregado), retención esperada 0/15/30 por cliente (FACT-4) | CEC | FACT-4 |

### 11.2 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| IMP-Q01 | **Ventas:** ¿el precio siempre incluye IVA? ¿cómo separa base e IVA? ¿redondeo por línea o por total? ¿a cuántos decimales y con qué regla (mitad hacia arriba)? | PEND |
| IMP-Q02 | **Compras:** ¿cómo se registra el crédito fiscal? ¿qué documentos lo generan? ¿facturas especiales? | PEND |
| IMP-Q03 | **Retención IVA clientes:** ¿base (IVA o total)? ¿porcentaje por cliente (quién lo define y dónde se guarda)? ¿cuándo se reconoce (al cobrar, al recibir constancia)? | PEND |
| IMP-Q04 | ¿Cómo reduce la CxC? ¿qué cuenta usa? ¿qué pasa si la constancia no llega o SAT no la confirma? | PEND |
| IMP-Q05 | ¿Cómo se registra y emite la constancia (documento físico o FEL)? ¿se archiva? | PEND |
| IMP-Q06 | **Retenciones a proveedores:** tipos, porcentajes, base, cuándo se reconocen, cuenta, constancia | PEND |
| IMP-Q07 | ¿Liquidación mensual del IVA: quién, cuándo, con qué póliza? ¿cómo se compensa el crédito y las retenciones? | PEND |
| IMP-Q08 | ¿ISR trimestral: cálculo manual o hay apoyo del sistema? | PEND |
| IMP-Q09 | ¿Cómo se prepara el libro de ventas/compras y ASISTE LIBROS (reporte, periodicidad, responsable)? | PEND |

**NO inferir reglas fiscales:** todo lo anterior es observación o decisión confirmada; las **reglas** siguen en Contabilidad.

### 11.3 Casos de calibración
| ID | Tipo | ENTRADA | OPERACIÓN | RESULTADO MILENIUM | FÓRMULA INFERIDA | ESTADO |
|---|---|---|---|---|---|---|
| IMP-01 | NORMAL | Línea Q1,120.00 (IVA incl.) | Facturar | *[base, IVA]* | 1,000.00 + 120.00 (INF) | PENDIENTE |
| IMP-02 | REDONDEO | 3 líneas de Q1.05 | Facturar | *[IVA total y por línea]* | Por línea 0.33 vs. total 0.34 → distingue el método (ver CON-02) | PENDIENTE |
| IMP-03 | REDONDEO | Factura Q10,000.00 | Registrar retención IVA al 15 % | *[base de la retención y redondeo]* | IVA 1,071.43; retención **160.71** (160.7145 → 160.71) vs. 15 % del total = 1,500.00 | PENDIENTE |
| IMP-04 | NORMAL | Cliente con 30 % | Registrar retención | *[monto]* | 1,071.43 × 30 % = **321.43** | PENDIENTE |
| IMP-05 | BORDE | Retención al 80 % (histórico KT) | Registrar | *[¿lo permite? ¿monto?]* | 1,071.43 × 80 % = **857.14** | PENDIENTE |
| IMP-06 | NORMAL | Factura exenta Q1,000.00 | Facturar | *[póliza y libro]* | IVA 0.00; H Ventas exentas | PENDIENTE |
| IMP-07 | NORMAL | Compra Q5,600.00 (IVA incl.) | Registrar | *[crédito fiscal y póliza]* | IVA 600.00 (INF) | PENDIENTE |
| IMP-08 | NORMAL | Mes con IVA por pagar 12,000, crédito 7,000, retenciones 1,500 | Liquidación mensual | *[póliza]* | D IVA por pagar 12,000 / H crédito 7,000 / H retenciones 1,500 / **saldo a pagar 3,500** (INF) | PENDIENTE |

---

## 12. I. RELACIÓN ENTRE MÓDULOS

### 12.1 Cadena observada (CEM) y puntos a calibrar
```text
Facturación (f06/f07) ──f10──▶ póliza F/1  (D Clientes / H IVA / H Ventas)
        │                          │
        ▼                          ▼
 Cuentas por cobrar (cc05/cc03) ─▶ pólizas C/R (recibo→tránsito), C/E (retención / aplicaciones), C/C (NC)
        │
        ▼
 Bancos (b03) ──▶ pólizas B/* (depósito: D Banco / H Tránsito; cobro directo: D Banco / H Clientes)
        │
        ▼
 Cuentas por pagar (cc06/cc08) ──▶ pólizas P/* (estructura PEND)         Planilla ──▶ póliza `PLA` (PEND)
        │
        ▼
 Contabilidad (co01..co06) ──▶ diario · mayor · balances · libros de IVA / ASISTE LIBROS
```
| Relación | Hecho | Etiqueta |
|---|---|---|
| Factura → póliza automática por parametrización `f10` (reutilizada por CxC, notas y anticipos) | Observado | CEM |
| Recibo → tránsito → depósito (dos pólizas) o cobro directo en Bancos | Observado | CEM |
| Aplicaciones (`cc03`) referencian la factura (573 de 579 enlazadas) | Observado | CEM |
| Orden temporal entre registro, póliza y conciliación; qué módulo es «dueño» del saldo bancario | **PEND** | PEND |
| Planilla ↔ Bancos ↔ Contabilidad | **PEND** | PEND |
| CxP ↔ Bancos ↔ Contabilidad (estructura de `P/*`) | **PEND** | PEND |
| Plataforma → Milenium (viaje/factura/clientes) y Milenium → plataforma (número, cobro, saldo) | Hoy **manual** (INF; validar) | INF |

### 12.2 Preguntas
| ID | Pregunta | Etiqueta |
|---|---|---|
| REL-Q01 | ¿Qué dato se digita dos veces (viaje→factura, número→plataforma, cobro→plataforma, empleado→planilla)? | PEND |
| REL-Q02 | ¿Qué módulo es la fuente de verdad del saldo de un cliente y del saldo bancario? | PEND |
| REL-Q03 | ¿Qué cierres obligan un orden (conciliar antes de cerrar el mes, pagar planilla antes de contabilizar)? | PEND |
| REL-Q04 | ¿Qué procesos corren fuera de Milenium (Excel, correo, formularios) y alimentan o consumen sus datos? | PEND |

---

## 13. J. BALANZA / ESTADOS FINANCIEROS (solo documentar; **no** implementar)

| Hallazgo | Etiqueta | Fuente |
|---|---|---|
| Existen balance de saldos, balance general, estado de resultados (también por centro de costo), comparativos, ejecución de presupuesto y origen y aplicación de fondos | CEM (menú) | AUD §9, §14 |
| Cierres anuales y reportes tipo cierre; «Impresión de partidas de cierre»; rol «Administrador financiero» | CEM | AUD §9 |
| ¿Cuáles usan realmente? ¿períodos, acumulación y cierre? ¿quién los entrega y a quién? | **PEND** | — |

| ID | Pregunta | Etiqueta |
|---|---|---|
| BAL-Q01 | ¿Qué estados financieros se emiten y con qué periodicidad? ¿quién los recibe (contador externo, auditor, banco, SAT)? | PEND |
| BAL-Q02 | ¿Cómo acumulan (mes, trimestre, año)? ¿comparativos? | PEND |
| BAL-Q03 | ¿Cómo hacen el cierre anual y qué pólizas genera? | PEND |
| BAL-01 | **Caso:** balance de comprobación de un mes: *[registrar saldos iniciales, movimientos, saldos finales de 5 cuentas (una por tipo)]*; verificar Σ debe = Σ haber. | PEND |

---

## 14. Decisiones confirmadas

| # | Decisión | Etiqueta | Fecha / fuente |
|---|---|---|---|
| D1 | Milenium es el **ERP administrativo/contable principal** y se usa para control de pagos de planilla, contabilidad general, libro diario, libro mayor, CxC, CxP, facturación y bancos | CPU | 2026-10-15 |
| D2 | **Coexistencia y transición gradual**; no se reemplaza Milenium de golpe | CPU | 2026-10-15 |
| D3 | La integración directa con **INFILE queda pausada** | CPU | 2026-10-15 |
| D4 | RRHH operativo (empleados, asistencia, vacaciones, incidencias, horas extra) está en plataforma; **no** sustituye el pago/contabilización de planilla de Milenium | CPU | 2026-10-15 |
| D5 | `TIPO_CTA` 1 Activo · 2 Pasivo · 3 Capital · 4 Ingreso · 5 Gasto | CPU (Contabilidad) | 2026-10-12 |
| D6 | Crédito → D Clientes; contado → D Banco directo **solo con pago confirmado** | CPU (Contabilidad) | 2026-10-12 |
| D7 | Retención de IVA: calcular desde el inicio y verificar después en SAT; el porcentaje **depende del cliente** | CPU (Contabilidad) | 2026-10-12 |
| D8 | Factura con registro contable que se anula: **reversar** (aunque pasen meses); la NC también produce efecto contable | CPU (Contabilidad) | 2026-10-12 |
| D9 | Existe (o se puede crear) una cuenta separada de **ventas de bienes** (código pendiente) | CPU (Contabilidad) | 2026-10-12 |
| D10 | Un solo motor común para KT y Mónaco; diferencias = **parametrización por entidad** | CPU | regla de proyecto |
| D11 | No generar póliza contable hasta un **hito fiscal real** de certificación | CPU | PR C |

## 15. Pendientes (ordenados por lo que bloquea)

| # | Pendiente | Bloquea | Cómo cerrarlo |
|---|---|---|---|
| P1 | **Fórmula exacta del saldo de una factura** (CxC) | Cualquier vista de cartera/estado de cuenta | CXC-01…CXC-13 con facturas reales |
| P2 | **Flujo de planilla completo** (cálculo / pago / póliza) | Cualquier decisión de RRHH ↔ Milenium | PLA-Q01…Q18, PLA-01…PLA-10 |
| P3 | Fecha base de antigüedad y vencimiento | Estado de cuenta, antigüedad | CXC-Q02, Q08, CXC-09 |
| P4 | Mecánica de rangos de retención a proveedores | CxP | CXP-Q06, CXP-03 |
| P5 | Semántica de `TIPOTR` y de `R/E/C/D/A` | Bancos y CxC | BAN-Q03, CXC-Q11 |
| P6 | Método de redondeo del IVA (línea vs. total) | Cualquier cálculo fiscal | IMP-02, CON-02 |
| P7 | Signo y presentación del mayor por tipo de cuenta | Mayor / balanza | MAY-01…MAY-07 |
| P8 | Reversos y correcciones en todos los módulos | Cualquier automatización | CXC-10, CXC-11, BAN-04, CON-07, PLA-10 |
| P9 | Fuente maestra del cliente (NIT / razón social) | Sincronización de clientes | REL-Q02 |
| P10 | Tipo de póliza por origen (`003` vs. `004`) | Póliza automática futura | CON-Q01 |
| P11 | Qué se digita dos veces (D1–D6 del documento M-1) | M-2 y M-3 | REL-Q01 |
| P12 | Valores permitidos de retención (¿80 %? ¿cualquier entero?) | Facturación de retención | Contabilidad (HOM §14 #4) |

## 16. Contradicciones y alertas

| ID | A dice | B dice | Resolución propuesta | Estado |
|---|---|---|---|---|
| CT-01 | **M-1 §2/§4** describía RRHH como «operativo» (empleados, asistencia, vacaciones, incidencias, horas extra) y daba a Milenium el pago de planilla | **El código** de plataforma **sí** tiene un módulo de **planillas** (generar, autorizar, ISR/IGSS, marcar pagos, exportar) | **Posible doble cálculo/pago.** Averiguar en PLA-Q01/Q02 qué se usa realmente en cada sistema antes de cualquier decisión de maestro | ABIERTA |
| CT-02 | **Auditoría** (AUD §9): «la planilla vive en SITSA/RRHH» | **Usuario**: Milenium se usa para control de pagos de planilla | Prevalece el usuario (ya corregido en #467); el detalle sigue PENDIENTE | PARCIAL |
| CT-03 | **Ejemplo conceptual del encargo**: factura Q10,000 con **retención Q1,500** | **Regla empírica CEM**: la retención es **15 % del IVA** (≈ Q160.71 sobre Q10,000) | El ejemplo es ilustrativo; **no** usar Q1,500 como caso real. Calibrar con facturas reales (CXC-02, IMP-03) | ABIERTA |
| CT-04 | **FCM §D.2/D.3**: pólizas de venta llevan tipo `004 CUENTA POR COBRAR` | `co05` define `003 FACTURACION` para ese fin | Confirmar intención (CON-Q01) | ABIERTA |
| CT-05 | **AUD §8**: anulaciones en `f61`: 930 (KT) | **AUD §21**: «816 FEL en KT» | Probable diferencia de criterio (anulaciones vs. documentos); no usar cifras sin aclarar | ABIERTA |
| CT-06 | **FCM §H.1** (Mónaco): retenciones 15 % (497), 30 % (23), 53 sin patrón | **RET** (KT): 15 / 30 / **80** %, y otros (340 casos) | Varía por entidad y cliente; ya confirmado «depende del cliente». Valores permitidos siguen PENDIENTE | ABIERTA |
| CT-07 | **Plataforma `fact_pagos`**: saldo informativo de la factura | **Milenium**: saldo derivado de aplicaciones | No es contradicción de datos, sino de **fuente**: usar rótulo «registrado en plataforma» (M-1 §4) | CONOCIDA |

## 17. Fuente maestra por dato

| Dato | Maestro **actual** | Maestro **futuro posible** | Etiqueta del «actual» |
|---|---|---|---|
| RRHH operativo (empleados, asistencia, vacaciones, incidencias, horas extra) | **Plataforma** | Sin decisión del usuario | CPU |
| Planilla: cálculo | **PEND** (¿Milenium? ¿plataforma? ¿Excel?) | Sin decisión del usuario | PEND |
| Pago de planilla | **Milenium** | Sin decisión del usuario | CPU |
| Contabilización de planilla | **Milenium** (tipo `PLA`; detalle PEND) | Sin decisión del usuario | CPU / PEND |
| Contabilidad oficial (catálogo, pólizas, libros) | **Milenium** | Sin decisión del usuario | CPU |
| Libro diario / libro mayor | **Milenium** | Sin decisión del usuario | CPU |
| Viajes, rutas, tarifas, cargos | **Plataforma** | Sin decisión del usuario | CEC |
| Liquidación de viaje y resumen comercial | **Plataforma** | Sin decisión del usuario | CEC |
| Factura fiscal (serie, número, autorización, XML) | **Milenium/certificador** | Sin decisión del usuario (INFILE directo pausado) | CEM |
| Borrador y líneas de factura (preparación) | **Plataforma** | Sin decisión del usuario | CEC |
| CxC legal (saldo, aplicaciones) | **Milenium** | Sin decisión del usuario | CPU |
| CxC informativa (registrada en plataforma) | Plataforma (derivada) | Sin decisión del usuario | CEC |
| CxP legal | **Milenium** | Sin decisión del usuario | CPU |
| Requerimientos de compra y proveedores | **Plataforma** (Milenium CxP: PEND) | Sin decisión del usuario | CEC / PEND |
| Fondos, gastos, anticipos operativos | **Plataforma** | Sin decisión del usuario | CEC |
| Bancos (movimientos, conciliación) | **Milenium** | Sin decisión del usuario | CPU |
| Retenciones aplicadas (constancias) | **Milenium** | Sin decisión del usuario | CEM |
| Catálogo de clientes (fiscal) | **PEND** (Milenium `cc01` vs. plataforma) | Sin decisión del usuario | PEND |
| Catálogo de cuentas | **Milenium** (homologado parcialmente en plataforma) | Sin decisión del usuario | CEM / CEC |

> **No se cambia ningún «maestro futuro» sin decisión expresa del usuario.** La columna queda en «Sin decisión» hasta cerrar la calibración.

## 18. Implicaciones para las fases siguientes (M-2 en adelante)

| Fase | Qué requiere de este levantamiento | Qué NO se puede hacer todavía |
|---|---|---|
| **M-2** (estado de cuenta / pendientes / pagadas, solo lectura) | P1 (saldo exacto), P3 (fecha base), P11 (qué se digita dos veces) | Mostrar «cartera legal» o antigüedad con fecha base supuesta |
| **M-3** (referencia externa de factura por viaje) | Qué campos identifican una factura en Milenium (serie/número/autorización) y quién la digita; control de duplicados | Marcar como «facturado» sin la referencia verificada |
| **M-4** (hoja de facturación por viaje) | P6 (redondeo), descripciones por cliente (P-C1…P-C3) | Definir IVA o «total factura» |
| **M-5** (clientes por archivo) | P9 (maestro del cliente) | Sobrescribir datos fiscales |
| **Planilla** (cualquier fase) | **P2 completo** + CT-01 resuelta | Migrar, duplicar o calcular planilla «equivalente» a Milenium |
| **Cobros / retenciones / NC** | P1, P5, P8, P12, hito fiscal real | Registrar cobros con efecto contable |
| **Contabilidad / diario / mayor** | P7, P8, P10, CON-Q03/Q04 | Generar pólizas o libros paralelos |

**Reglas que se mantienen:** (1) ninguna fase P3 comienza sin al menos **tres casos CONFIRMADOS** por módulo; (2) toda fórmula nueva
se prueba contra los casos de este documento; (3) cada hallazgo queda etiquetado; (4) la plataforma no escribe en las bases de Milenium.

## 19. Qué falta recoger (lista de trabajo para las entrevistas)

| Módulo | Ejemplos numéricos que hacen falta (mínimo) |
|---|---|
| CxC | 1 factura con 2+ pagos; 1 con retención; 1 con NC parcial; 1 con anticipo; 1 con sobrepago; 1 anulada con aplicaciones; antigüedad de saldos de un cliente con 3 facturas |
| CxP | 1 factura con pago parcial; 1 con retención ISR por cada rango (2,500–30,000 y > 30,000); 1 factura especial; 1 NC de proveedor; 1 cheque anulado |
| Bancos | 1 conciliación mensual completa; 1 depósito con tránsito; 1 cobro directo; 1 comisión; 1 movimiento sin aplicación |
| Planilla | Los 6 empleados de §7.5 (sin incidencias, horas extra, falta, vacaciones, préstamo/anticipo, ISR) en **un** período real, con póliza y pago |
| Contabilidad | 1 póliza de venta, 1 de cobro, 1 de compra, 1 de pago, 1 de planilla, 1 manual, 1 corregida/rehabilitada |
| Diario / Mayor | 1 día de diario; 5 cuentas (una por tipo) de un mes con saldo inicial y final |
| Impuestos | 3 líneas con IVA que expongan redondeo; 1 retención por cada porcentaje en uso; 1 liquidación mensual de IVA |

## 20. Evidencia y trazabilidad

- **Documentos:** AUD, FCM, HOM, INV, RET (§0); [`FACTURACION-VIAJES-FASE1`](FACTURACION-VIAJES-FASE1.md);
  [`RRHH-PLANILLAS-DISENO-FISCAL-MINIMO`](RRHH-PLANILLAS-DISENO-FISCAL-MINIMO.md);
  [`RRHH-PLANILLAS-APORTES-PATRONALES-HALLAZGO`](RRHH-PLANILLAS-APORTES-PATRONALES-HALLAZGO.md).
- **Código revisado (solo lectura):** `src/lib/rrhh/{planillas,horas-extra,config,contratos-pago}.ts`, `src/lib/facturacion/facturas.ts`,
  `src/lib/contabilidad/*`, `sql/schema.sql` (tablas `rrhh_planilla_*`, `cont_*`, `fact_*`).
- **No revisado en esta fase:** ninguna copia de Milenium, ninguna base de producción, ninguna credencial. Los CEM provienen de las
  auditorías previas y **no** fueron re-verificados.
