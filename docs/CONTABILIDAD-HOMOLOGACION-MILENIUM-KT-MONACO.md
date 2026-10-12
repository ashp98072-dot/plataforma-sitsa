# Homologación contable Milenium → plataforma — KuiqTrans y Logiservicios Mónaco

> **Fase:** discovery + propuesta. **No** ejecuta SQL, **no** crea cuentas, **no** genera pólizas, **no** modifica FACT-4 ni producción.
> **Referencia funcional:** Milenium (copia local `Milenium2000`, datos hasta 2026-05-27). **Alcance:** `empresa_id = 1`, entidad 1 = KT / KuiqTrans, entidad 2 = MONACO / Logiservicios Mónaco.
> **Archivos asociados:** `sql/preflight-2026-10-contabilidad-homologacion-milenium.sql` (solo lectura) y `sql/propuesta-2026-10-contabilidad-homologacion-milenium.sql` (**inventario y patrón de carga, sin ningún `INSERT` ejecutable**: bloqueado por la aprobación del `tipo`).

## 0. Método y límites

- **Solo lectura y análisis estático.** Los DBF/FPT se leyeron con un lector propio (`open(..., 'rb')`); **no** se ejecutó ningún EXE/DLL de Milenium, **no** se escribió en la copia ni se copió ningún dato al repositorio. Los programas de Milenium (`sistema.EXE`, `*.app`) están compilados: no hay `.PRG` fuente; los parámetros se leen de las **tablas** (`f10`, `f12`, `f50`, `cc15`, `cc17`, `b02`, `co01`).
- **Mapa de empresas** (`s02.dbf`): `01` = TRANSPORTES SITSA KUIQ TRANS (**KT**, `BASES001`); `08` = LOGISERVICIOS MONACO (**Mónaco actual**, `BASES008`, desde 2023-09); `00` = LOGISERVICIOS MONACO S.A. (**Mónaco histórico**, `BASES000`, 2021-07 → 2023-10 — la **misma** entidad Mónaco; ya resuelto en C2).
- **Privacidad:** sin NIT, nombres de clientes, importes individuales ni números de cuenta bancaria. Los nombres de las cuentas bancarias del catálogo **incluyen** el número de cuenta; aquí aparecen enmascarados (`#####`). Los importes son **relativos** (% del total de la factura).
- **Certeza:** `[CONFIRMADO]` = leído directamente de los datos de Milenium (o confirmado por Contabilidad en este proyecto) · `[INFERENCIA]` = deducido de forma consistente con los datos, no declarado · `[PENDIENTE CONTABILIDAD]` = requiere decisión o aprobación humana. **La evidencia histórica no se convierte en regla futura** sin confirmación.
- **Volumen leído:** KT — 658 cuentas, 60 544 pólizas (196 002 líneas), 12 529 facturas; Mónaco actual — 618 cuentas, 4 944 pólizas, 721 facturas; Mónaco histórico — 574 cuentas, 1 346 pólizas.

## 1. Resumen ejecutivo

1. **Existen los parámetros contables de ventas y son los mismos códigos en las tres bases** (`f10`): CLIENTES `11203001`, IVA POR PAGAR `21401001`, VENTAS DE SERVICIOS `41101003`, ANTICIPO DE CLIENTES `21302001`, «caja» = **TRASLADO EN TRANSITO** `11101002`, DEVOLUCIONES `41501002`. `[CONFIRMADO]`
2. **Mismo código ≠ misma cuenta.** KT y Mónaco comparten 615 códigos, pero **51 tienen nombre distinto** y los bancos son **cuentas físicas distintas** bajo el mismo código (`11103002`). Se homologan por entidad, nunca por código solo. `[CONFIRMADO]`
3. **Hay 5 diferencias entre Milenium y las reglas confirmadas por Contabilidad** (§5): contado, momento de la retención, % de retención, reverso por anulación y ventas de bienes. **No se cambió código**; quedan documentadas para decisión.
4. **La plataforma ya soporta** empresa, entidad, código, nombre, tipo, nivel y activa en `cont_cuentas`. **No soporta** cuenta padre, naturaleza, movimiento/agrupación, ni parametrización por rol (§6). **No se creó un catálogo paralelo.**
5. La jerarquía y la naturaleza **sí se pueden derivar con certeza** del catálogo (`LARGO_CTA` por nivel 1·2·4·6·8; `MULTIP_CTA` ↔ tipo), lo que desbloquea el diseño de importación cuando Contabilidad lo apruebe (§3.2).
6. La cuenta de prueba KT `32234 / safdasf` se revisó con un preflight de solo lectura (§7). Mónaco no tiene cuentas.
7. El inventario propuesto es de **10 cuentas KT y 8 Mónaco** con entidad, código, nombre y nivel **confirmados** (§8). **La fila de `cont_cuentas` aún no está aprobada:** el `tipo` (traducción de `TIPO_CTA`) es inferencia pendiente de Contabilidad, así que **no hay `INSERT` ejecutable** en la propuesta; la carga queda comentada y bloqueada (§8).

## 2. Mapas contables por entidad

Columnas: rol funcional · código Milenium · nombre · naturaleza · nivel / padre · fuente · certeza · observaciones.
**Naturaleza** (`MULTIP_CTA`): `1` = deudora, `-1` = acreedora — `[INFERENCIA fuerte]`: coincide al 100 % con el tipo (1 y 5 → `1`; 2, 3 y 4 → `-1`) en las tres bases (§3.2). **Padre** = ancestro de nivel inmediato superior por prefijo de código (`[CONFIRMADO]`, §3.2).

### A) KUIQTRANS (entidad 1 — Milenium empresa 01)

| Rol | Código | Nombre en Milenium | Naturaleza | Nivel / padre | Fuente de evidencia | Certeza | Observaciones |
|---|---|---|---|---|---|---|---|
| CLIENTES | `11203001` | CLIENTES LOCALES | deudora | 5 / `11203000` CUENTAS POR COBRAR CLIENTES | `f10.CUECLI_FPV`; D en el 97.2 % de 10 740 pólizas F/1 | **CONFIRMADO** | También D de la factura **al contado** (§4.B). 17 340 líneas 2017-09 → 2026-05 |
| IVA_POR_PAGAR | `21401001` | IVA POR PAGAR | acreedora | 5 / `21401000` IMPUESTOS POR PAGAR | `f10.CUEIXP_FPV`; H de cada factura gravada | **CONFIRMADO** | 10.71 % del total con IVA (=12/112) en 10 393 de 10 452 facturas |
| VENTAS_SERVICIOS | `41101003` | VENTAS DE SERVICIOS | acreedora (ingreso) | 5 / `41101000` VENTAS DE MERCADERIA | `f10.CUEVEN_FPV`; H de cada factura | **CONFIRMADO** | 89.29 % del total. El padre se llama «de mercadería» (es el catálogo de Milenium) |
| VENTAS_BIENES | — | — | — | — | `f10` **no** parametriza ventas de bienes (`CUEVEI_FPV` vacío) | **PENDIENTE CONTABILIDAD** | Candidatas (`[INFERENCIA]`): `41101001` VENTAS DE MERCADERIA (1 póliza histórica), `41101002` VENTAS VARIAS |
| RETENCION_IVA | `11302005` | RETENCIONES DE IVA | deudora (**activo**) | 5 / `11302000` IMPUESTOS POR COBRAR | D en el 84.0 % de las 2 239 aplicaciones C/E y en 695 recibos C/R; 2 683 líneas | **CONFIRMADO** | Se registra **después** de la factura (§4.C, §5). Tratada como **activo** (crédito fiscal) |
| ANTICIPOS (de clientes) | `21302001` | ANTICIPO DE CLIENTES MONEDA LOCAL | acreedora | 5 / `21302000` ANTICIPO DE CLIENTES | `f10.CUANSV_FPV`; 763 líneas | **CONFIRMADO** | H al recibir anticipo (B/1, B/3); D al aplicarlo (C/R 2.6 %) |
| TRANSITO_BANCARIO | `11101002` | TRASLADO EN TRANSITO | deudora | 5 / `11101000` CAJA | `f10.CUECAJ_FPV` (**es la «cuenta de caja»** de ventas); 8 658 líneas | **CONFIRMADO** | D del recibo (C/R 76 %); H del depósito (B/3). El «banco» llega **después** (§4.E-F) |
| DEVOLUCIONES_VENTAS | `41501002` | DEV. SOBRE VENTAS VARIAS | acreedora (contra-ingreso, tipo 4) | 5 / `41501000` DEV. SOBRE VENTAS DE MERCADERIA | `f10.CUGANC_FPV`; D de toda nota de crédito (124 de 124 C/C) | **CONFIRMADO** | La plataforma aún no maneja notas de crédito contables |
| BANCOS | `11103002` | BANCO INDUSTRIAL, S. A. DM ##### | deudora | 5 / `11103000` DEPOSITOS BANC. MONEDA NACIONAL | `b02` 0001; 19 206 líneas 2019-05 → 2026-05 | **CONFIRMADO** | Cuenta principal (B/5: 72.8 % de los depósitos de clientes) |
| BANCOS | `11103001` | G&T CONTINENTAL - ##### | deudora | 5 / `11103000` | `b02` 0002; 5 238 líneas → 2026-05 | **CONFIRMADO** | 26.1 % de los depósitos de clientes |
| BANCOS (fondo) | `11103004` | BANCO INDUSTRIAL (FONDO OPERATIVO) ##### | deudora | 5 / `11103000` | `b02` 0005; 1 150 líneas 2023-12 → 2026-04 | **CONFIRMADO** | Fondeo de caja chica operativa; no recibe cobros de clientes |
| BANCOS (inactiva) | `11103006` | G&T CONTINENTAL - ##### | deudora | 5 / `11103000` | `b02` 0003; último movimiento 2023-06 | **PENDIENTE CONTABILIDAD** | ¿Cuenta cerrada? Sin movimientos 3 años |
| CAJA (efectivo) | `11101001` | CAJA GENERAL | deudora | 5 / `11101000` CAJA | `b02` 0004 (tipo 3); 78 líneas 2022-07 → 2023-06 | **PENDIENTE CONTABILIDAD** | Sin uso reciente |
| PROVISION_RETENCION_IVA | `21301007` | PROVISION RETENCIONES DE IVA | acreedora | 5 / `21301000` RETENCIONES | 31 líneas desde 2024-11 (en C/E) | **PENDIENTE CONTABILIDAD** | Uso residual: ¿qué la origina? |
| RETENCION_ISR (cliente) | `11302006` | RETENCIONES DE ISR | deudora | 5 / `11302000` | **0 movimientos** | **PENDIENTE CONTABILIDAD** | ISR retenido por clientes: pendiente (decisión de negocio) |
| ISR_POR_PAGAR | `21401002` | ISR POR PAGAR (EMPRESA) | acreedora | 5 / `21401000` | `f10.CUEISP_FPV`; 2 líneas | **PENDIENTE CONTABILIDAD** | No usada en el flujo de venta |
| OTROS_INGRESOS | `41201001` | OTROS INGRESOS | acreedora | 5 / `41201000` | `f10.CUINND_FPV`; 6 líneas | **PENDIENTE CONTABILIDAD** | — |
| VENTAS_ESPECIALES / EXENTAS | `41101004` / `41101006` | VENTAS DE SERVICIOS ESPECIALES / VENTAS EXENTAS | acreedora | 5 / `41101000` | 11 y 2 líneas | **PENDIENTE CONTABILIDAD** | `41101004` tiene **otro nombre en Mónaco** |

### B) LOGISERVICIOS MÓNACO (entidad 2 — Milenium empresas 08 actual y 00 histórico)

| Rol | Código | Nombre en Milenium | Naturaleza | Nivel / padre | Fuente de evidencia | Certeza | Observaciones |
|---|---|---|---|---|---|---|---|
| CLIENTES | `11203001` | CLIENTES LOCALES | deudora | 5 / `11203000` | `f10.CUECLI_FPV` (08 y 00); D en el 99.5 % de 616 F/1 | **CONFIRMADO** | 1 271 líneas 2023-08 → 2026-05 |
| IVA_POR_PAGAR | `21401001` | IVA POR PAGAR | acreedora | 5 / `21401000` | `f10.CUEIXP_FPV`; 674 líneas | **CONFIRMADO** | 10.71 % del total |
| VENTAS_SERVICIOS | `41101003` | VENTAS DE SERVICIOS | acreedora | 5 / `41101000` | `f10.CUEVEN_FPV`; 645 líneas | **CONFIRMADO** | — |
| VENTAS_BIENES | — | — | — | — | `f10` sin cuenta de bienes | **PENDIENTE CONTABILIDAD** | Igual que KT |
| RETENCION_IVA | `11302005` | RETENCIONES DE IVA | deudora (activo) | 5 / `11302000` | D en el 85.0 % de 360 C/E; 340 líneas | **CONFIRMADO** | Mismo patrón que KT (§4.C) |
| ANTICIPOS | `21302001` | ANTICIPO DE CLIENTES MONEDA LOCAL | acreedora | 5 / `21302000` | `f10.CUANSV_FPV`; 6 líneas | **CONFIRMADO** | Uso muy bajo |
| TRANSITO_BANCARIO | `11101002` | TRASLADO EN TRANSITO | deudora | 5 / `11101000` | `f10.CUECAJ_FPV`; 227 líneas; 100 % de los 95 C/R | **CONFIRMADO** | — |
| DEVOLUCIONES_VENTAS | `41501002` | DEV. SOBRE VENTAS VARIAS | acreedora | 5 / `41501000` | `f10.CUGANC_FPV`; 6 de 6 C/C | **CONFIRMADO** | — |
| BANCOS | `11103002` | BANCO INDUSTRIAL, S. A. DM ##### | deudora | 5 / `11103000` | `b02` 0001 y 0002 (**ambos** a esta cuenta); 2 032 líneas | **CONFIRMADO** | **Único** banco de Mónaco con movimiento. **Cuenta física distinta a la de KT** (número distinto, mismo código) |
| BANCOS (sin uso) | `11103004` / `11103001` / `11103006` | BANCO INDUSTRIAL (AHORRO) / G&T… | deudora | 5 / `11103000` | **0 movimientos** | **PENDIENTE CONTABILIDAD** | Heredadas del catálogo; no operar |
| CAJA | `11101001` | CAJA GENERAL | deudora | 5 / `11101000` | solo en el histórico (`00`, «EFECTIVO», tipo 3) | **PENDIENTE CONTABILIDAD** | Sin movimientos en la base actual |
| PROVISION_RETENCION_IVA | `21301007` | PROVISION RETENCIONES DE IVA | acreedora | 5 / `21301000` | 7 líneas 2025 | **PENDIENTE CONTABILIDAD** | — |
| RETENCION_ISR / ISR_POR_PAGAR | `11302006` / `21401002` | RETENCIONES DE ISR / ISR POR PAGAR (EMPRESA) | deudora / acreedora | 5 | **0 movimientos** | **PENDIENTE CONTABILIDAD** | ISR pendiente |
| VENTAS_ESPECIALES / EXENTAS | `41101004` / `41101006` | VENTAS DE **TRATAMIENTO** / VENTAS EXENTAS | acreedora | 5 / `41101000` | 0 y 3 líneas | **PENDIENTE CONTABILIDAD** | `41101004`: **KT = «ESPECIALES», Mónaco = «TRATAMIENTO»** (distinta cuenta con el mismo código) |

**Parámetros por cliente y por ruta (`cc01`, `f01`):** ningún cliente tiene cuenta propia distinta de la general (los pocos con `CUECLI`/`CUEVEN` apuntan a los mismos `11203001`/`41101003`); las rutas no definen cuentas (`CUEVEN_RUT` vacío). → una sola cuenta por rol y entidad. `[CONFIRMADO]`

## 3. Catálogo de cuentas (`co01`)

### 3.1 Comparación KT ↔ Mónaco `[CONFIRMADO]`

| | KT (01) | Mónaco actual (08) | Mónaco histórico (00) |
|---|---|---|---|
| Cuentas | 658 | 618 | 574 |
| Códigos comunes KT ∩ Mónaco | 615 | 615 | — |
| Solo en esa entidad | 43 | 3 | — |
| Comunes con **nombre distinto** | 51 (p. ej. proveedores y préstamos con nombres propios, `41101004`, `11103004`) | | |
| Comunes con tipo/nivel/multip distinto | **0** | | |

Los 43 códigos solo-KT incluyen cuentas de **partes relacionadas** (p. ej. «LOGISERVICIOS MONACO» como cliente `11203010`); Mónaco tiene su contraparte («TRANSPORTES SITSA KUIQ TRANS») bajo **otros** códigos (`11203008`, `21151012`). Es la razón por la que **no** se puede copiar un catálogo al otro.

### 3.2 Estructura: jerarquía, naturaleza, movimiento

| Tema | Hallazgo | Certeza |
|---|---|---|
| **Longitud del código** | 8 caracteres en el 100 % de las cuentas de las 3 bases. Se conserva como texto (hay ceros iniciales) | **CONFIRMADO** |
| **Jerarquía** | `LARGO_CTA` = 1, 2, 4, 6, 8 para los niveles 1–5. El código de cada nivel es el **prefijo + ceros**; el padre es el ancestro de nivel anterior cuyo prefijo coincide. **0 excepciones y 0 cuentas sin padre único** en las 3 bases (p. ej. `11203001` → `11203000` → `11200000` → `11000000` → `10000000`) | **CONFIRMADO** |
| **Cuentas de movimiento** | Las cuentas con movimiento en pólizas son de **nivel 5** (KT 283, Mónaco 126), más 1 de nivel 4 por entidad (en KT, `93010100 INTERESES`). `CTACOM_CTA` es `false` en el 100 % (no discrimina) | **INFERENCIA** (nivel 5 = movimiento; excepción nivel 4) |
| **Tipo (`TIPO_CTA`)** | 1 = ACTIVO, 2 = PASIVO, 3 = INVERSIÓN DE LOS ACCIONISTAS (capital), 4 = INGRESOS (ventas y otros ingresos), 5 = COSTOS Y GASTOS (costo de ventas, administración, otros gastos). Verificado contra los nombres de las 8 cuentas de nivel 1 y los prefijos de código | **INFERENCIA fuerte** → **PENDIENTE CONTABILIDAD** (aprobación del diccionario) |
| **Naturaleza (`MULTIP_CTA`)** | `1` en tipos 1 y 5; `-1` en tipos 2, 3 y 4, **sin una sola excepción** en las 3 bases. Es la naturaleza deudora/acreedora esperada | **INFERENCIA fuerte** → **PENDIENTE CONTABILIDAD** |
| **Activa (`LINACTIVA_`)** | `false` (activa) en el 100 % | **CONFIRMADO** (dato); significado de «inactiva» pendiente |
| **Cuenta alterna (`CODALT_CTA`)** | vacío en el 100 % | **CONFIRMADO** |
| **Mapeo a plataforma** | tipo 1 → `Activo`, 2 → `Pasivo`, 3 → `Capital`, 4 → `Ingreso`, 5 → `Gasto` (los 5 valores de `cont_cuentas.tipo`). Las devoluciones (tipo 4) quedan como `Ingreso` porque el enum no tiene contra-cuentas | **INFERENCIA** |

## 4. Pólizas históricas (patrones reales, importes **relativos**)

Notación: **D** = Debe, **H** = Haber; `100 %` = total de la factura con IVA. Origen en Milenium: `F/1` facturación, `C/R` recibo, `C/E` aplicación directa (retención), `C/C` nota de crédito, `B/3` depósito, `B/5` depósito aplicado a cliente. Una póliza se enlaza a su factura por `SERIED + NUMERO` (`f06` ↔ `co03`).

### A) Crédito sin retención — `[CONFIRMADO]`
`F/1`, vigentes crédito con el patrón estándar: KT 5 620 · Mónaco 413. Ese patrón cubre el **97–99.5 %** de las pólizas de facturación:
- **D** `11203001` CLIENTES LOCALES — 100 %
- **H** `21401001` IVA POR PAGAR — 10.71 %
- **H** `41101003` VENTAS DE SERVICIOS — 89.29 %

Coincide con la regla confirmada por Contabilidad. Variantes minoritarias: solo ventas `41101003` sin IVA (5 KT, 1 Mónaco), exenta `41101006` (1 KT, 2 Mónaco), especiales `41101004` (11 KT), y 283 pólizas KT 2017-09 → 2019-06 de facturas **exentas** que postean `D CLIENTES / H CLIENTES` por el mismo importe (autocompensadas; no hay ventas ni IVA).

### B) Contado sin retención — `[CONFIRMADO]` · **DIFIERE de lo confirmado por Contabilidad**
`F/1`, vigentes contado: KT 4 821 · Mónaco 211. **La póliza es idéntica a la de crédito: D CLIENTES, no D BANCO.** El cobro llega después, por dos caminos:
1. **Recibo** `C/R`: **D** `11101002` TRASLADO EN TRANSITO 100 % / **H** `11203001` CLIENTES 100 % (KT 76.0 % de los C/R; Mónaco 100 %) y luego el **depósito** `B/3`: **D** `11103002`/`11103001` BANCO / **H** `11101002` TRASLADO EN TRANSITO (KT 66 %, Mónaco 53.6 % de los B/3).
2. **Depósito directo aplicado** `B/5`: **D** BANCO 100 % / **H** `11203001` CLIENTES 100 % (KT 547; Mónaco 181).

Para facturas «contado» de KT, los documentos que las aplican son: solo recibo (1 027), solo depósito `B/5` (939), recibo + retención (1 268), depósito + retención (959)… O sea, en Milenium «contado» es una **marca de la factura**, no un asiento distinto.

### C) Crédito con retención — `[CONFIRMADO]` · **DIFIERE en el momento**
La factura se postea igual que en (A). La retención se registra **después** como aplicación `C/E` (documento de cartera tipo `E`, con el número de la constancia):
- **D** `11302005` RETENCIONES DE IVA — **1.61 %** del total (= 15 % × 10.71 %)
- **H** `11203001` CLIENTES — 1.61 %

y el cobro del **neto** por recibo/depósito: **98.39 %** (suma = 100 %, mediana en KT y Mónaco). Demora factura → retención: **mediana 6 días (KT) y 4 días (Mónaco)**, p90 23 y 10 días.
Porcentaje observado (retención ÷ IVA de la factura, 3 613 retenciones KT y 510 Mónaco):

| % del IVA | KT | Mónaco |
|---|---|---|
| **15 %** | 2 950 (81.6 %) | 486 (95.3 %) |
| **30 %** | 311 (8.6 %) | 23 (4.5 %) |
| **80 %** | **340 (9.4 %)** | 0 |
| otros (10 %, 24 %, 60 %) | 10 | 1 |

### D) Contado con retención — `[CONFIRMADO]`
Igual que (C): factura `D CLIENTES` (contado) + `C/E` retención `D 11302005` + cobro del neto por recibo/depósito. En KT 2 076 retenciones sobre facturas contado; Mónaco 183.

### E) Cobro / recibo — `[CONFIRMADO]`
`C/R`: **D** `11101002` TRASLADO EN TRANSITO / **H** `11203001` CLIENTES (KT 2 587; Mónaco 95). Variantes: recibo que solo aplica retención `D 11302005 / H CLIENTES` (KT 695); aplicación de anticipo `D 21302001 / H CLIENTES` (KT 89).

### F) Depósito bancario — `[CONFIRMADO]`
`B/3`: **D** cuenta de banco / **H** `11101002` TRASLADO EN TRANSITO (cierra el tránsito; KT 3 840 BI + 512 G&T; Mónaco 105). Depósito de cliente sin recibo `B/5`: **D** banco / **H** CLIENTES. Anticipos: **D** banco / **H** `21302001` (`B/1`, `B/3`).

### G) Reverso / anulación — `[CONFIRMADO]` (evidencia) · **DIFIERE de lo confirmado por Contabilidad**
- **Facturas anuladas en Milenium (`ANULAD_CFA`): KT 1 787 (1 103 crédito + 684 contado) y Mónaco 94 — ninguna tiene póliza.** No existe una póliza de reverso: simplemente no hay asiento.
- La corrección de un documento ya certificado es una **nota de crédito** FEL (`C/C`): **D** `21401001` IVA POR PAGAR (10.71 %) + **D** `41501002` DEV. SOBRE VENTAS VARIAS (89.29 %) / **H** `11203001` CLIENTES 100 % (KT 124, Mónaco 6; 100 % de los casos). Hay 3 pólizas «REVERS» en KT y 2 en Mónaco; **ninguna es reverso de una factura** (en KT una revierte una provisión de retenciones contra IVA POR PAGAR; las demás son de compras/bancos).

### Comparación con las reglas confirmadas

| Caso | Regla confirmada por Contabilidad | Milenium (evidencia) | ¿Difiere? |
|---|---|---|---|
| Crédito | D CLIENTES · H VENTAS · H IVA | D CLIENTES · H IVA · H VENTAS | **No** |
| Contado | D BANCO · H VENTAS · H IVA | D **CLIENTES** · H IVA · H VENTAS, y el banco entra por recibo→tránsito→depósito o depósito directo | **Sí** |
| Retención | D RETENCIÓN IVA + D CLIENTE/BANCO neto · H VENTAS · H IVA, **en el mismo asiento** | D `11302005` / H CLIENTES en una póliza **posterior** (mediana 4–6 días); la factura va completa | **Sí** (momento y n.º de pólizas; **mismas cuentas y mismo neto**) |
| % retención | 0 %, 15 % o 30 % | 15 % y 30 % + 80 % (340 casos KT) | **Sí** |
| Anulación | Reverso contable exacto automático | Anulada = sin póliza; certificada = nota de crédito con cuenta de devoluciones | **Sí** |
| Ventas | SERVICIOS y BIENES separadas | Una sola cuenta de ventas de servicios en `f10` | **Sí** (falta cuenta de bienes) |

## 5. Contradicciones y decisiones pendientes (no se cambió código)

1. **CONTADO** — `[PENDIENTE CONTABILIDAD]` ¿La plataforma postea **D BANCO** directo en la factura (regla confirmada) o replica Milenium (D CLIENTES + cobro por tránsito)? Con la regla confirmada, el banco se carga sin pasar por CLIENTES ni TRASLADO EN TRANSITO, y la cartera nace ya cobrada.
2. **Momento de la retención** — `[PENDIENTE CONTABILIDAD]` Milenium la asienta cuando llega la **constancia** (días después). La regla confirmada la incluye en el asiento de la venta ("registrada inicialmente, constancia verificada después"). Hay que definir si la póliza de la factura ya lleva D RETENCIÓN IVA o si se genera al registrar la constancia.
3. **Porcentajes** — 340 retenciones KT al **80 %** del IVA (2021-2026; 107 en 2022 y 13 en 2025) no encajan en 0/15/30. `[PENDIENTE CONTABILIDAD]` ¿Agente especial? ¿Error de captura? ¿Retención parcial?
4. **Anulación** — `[PENDIENTE CONTABILIDAD]` Si la cuenta de reverso debe ser VENTAS/IVA (exacto) o DEVOLUCIONES + IVA (como la nota de crédito de Milenium); y qué ocurre con facturas anuladas **antes** de la póliza.
5. **Ventas de bienes** — `[PENDIENTE CONTABILIDAD]` Milenium no tiene cuenta; hay que definirla por entidad. Hasta entonces el motor debe **rechazar** una línea BIEN, no usar la de servicios.
6. **Facturas exentas** — 283 pólizas KT (2017-2019) con `D CLIENTES / H CLIENTES`: tratamiento histórico anómalo; la plataforma no modela exención en esta fase. `[PENDIENTE CONTABILIDAD]`
7. **Mismo código, distinta cuenta** — 51 códigos; usar siempre `(entidad, código)`. `[CONFIRMADO]`

## 6. Plataforma actual (`main` = `da441886`)

| Estructura | Soporte hoy | Observación |
|---|---|---|
| `cont_entidades` | KT (1) y MONACO (2), `UNIQUE(empresa_id, id)` | Ya parametrizan `fact_entidad_config` (plantilla) |
| `cont_cuentas` | `empresa_id`, `entidad_id` (FK compuesta), `codigo` VARCHAR(40), `nombre` VARCHAR(200), `tipo` (Activo/Pasivo/Capital/Ingreso/Gasto), `nivel`, `activa`; `UNIQUE(empresa, entidad, código)` | **Suficiente** para código/nombre/tipo/nivel. **Falta:** `padre`, `naturaleza`, `movimiento/agrupación`. Hoy cualquier cuenta activa de cualquier nivel puede usarse en un asiento |
| API de cuentas | `GET` y `POST` únicamente | **No hay edición ni desactivación por API**: desactivar o corregir una cuenta requiere SQL manual |
| `cont_asientos` / `cont_asiento_detalle` | `numero` (texto libre, único por entidad), `fecha`, `glosa`, `estado`; detalle `cuenta_id`, `debe`, `haber` | **Falta** tipo/grupo de póliza, **origen** (`origen_tipo/origen_id/evento` para idempotencia y reverso), glosa por línea |
| `registrarAsiento` | Valida cuadre al centavo, cuentas existentes/activas **de la misma empresa y entidad**, transacción y auditoría | Reutilizable tal cual; no genera número ni tipo de póliza |
| `cont_cxc` | `cliente` (texto), `documento`, `monto`, `saldo`, `estado` | **Sin vínculo** con `fact_facturas`/`clientes`; no sirve aún para aplicar cobros/retenciones |
| `cont_cuentas_bancarias` (FACT-4) | FK compuesta a `cont_cuentas`; `banco`, `alias`, `referencia`, `moneda`, `activa` | Vacía hoy; depende de homologar las cuentas primero |
| `fact_facturas` | `entidad_id`, `condicion_pago`, `cuenta_bancaria_id` (FK compuesta), retención congelada | Listo para consumir roles |
| Parametrización por rol | **No existe** | Solo `poliza-venta.ts` define roles (en código, sin cuentas) |

**No se crea catálogo paralelo:** la homologación escribe en `cont_cuentas` con la clave existente.

## 7. Cuenta de prueba KT `32234 / safdasf`

- **No se usa** en ninguna propuesta. El preflight (`sql/preflight-2026-10-contabilidad-homologacion-milenium.sql`, §4) **solo lee** y responde:
  1. la fila (id, tipo, nivel, activa);
  2. **todas** las FKs de la base que referencian `cont_cuentas` (descubiertas en `information_schema`, no supuestas);
  3. conteo de referencias reales: `cont_asiento_detalle` (por `cuenta_id`), `cont_cuentas_bancarias`, y las **blandas** (`fact_facturas.cuenta_bancaria_snapshot` JSON y `auditoria.detalle` texto);
  4. un veredicto: sin referencias duras → «puede desactivarse y, con autorización, eliminarse»; con referencias → «solo desactivar».
- **Referencias estructurales esperadas** (esquema en `main`): `cont_asiento_detalle` (2 FKs, `RESTRICT`) y `cont_cuentas_bancarias` (1 FK compuesta, `RESTRICT`). Ningún otro objeto del código referencia cuentas por columna (`cuenta_id` solo aparece en esos dos; el módulo de limpieza administrativa `limpiar-modulo.ts` borra `cont_cuentas` completa por empresa y **no** debe usarse para esto).
- **Desactivar/eliminar:** no hay API; requeriría SQL manual con autorización. En la propuesta solo aparece **comentado como decisión posterior**; **no** se desactiva ni borra nada en esta fase.
- Valor verificado en una base **desechable local** con la cuenta de prueba sembrada: el preflight ejecuta sin error y reporta 0 referencias duras y 0 blandas, con el veredicto «puede DESACTIVARSE y, con autorización, ELIMINARSE». **El resultado real de producción debe obtenerlo el responsable**, no se asumió.

## 8. Homologación propuesta (Milenium → `cont_cuentas`)

Reglas: conservar el código real; no inventar; no mezclar entidades; `empresa_id = 1`; KT `entidad_id = 1`; MONACO `entidad_id = 2`; `nivel` = `NIVEL_CTA`; `activa = 1`; `tipo`: **bloqueado** hasta que Contabilidad apruebe el diccionario de §3.2 (no se usa ningún valor provisional).

| Campo Milenium | Campo plataforma | Estado |
|---|---|---|
| `CODIGO_CTA` | `codigo` | **CONFIRMADO** (texto, ceros conservados) |
| `NOMBRE_CTA` | `nombre` | **CONFIRMADO** (Windows-1252 → Unicode; las bancarias **sin** número) |
| empresa 01 / 08+00 | `entidad_id` 1 / 2 | **CONFIRMADO** (C2) |
| `NIVEL_CTA` | `nivel` | **CONFIRMADO** (verbatim) |
| `TIPO_CTA` | `tipo` | **INFERENCIA fuerte — PENDIENTE CONTABILIDAD (bloqueante)** |
| `LINACTIVA_` | `activa` (invertido) | **CONFIRMADO** (100 % activas) |
| `MULTIP_CTA` | (sin columna) | futuro: naturaleza — **PENDIENTE** |
| `LARGO_CTA`/prefijo | (sin columna) | futuro: padre — **PENDIENTE** (derivable con certeza) |

**Estado de cada dato de la fila de `cont_cuentas`:**

| Dato | Estado |
|---|---|
| Entidad, código, nombre, nivel | **CONFIRMADO** (catálogo `co01` de cada entidad) |
| Rol observado (qué cuenta usa Milenium para cada función) | **CONFIRMADO** (`f10` + pólizas reales) |
| `tipo` (traducción `TIPO_CTA` → Activo/Pasivo/Capital/Ingreso/Gasto) | **PENDIENTE CONTABILIDAD — BLOQUEANTE** (inferencia fuerte, no aprobada) |
| Naturaleza formal (`MULTIP_CTA`) | **PENDIENTE CONTABILIDAD** |
| «Nivel 5 = cuenta de movimiento» como regla | **PENDIENTE CONTABILIDAD** |

Por tanto **las cuentas están identificadas, pero la fila productiva de `cont_cuentas` todavía no está completamente aprobada.** `cont_cuentas.tipo` es `NOT NULL`: sin la aprobación no existe un `INSERT` válido, y **no se escribe ningún valor provisional**.

**Inventario propuesto** (entidad, código, nombre, nivel — **sin `tipo`**; el detalle y la evidencia están en la sección 1 de `sql/propuesta-2026-10-contabilidad-homologacion-milenium.sql`, un `SELECT` de solo lectura):

| Código | Nombre | Rol observado | KT | Mónaco |
|---|---|---|---|---|
| `11203001` | CLIENTES LOCALES | CLIENTES | ✔ | ✔ |
| `21401001` | IVA POR PAGAR | IVA_POR_PAGAR | ✔ | ✔ |
| `41101003` | VENTAS DE SERVICIOS | VENTAS_SERVICIOS | ✔ | ✔ |
| `11302005` | RETENCIONES DE IVA | RETENCION_IVA | ✔ | ✔ |
| `21302001` | ANTICIPO DE CLIENTES MONEDA LOCAL | ANTICIPOS | ✔ | ✔ |
| `11101002` | TRASLADO EN TRANSITO | TRANSITO_BANCARIO | ✔ | ✔ |
| `41501002` | DEV. SOBRE VENTAS VARIAS | DEVOLUCIONES_VENTAS | ✔ | ✔ |
| `11103002` | BANCO INDUSTRIAL, S. A. | BANCOS | ✔ | ✔ |
| `11103001` | G&T CONTINENTAL | BANCOS | ✔ | — |
| `11103004` | BANCO INDUSTRIAL (FONDO OPERATIVO) | BANCOS | ✔ | — |

Total: **KT 10, Mónaco 8** (más la cuenta de prueba de KT, intacta). Lo pendiente (§2) está comentado. No se propone jerarquía (ancestros niveles 1–4) porque `cont_cuentas` no tiene `padre`: importar el árbol completo es la **siguiente decisión** (§9).

**Carga futura — falla cerrado.** Cuando Contabilidad apruebe el diccionario, se generará el SQL ejecutable definitivo y se revisará de nuevo. Patrón obligatorio (documentado, comentado, en la sección 2 de la propuesta):
1. Ejecutar primero el preflight (§3): exigir **0 colisiones** («SIN COLISION» en todas las filas; muestra entidad, código, nombre/nivel propuestos y nombre/tipo/nivel/activa existentes).
2. `INSERT` simple, **sin** `IGNORE` y **sin** `ON DUPLICATE KEY UPDATE`: ante un duplicado la sentencia falla; no se actualiza ni se ignora nada en silencio. Una cuenta existente, aunque sea idéntica, **detiene** la carga y se resuelve a mano.
3. Dentro de una transacción, con verificación exacta posterior (entidad, código, nombre, tipo, nivel, activa); `COMMIT` solo si no hay diferencias.

## 9. Parametrización por roles (diseño; no migrar todavía)

**Existente reutilizable:** (a) `cont_cuentas_bancarias` resuelve el rol BANCOS por cuenta bancaria elegida; (b) `poliza-venta.ts` ya define los roles `CLIENTES`, `BANCOS`, `RETENCION_IVA`, `VENTAS_SERVICIOS`, `VENTAS_BIENES`, `IVA_POR_PAGAR`. **No existe** ninguna tabla que enlace rol → cuenta por entidad.

**Diseño propuesto:** tabla `cont_cuentas_rol (empresa_id, entidad_id, rol, cuenta_id, activo)` con `PRIMARY KEY (empresa_id, entidad_id, rol)` y **FK compuesta** a `cont_cuentas(empresa_id, entidad_id, id)` (el mismo blindaje de ámbito que ya tienen bancos y asientos: una cuenta de otra entidad es imposible). Roles: `CLIENTES`, `VENTAS_SERVICIOS`, `VENTAS_BIENES`, `IVA_POR_PAGAR`, `RETENCION_IVA`, `ANTICIPOS`, `TRANSITO_BANCARIO`, `DEVOLUCIONES_VENTAS` (y `BANCOS` por `cont_cuentas_bancarias`).
Regla de resolución: `rol → cuenta configurada por entidad`. Nunca `if MONACO`/`if KT`. Si falta un rol (p. ej. `VENTAS_BIENES`) el motor **rechaza** la operación; no cae a otra cuenta.
Validaciones al guardar un rol: cuenta activa, de movimiento (nivel 5), tipo coherente con el rol (CLIENTES/RETENCION_IVA/TRANSITO = Activo; IVA/ANTICIPOS = Pasivo; VENTAS/DEVOLUCIONES = Ingreso).
DDL y carga inicial (por código, no por id) están **comentados** al final de la propuesta; **no forman parte** de esta homologación.

## 10. Bancos (para `cont_cuentas_bancarias`; propuesta futura)

Números bancarios **omitidos**. «Cuenta contable» es el código del catálogo de **esa** entidad.

### KT
| Registro Milenium (`b02`) | Banco | Cuenta contable | Moneda | Uso | Actividad | Certeza |
|---|---|---|---|---|---|---|
| 0001 (monetaria) | Banco Industrial | `11103002` | GTQ | Operación: cobros de clientes (72.8 %), pagos a proveedores y nómina | 2019-05 → 2026-05 | **CONFIRMADO** |
| 0002 (monetaria) | G&T Continental | `11103001` | GTQ | Cobros (26.1 %) y pagos | 2019-06 → 2026-05 | **CONFIRMADO** |
| 0005 (fondo operativo) | Banco Industrial | `11103004` | GTQ | Fondeo de la caja chica operativa | 2023-12 → 2026-04 | **CONFIRMADO** |
| 0003 | G&T Continental | `11103006` | GTQ | Pagos | hasta 2023-06 | **PENDIENTE** (¿cerrada?) |
| 0004 (tipo 3, efectivo) | — | `11101001` CAJA GENERAL | GTQ | Efectivo | hasta 2023-06 | **PENDIENTE** (no es banco) |

### MÓNACO
| Registro Milenium (`b02`) | Banco | Cuenta contable | Moneda | Uso | Actividad | Certeza |
|---|---|---|---|---|---|---|
| 0001 «BANCO INDUSTRIAL» y 0002 «BANCO INDUSTRIAL Q» | Banco Industrial | `11103002` (**ambos a la misma cuenta**) | GTQ | Operación única: cobros (97.8 % de los depósitos de clientes) y pagos | 2023-08 → 2026-05 | **CONFIRMADO** (duplicado de registro: ¿uno sobra?) |
| (histórico `00`) «EFECTIVO» tipo 3 | — | `11101001` CAJA GENERAL | GTQ | Efectivo | sin movimiento | **PENDIENTE** |

No hay cuentas en moneda extranjera con movimiento (la `11104003` «AHORRO DOLARES» existe en el catálogo pero **sin movimientos** en ambas). El maestro de bancos de Milenium (`b01`) tiene 5 registros en KT (Industrial ×2, G&T, América Central, Desarrollo Rural) y 4 en Mónaco; solo **Industrial** y **G&T** operan. Propuesta futura de alta en `cont_cuentas_bancarias` (comentada en el SQL, sección D): alias y los últimos 4 dígitos los define Contabilidad.

## 11. Preguntas para Contabilidad

1. **Contado:** ¿D BANCO directo en la factura (regla confirmada) o D CLIENTES + cobro (Milenium)? ¿El «banco» debe pasar por TRASLADO EN TRANSITO (depósito posterior)?
2. **Retención:** ¿en el asiento de la venta o al registrar la constancia? ¿qué hacer con las retenciones al **80 %**?
3. **Anulación:** ¿reverso exacto (VENTAS/IVA) o nota de crédito (DEVOLUCIONES)? ¿facturas anuladas sin póliza → nada que revertir?
4. **VENTAS_BIENES:** ¿qué cuenta, por entidad?
5. **Tipo y naturaleza:** ¿se aprueba el diccionario `TIPO_CTA` 1-5 y `MULTIP_CTA` ±1 de §3.2? ¿nivel 5 = cuenta de movimiento?
6. **Importación completa:** ¿se importa el catálogo completo (658 y 618 cuentas, con padre/naturaleza) o solo las cuentas operativas? Requiere migración aditiva (`padre`, `naturaleza`, `movimiento`).
7. **Bancos:** ¿se confirman las 3 de KT y 1 de Mónaco? ¿`11103006`, `11101001` y los duplicados `0001/0002` de Mónaco?
8. **Cuenta de prueba:** ¿se desactiva o se elimina `32234 / safdasf` (previo preflight en producción)?
9. **Cuentas de partes relacionadas** (KT ↔ Mónaco): ¿se homologan igual (códigos distintos en cada libro)?
10. **ISR retenido por clientes** y `PROVISION RETENCIONES DE IVA`: ¿alcance y tratamiento?

## 12. Qué NO hace esta fase

No inserta ni modifica cuentas (la propuesta no contiene ningún `INSERT` ejecutable); no escribe ningún valor de `tipo`; no desactiva ni elimina la cuenta de prueba; no migra ni crea tablas; no toca FACT-4, bancos, plantillas ni producción; no genera pólizas ni asientos; no implementa FEL; no importa el catálogo completo; no escribe en Milenium.

## 13. Verificación

- **Preflight** (100 % solo lectura: únicamente `SELECT` / `WITH … SELECT`) y **propuesta** (único contenido ejecutable: un `SELECT` de inventario; todo `INSERT`/DDL está en comentarios) ejecutados **solo** en una MariaDB 10.4 desechable local, con el esquema de `sql/schema.sql` y las migraciones del repositorio: sin error. Con la cuenta de prueba sembrada, la compuerta de colisiones devuelve «SIN COLISION» en las 18 filas y «APTO: 0 colisiones»; con una cuenta propuesta ya existente (idéntica o con nombre/nivel distinto) devuelve la colisión y «NO APTO».
- Sin `INSERT`, `UPDATE`, `DELETE`, `ALTER` ni DDL ejecutables en ninguno de los dos archivos; sin números de cuenta bancaria.
- Cifras de Milenium reproducibles con las lecturas de §0 (solo lectura). **No** se verificó contra producción ni con Contabilidad: todo lo marcado INFERENCIA/PENDIENTE sigue abierto.
