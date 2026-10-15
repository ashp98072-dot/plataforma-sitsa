# Milenium — Discovery funcional de procesos actuales y estrategia de coexistencia (M-1)

Estado: **DISCOVERY DOCUMENTAL.** Sin código, sin SQL, sin migraciones, sin datos, sin producción, sin INFILE/FEL, sin conectores.
Base: `main` = `27b82512` (incluye #466). Fecha: 2026-10-15.

> **Cambio de prioridad.** La integración directa con INFILE queda **pausada**. Esta fase identifica **qué procesos ya hace Milenium**
> y cuáles conviene **integrar, replicar o migrar** a plataforma-sitsa. **No se busca reemplazar Milenium de golpe:** el objetivo es
> **coexistencia y transición gradual**.

## 0. Cómo leer este documento y sus límites

- **Fuentes.** (a) El repositorio en `main`: esquema (`sql/`), rutas, servicios y pantallas. (b) Los documentos de auditoría
  **ya existentes** sobre Milenium: [`AUDITORIA-MILENIUM-CONTABILIDAD-FACTURACION`](AUDITORIA-MILENIUM-CONTABILIDAD-FACTURACION.md),
  [`FACTURACION-CONTABILIDAD-MILENIUM-DISCOVERY`](FACTURACION-CONTABILIDAD-MILENIUM-DISCOVERY.md),
  [`CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO`](CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO.md),
  [`MILENIUM-INVENTARIO-FUNCIONAL`](MILENIUM-INVENTARIO-FUNCIONAL.md). **No se leyó ni se tocó ninguna copia de Milenium en esta fase.**
- **Hecho confirmado directamente por el usuario (corrección PR #467):** Milenium **sí se usa hoy** para **control de pagos de planilla**,
  **contabilidad general**, **libro diario**, **libro mayor**, **cuentas por cobrar** y **cuentas por pagar**; en términos generales es el
  **ERP administrativo/contable principal**. Esto **prevalece** sobre cualquier inferencia de las auditorías previas. El detalle del flujo
  de planilla (cálculo, conceptos, contabilización, bancos, descuentos, IGSS/ISR, relación con RRHH) **NO está levantado** y queda
  **PENDIENTE de entrevista**.
- **Etiquetas** (se mantienen separadas): **CONFIRMADO** (visto en datos/archivos de Milenium según esas auditorías, o en el código
  actual de `main`) · **INFERIDO** (deducido; puede estar equivocado) · **PENDIENTE** (solo lo pueden confirmar los usuarios,
  Contabilidad, TI o el proveedor).
- **Lo que este documento NO puede afirmar:** quién usa cada módulo de Milenium, con qué frecuencia ni qué errores son comunes. Eso
  **solo sale de entrevistas** (§6). Donde aparece «quién lo usa», la columna indica la fuente o queda **PENDIENTE**.
- **Las auditorías previas son anteriores** a FACT-4, CONT PR A/B/C y FEL-2A. Esta fase **re-verificó** el estado de la plataforma en
  `main` y corrige lo que quedó desactualizado (§2).

## 1. Resumen ejecutivo

1. **Milenium es un ERP contable de escritorio (Visual FoxPro 9) sobre archivos DBF compartidos; no se conoce ninguna API,
   webservice ni servicio de red.** (CONFIRMADO en la auditoría; el ejecutable no tiene fuente.) Por eso «integrar con Milenium»
   **no** significa llamar a un endpoint: los canales realistas son **archivos** (exportación de reportes a Excel, utilitarios de
   importación de Milenium, lectura de solo lectura de copias) o **procesos manuales asistidos**. Esto condiciona toda la estrategia (§9).
2. **Milenium no conoce el «viaje».** La factura se digita a mano con texto libre. El viaje, la ruta, la tarifa, los cargos adicionales y
   la liquidación **solo existen en plataforma-sitsa**: es la **fuente maestra** de lo facturable.
3. **Milenium sí hace, y la plataforma NO hace hoy:** emisión/certificación FEL (vía INFILE), notas de crédito, cobros con aplicaciones y
   recibos, retenciones, bancos y conciliación, cuentas por pagar completas, póliza automática de ventas, libros de IVA/ASISTE LIBROS y
   balances. Todo eso es **legalmente sensible** y **debe seguir en Milenium** mientras no exista un hito fiscal real en plataforma.
   **Confirmado por el usuario:** Milenium es hoy el ERP administrativo/contable principal y se usa también para el **control de pagos de
   planilla**, la contabilidad general, el libro diario y mayor, y las cuentas por cobrar y por pagar.
4. **La plataforma ya cubre bien (y Milenium no tiene):** viajes, tarifas, cargos adicionales, liquidación, resumen comercial, fondos,
   gastos, compras/requerimientos, proveedores, viáticos, permisos y auditoría. Además cubre **RRHH operativo** (empleados, asistencia,
   vacaciones, incidencias, horas extra), lo cual **no significa** que haya sustituido el control de pagos de planilla ni su efecto
   contable, que **siguen en Milenium** (§3, §5).
5. **Hay una zona de duplicación real y peligrosa** (§8): la factura se **emite en Milenium** y su número se **digita** en la plataforma
   (`emitirFactura` exige `numeroFactura` manual); el cobro se registra en Milenium y se **vuelve a digitar** como pago/confirmación
   bancaria; y existen **dos «cuentas por cobrar» en la plataforma** (`fact_pagos` y `cont_cxc`) además de la de Milenium.
6. **Recomendación:** empezar por **P1 de solo lectura** sobre datos que ya están en plataforma (estado de cuenta, facturas
   pendientes/pagadas, reportes administrativos, «hoja de facturación» por viaje y referencia externa de facturas) y **no** activar nada
   contable ni fiscal hasta cerrar las preguntas de Contabilidad (§6, §10).

## 2. Mapa de capacidades actuales de la plataforma (verificado en `main`)

Nivel: **Completo** (operativo y probado) · **Parcial** · **Mínimo** (existe pero no sustituye al proceso) · **Inerte** (código sin
activar) · **No existe**.

| Proceso | ¿Existe hoy? | Nivel | Fuente actual (código / tablas) | Qué falta | Riesgo |
|---|---|---|---|---|---|
| Viajes, tarifas, cargos adicionales, liquidación, resumen comercial | Sí | **Completo** | `tms_planes_viaje`, `tms_viaje_liquidaciones`, `tms_viaje_cargos_adicionales`, `src/lib/tms/resumen-liquidacion.ts` (#459–#466) | IVA y costo real por viaje (decisión de negocio) | Bajo |
| Facturación (borrador desde viajes cerrados) | Sí | **Completo** (administrativo) | `fact_facturas`, `fact_factura_viajes`, `fact_factura_lineas` (FACT-1..4), `src/lib/facturacion/facturas.ts` | Serie/autorización/XML; vencimiento congelado | Medio: «Emitida» ≠ certificada |
| Emisión / certificación FEL | Dominio sí; **real no** | **Inerte** | `src/lib/fel/*`, `fel_emisores`, `fel_documentos`, `fel_intentos`, proveedor **MOCK**; **sin ruta ni UI** que lo use | Proveedor real, sandbox, UI, anulación real | Alto si se confunde MOCK con SAT |
| Número de factura | Sí, **digitado** | Mínimo | `emitirFactura` exige `numero_factura` y fecha manuales | Número/serie asignados por el certificador | Duplicar/transcribir mal |
| Anulación de factura | Sí, interna | Parcial | `anularFactura` (solo Borrador o Emitida sin pagos); `fact_factura_viajes_anuladas` | Anulación fiscal; reverso contable | «Anulada» en plataforma ≠ anulada en SAT |
| Notas de crédito / débito | Solo dominio FEL (mock) | **Inerte** | `construirDtoCorrectivo` (`src/lib/fel/mapper.ts`) | Todo el proceso real | — |
| Cobros / pagos | Sí, simples | Parcial | `fact_pagos` (`registrarPago`, solo contra factura Emitida) | Recibos, aplicación múltiple, cheques posfechados, retención, anticipos | Doble registro con Milenium |
| Confirmaciones bancarias | Sí | Parcial | `fact_pago_confirmaciones`, `cont_cuentas_bancarias` (#449) | Movimientos bancarios, depósitos, conciliación | Idem |
| Cuentas por cobrar | Mínimo y **duplicado** | Mínimo | `cont_cxc` (alta manual, cliente en texto, sin vínculo a facturas) **y** estado financiero derivado de `fact_pagos` | Una sola cartera; aplicaciones; **vencimiento** (no existe en `fact_facturas`); antigüedad | **Alto**: dos cifras distintas |
| Estado de cuenta por cliente | **No existe** | — | — | Todo | — |
| Cartera / antigüedad de saldos | **No existe** | — | — | Todo (requiere vencimiento) | — |
| Cuentas por pagar | Mínimo | Mínimo | `cont_cxp` (alta manual) | Documentos, pagos, retenciones | Cifras manuales |
| Compras y proveedores | Sí | **Completo** (para requerimientos) | `compras_proveedores`, `compras_requerimientos`, `compras_linea_documentos`; control de factura duplicada | Orden de compra formal, recepción, pago a proveedor | Bajo |
| Fondos / anticipos / gastos | Sí | **Completo** | `tms_solicitudes_fondo`, `tms_solicitud_fondo_lineas`, `tms_gastos_operativos`, entregas y constancias (#441, #445) | Contabilización | Bajo |
| Contabilidad (catálogo, partidas, consulta) | Sí, base | Parcial | `cont_entidades`, `cont_cuentas`, `cont_asientos`/`detalle`, `cont_cuentas_rol` (C1–C3B, PR A) | Períodos, numeración, tipos de póliza, balances, reverso | Medio: libro paralelo al de Milenium |
| Póliza automática de ventas | Diseñada | **Inerte** | `src/lib/facturacion/poliza-venta.ts`, `src/lib/contabilidad/factura-emitida.ts` (PR C #450) | Hito fiscal real; reglas de retención/anulación | Alto si se activa antes |
| Reportes fiscales (libro de ventas/compras, ASISTE LIBROS) | **No existe** | — | — | Todo | — |
| Reportes administrativos | Sí, operativos | Parcial | `reportes/viajes`, `gastos`, `fondos`, `viaticos`, `diario`; KPIs de facturación | Ventas y cobranza, correlativo, cartera | Bajo |
| Clientes | Sí | Parcial | `clientes`, `tms_clientes` (puente), `fact_cliente_perfil` (JSON: crédito, retención) | Tipo de ID, límite/días de crédito estructurados, NIT validado | **Tres copias** del cliente |
| Retenciones de IVA | Parcial | Mínimo | `retencion_iva_pct` por cliente (0/15/30, FACT-4) | Constancias, aplicación al cobro, reporte | Cálculo ≠ constancia real |
| Bancos / conciliación | **No existe** | — | solo `cont_cuentas_bancarias` y confirmaciones | Movimientos, cheques, conciliación | — |
| Activos fijos / Inventarios / Producción | Inventarios (4 tablas), flota | n/a | `inventario_*`, `flota_*` | — | Sin evidencia de uso en Milenium (KT) |
| **RRHH operativo** (empleados, asistencia, vacaciones, incidencias, horas extra y procesos RRHH existentes) | Sí | **Completo** | `rrhh_*` | La función **monetaria/contable de planilla** (pago y póliza) **no está sustituida**: sigue en Milenium (uso confirmado por el usuario) | Confundir RRHH operativo con planilla de pagos |
| Auditoría y permisos | Sí | **Completo** | `auditoria`, permisos granulares por módulo | — | Superior a Milenium |

> **Aclaración (planilla).** Que la plataforma tenga RRHH operativo **no implica** que reemplace el control de pagos de planilla de
> Milenium. La frontera entre cálculo, pago y contabilización está **PENDIENTE de entrevista**.
>
> **Correcciones a las auditorías anteriores.** «Sin FEL / sin IVA / sin líneas / sin retención / sin bancos» ya no es cierto: existen
> líneas de factura, IVA por línea, retención por cliente, condición de pago, cuentas bancarias de entidad, confirmaciones bancarias,
> roles contables, el dominio FEL con idempotencia y el evaluador de póliza. **Pero ninguno de ellos está conectado a una emisión real.**

## 3. Procesos de Milenium (lo que hace hoy)

Milenium organiza 14 módulos (Contabilidad, Bancos, Inventarios, Producción, Facturación, Cuenta por Cobrar, Cuenta por Pagar, Activos
Fijos, Planilla, Mercadeo, Ejecución de proyectos, Proyectos de ventas, Requisiciones/Órdenes de compra, Utilitarios). Según la
auditoría, **los realmente activos** (movimientos hasta 2026) son **Facturación FEL, Cuentas por cobrar, Contabilidad, Bancos y Cuentas
por pagar**; Producción, Mercadeo, Proyectos, Despacho por ruteo, Activos fijos (KT) e Inventarios aparecen **sin datos**.
**Planilla** no figura entre los módulos con movimientos en esa auditoría (no fue revisada), pero el **usuario confirmó su uso** para el
control de pagos de planilla (fila 16): prevalece el dato del usuario.

| # | Proceso en Milenium | Quién lo usa | De dónde vienen los datos | Resultado | Etiqueta |
|---|---|---|---|---|---|
| 1 | Captura de factura (líneas de servicio, descripción libre) | PENDIENTE | **Digitación manual** (el viaje vive en otros sistemas o «en la cabeza») | Factura cambiaria `FCAM` | CONFIRMADO |
| 2 | Certificación FEL en INFILE y guarda `uuid/serie/número` | PENDIENTE | XML DTE armado por Milenium | Documento certificado + historial `f61` | CONFIRMADO |
| 3 | Anulación de DTE | PENDIENTE | Factura certificada | `GTAnulacionDocumento` (930 en KT según el historial FEL) | CONFIRMADO |
| 4 | Nota de crédito (NCRE) desde CxC | PENDIENTE | Factura origen | NC certificada + póliza | CONFIRMADO |
| 5 | Cobros / recibos con aplicación a documentos | PENDIENTE | Banco/recibo físico | Recibo `R`, aplicación `cc03`, póliza (tránsito/banco/clientes) | CONFIRMADO (semántica de `E`, `D`, `A`: INFERIDO) |
| 6 | Retención de IVA (tipo `E`) | PENDIENTE | Constancia del cliente | Aplicación a la factura + póliza | CONFIRMADO (363 en Mónaco) |
| 7 | Cartera: saldo derivado, antigüedad, estado de cuenta | PENDIENTE | Facturas a crédito + aplicaciones | Reportes CxC | CONFIRMADO (menú); uso real PENDIENTE |
| 8 | Póliza automática de ventas | PENDIENTE | Parametrización `f10` | Partida contable por factura | CONFIRMADO |
| 9 | Bancos: cheques, depósitos, notas, conciliación | PENDIENTE | Captura manual | 29 366 movimientos (KT) | CONFIRMADO |
| 10 | Cuentas por pagar: contraseñas, pagos, retenciones | PENDIENTE | Facturas de proveedores | Pagos y pólizas | CONFIRMADO (uso real PENDIENTE) |
| 11 | Contabilidad: pólizas, diario, mayor, balances, presupuestos, cierres | PENDIENTE | Pólizas manuales/automáticas | Libros y estados financieros | CONFIRMADO |
| 12 | IVA: libros de ventas/compras y archivo ASISTE LIBROS | PENDIENTE | Facturas y compras | Declaración mensual | CONFIRMADO (menú); responsable PENDIENTE |
| 13 | Requisiciones y órdenes de compra | PENDIENTE | Captura | Órdenes | CONFIRMADO (menú); sin datos relevantes en KT: INFERIDO |
| 14 | Facturación recurrente automática | PENDIENTE | Meses/día por cliente (`cc01`) | Facturas por lote | CONFIRMADO (existe); uso PENDIENTE |
| 15 | Comisiones de vendedores | PENDIENTE | `f02` | Reportes | CONFIRMADO (existe); uso PENDIENTE |
| 16 | **Planilla — control de pagos de planilla** | PENDIENTE (quién y con qué frecuencia) | PENDIENTE (¿Milenium calcula salarios o recibe datos? ¿de RRHH, Excel, manual?) | PENDIENTE (pagos, póliza contable, relación con Bancos, IGSS/ISR) | **USO CONFIRMADO POR USUARIO:** «control de pagos de planilla». El detalle exacto del flujo sigue **PENDIENTE** |
| 17 | Activos fijos, Inventarios, Producción | PENDIENTE | — | — | Sin uso observado en la auditoría (sin datos en KT) |

## 4. Fuente maestra por dato y puntos de duplicación (§8 del encargo)

Flujo objetivo: **Viaje → liquidación → documento por facturar → factura fiscal → cobro → banco → contabilidad.**

| Dato | Fuente maestra recomendada **hoy** | Dónde se duplica | Riesgo |
|---|---|---|---|
| Viaje, ruta, unidad, piloto, tarifa, cargos, liquidación | **Plataforma** (TMS) | Milenium lo recibe como texto libre | Texto ≠ dato (inconsistencias en la descripción) |
| Cliente (nombre fiscal, NIT, dirección, crédito) | **Pendiente de decisión.** Hoy: Milenium `cc01` para lo fiscal; plataforma para lo operativo | `clientes`, `tms_clientes`, `fact_cliente_perfil` (JSON) **y** `cc01` | NIT/nombre distintos entre sistemas |
| Documento fiscal (serie, número, autorización, XML/PDF) | **Milenium/INFILE** | `fact_facturas.numero_factura` **digitado** | Transcripción; «Emitida» tratada como certificada |
| Líneas y total de la factura | Plataforma **prepara**, Milenium **emite** | Se digitan dos veces | Diferencias de centavos/IVA/descripción |
| Saldo y cartera **legal** | **Milenium** | `fact_pagos` (derivado) y `cont_cxc` (manual) | Tres cifras de «saldo» |
| Cobros / recibos | **Milenium** | `fact_pagos`, `fact_pago_confirmaciones` | Cobro registrado en un solo lado o en ambos |
| Retención de IVA aplicada | **Milenium** | % por cliente en plataforma | Cálculo teórico ≠ constancia |
| Movimientos bancarios | **Milenium** | `cont_cuentas_bancarias` (solo catálogo) | — |
| Póliza / contabilidad | **Milenium** | `cont_asientos` (captura manual) | Libro paralelo con saldos distintos |
| Fondos, gastos, requerimientos de compra | **Plataforma** | Contabilización posterior en Milenium (manual, INFERIDO) | Gasto autorizado sin póliza o duplicado |
| Proveedores | Plataforma (`compras_proveedores`) y Milenium CxP | Dos catálogos | NIT/cuenta bancaria desalineados |
| Catálogo de cuentas | **Milenium** (homologado: 10 KT / 8 Mónaco en plataforma) | `cont_cuentas` | Cuentas no homologadas |
| RRHH operativo (empleados, asistencia, vacaciones, incidencias, horas extra) | **Plataforma** | PENDIENTE: si Milenium recibe o carga empleados/datos de RRHH para el pago de planilla | Empleados dados de alta en ambos sistemas |
| Pago y contabilización de planilla | **Milenium** (uso confirmado por el usuario) | Datos de RRHH que alimenten el pago, si los hay | **Frontera definitiva: PENDIENTE de entrevista** |

**Puntos de doble digitación identificados (INFERIDOS; validar en entrevistas):**
D1 viaje → factura en Milenium · D2 número de factura Milenium → `fact_facturas` · D3 cobro en Milenium → `fact_pagos`/confirmación ·
D4 retención en Milenium → plataforma (no existe) · D5 gasto/fondo → póliza Milenium · D6 cliente nuevo en ambos catálogos.

## 5. Clasificación y prioridad de procesos

Categorías: **A** mantener en Milenium · **B** integrar con Milenium · **C** replicar en plataforma · **D** migrar gradualmente ·
**E** no tocar por ahora. Prioridad: **P1** alto impacto / mucho trabajo manual / datos ya disponibles / bajo riesgo · **P2** útil pero
requiere integración externa · **P3** contable/fiscal sensible, validación fuerte · **P4** mantener en Milenium.

| # | Proceso | Cat. | Prior. | Justificación |
|---|---|---|---|---|
| 1 | **Cuentas por cobrar** — vista informativa de cartera de lo registrado en plataforma | C | **P1** | Los datos (`fact_facturas` + `fact_pagos`) ya existen; solo lectura; elimina consultas manuales. **Condición:** rotular «documentos registrados en plataforma», no «cartera legal». |
| 2 | Cuentas por cobrar — cartera **legal** (saldos, aplicaciones, vencimiento) | D | **P3** | Requiere vencimiento congelado, retenciones, notas de crédito, histórico y fecha de corte; mientras tanto el maestro es Milenium. |
| 3 | **Registro de pagos** | B | **P3** | Hoy se registra en Milenium y se re-digita; unificar exige decidir quién es maestro y cómo evitar doble efecto. No automatizar sin regla. |
| 4 | **Estado de cuenta por cliente** | C | **P1** | No existe y es de alto uso; datos disponibles; solo lectura. Mismo rótulo que #1. |
| 5 | **Facturas pendientes** (por cobrar) | C | **P1** | Ya existe `estadoFinanciero` y KPI `pendienteCobro`; falta el listado/exportación orientada a cobranza. |
| 6 | **Facturas pagadas** | C | **P1** | Ídem (`Cobrado`). |
| 7 | Notas de crédito / débito | A | **P3** | Fiscal y contable (reverso de IVA); hoy solo en Milenium; el dominio FEL correctivo está inerte. |
| 8 | **Compras y proveedores** | C (ya cubierto) | **P2** | La plataforma cubre requerimientos y proveedores; falta definir si Milenium (órdenes de compra/CxP) se usa realmente. |
| 9 | Cuentas por pagar | A | **P4** | Maestro en Milenium (contraseñas, pagos, retenciones); `cont_cxp` es solo un registro manual. |
| 10 | **Bancos / depósitos / conciliación** | A | **P4** | Sin equivalente; riesgo alto; solo existe la confirmación de cobro de PR B. |
| 11 | **Reportes administrativos** (ventas, cobranza, correlativo) | C | **P1** | Se pueden construir desde viajes/facturas/pagos de plataforma; no alteran nada. |
| 12 | **Contabilidad** (catálogo, partidas, balances) | D | **P3** | Base existente, pero un segundo libro sin período/numeración/reverso es riesgo; Milenium es maestro. |
| 13 | Póliza automática de ventas | E | **P3** | Inerte por diseño hasta un hito fiscal real (PR C). |
| 14 | **Reportes fiscales** (libro de ventas, ASISTE LIBROS) | A | **P4** | Obligación legal; depende de FEL, IVA y contabilidad; no tocar. |
| 15 | Emisión/certificación FEL | A | **P4** | INFILE directo **pausado**; Milenium emite. |
| 16 | Anulación fiscal de facturas | A | **P3** | Un «Anulada» interno no anula en SAT; riesgo de desincronización. |
| 17 | Retenciones de IVA (constancias) | D | **P3** | Falta entidad «constancia»; reglas confirmadas por Contabilidad pero sin modelo. |
| 18 | **Hoja de facturación por viaje** (datos estructurados para capturar en Milenium) | B | **P1** | Elimina el texto libre y la re-digitación (D1); solo exporta datos que ya existen (viaje, tarifa, cargos, subtotal «antes de impuestos»). **No** define IVA ni «total factura». |
| 19 | **Referencia externa de factura** (serie/número/autorización de Milenium por viaje) | B | **P1** | Hoy se digita sin control; formalizarlo (con validación de duplicados) reduce D2 y evita volver a facturar un viaje ya facturado en Milenium. |
| 20 | Catálogo de clientes (sincronización NIT/razón social) | B | **P2** | Reduce D6; requiere decidir maestro y canal de intercambio (archivo). |
| 21 | Fondos / gastos / anticipos | C (ya cubierto) | **P2** | Plataforma es el maestro; falta el puente a la contabilidad (manual en Milenium). |
| 22 | **Planilla: control de pagos y su efecto contable** (RRHH operativo ya existe en plataforma) | A | **P4** | Milenium se usa actualmente para control de pagos de planilla; plataforma cubre RRHH operativo. La frontera entre cálculo/pago/contabilización debe levantarse en entrevista antes de cualquier migración (si luego se decide mover algo, pasaría a **P3**: monetario/contable sensible). |
| 23 | Inventarios, Producción, Activos fijos, Mercadeo, Proyectos | E | **P4** | Sin datos/uso observado. |
| 24 | Facturación recurrente, comisiones/vendedores, cheques posfechados | E | **P4** | Existen en Milenium; **uso PENDIENTE** de confirmar; no migrar sin evidencia. |
| 25 | Seguridad de credenciales de INFILE en Milenium | A | **P4** | Riesgo conocido (llaves en claro); remediación es de TI, no de plataforma. |

**Resumen por categoría (25 procesos):** A (mantener) 8 · B (integrar) 4 · C (replicar) 7 · D (migrar gradual) 3 · E (no tocar) 3.

## 6. Checklist de entrevista (usuarios de Milenium)

Aplicar **por proceso** (§3) y por rol (facturación, cobranza, tesorería, contabilidad, compras, TI). Registrar la respuesta, el nombre
y la fecha. Las preguntas ya abiertas en las auditorías (P-1…P-15 y N-1…N-32) se **reutilizan**, no se repiten.

### 6.1 Preguntas generales (todas las áreas)
1. ¿Qué hacen exactamente en Milenium y para qué lo hacen (obligación legal, control interno, costumbre)?
2. ¿Quién lo hace? ¿Con qué frecuencia (diaria, semanal, cierre mensual)? ¿Cuántos documentos por período?
3. ¿Qué datos ingresan **manualmente**? ¿De qué hoja, correo, sistema o papel los toman?
4. ¿Qué información viene de otro sistema (plataforma, bancos, clientes)? ¿Cómo llega?
5. ¿Qué documentos genera? ¿A quién se entregan? ¿Quién los firma/autoriza?
6. ¿Qué reportes utilizan (nombre exacto del menú)? ¿Los exportan a Excel? ¿Para qué?
7. ¿Qué datos consultan **después** (cliente, saldo, serie, UUID)? ¿Cuánto tardan en encontrarlos?
8. ¿Qué pasos duplican en Excel, correo o plataforma-sitsa?
9. ¿Qué errores son frecuentes (NIT, descripción, montos, duplicados, anulaciones)? ¿Cómo los corrigen?
10. ¿Qué acciones requieren autorización de otra persona? ¿Queda constancia?
11. ¿Qué procesos **dependen obligatoriamente** de Milenium (ley, auditor, banco)?
12. ¿Qué proceso podría salir de Milenium **sin riesgo** y por qué?
13. ¿Qué pasaría si Milenium no estuviera disponible un día (llave de hardware, servidor)? ¿Hay contingencia?

### 6.2 Preguntas específicas por candidato
**Cuentas por cobrar / estado de cuenta / pendientes y pagadas**
- ¿Quién genera hoy el estado de cuenta y la antigüedad de saldos? ¿Con qué frecuencia y para quién?
- ¿La cartera de Milenium incluye **todas** las facturas? ¿Hay facturas emitidas fuera de Milenium (series `0A`/`FL`)?
- ¿Cómo se calculan vencimiento y mora? ¿Existe un límite de crédito que **bloquee** la facturación?
- ¿Aceptarían un estado de cuenta de plataforma que muestre solo lo registrado allí (no la cartera legal)?

**Registro de pagos / bancos**
- ¿Dónde se registra primero el cobro (banco, caja, Milenium, plataforma)? ¿Quién confirma el depósito?
- ¿Qué significan los tipos `R`, `E`, `C`, `D`, `A`? ¿Se usa «tránsito»? ¿Cuándo se cobra directo en Bancos?
- ¿Cheques posfechados: cuántos, quién los gestiona?

**Notas de crédito/débito**
- ¿Motivos más frecuentes? ¿Quién las autoriza? ¿Se usan NABN, FESP, nota de cargo interna (serie `FL`)?

**Compras, proveedores, cuentas por pagar**
- ¿Se usan las órdenes de compra de Milenium? ¿Cómo se relacionan con los requerimientos de plataforma?
- ¿Quién captura la factura del proveedor y quién paga? ¿Retenciones al proveedor?

**Contabilidad y reportes fiscales**
- ¿Qué reportes contables se entregan al contador externo/auditor y en qué formato?
- ¿Quién prepara el libro de ventas/ASISTE LIBROS y desde qué reporte? ¿Qué cierre mensual hacen?
- ¿Aceptarían que plataforma **no** genere pólizas hasta una fecha de corte?

**Planilla (uso confirmado por el usuario: control de pagos de planilla)**
- ¿Qué parte exacta de la planilla se realiza en Milenium?
- ¿Milenium calcula salarios o solo registra/paga?
- ¿Cómo ingresan horas extra, ausencias, descuentos y bonificaciones?
- ¿Se registra IGSS/ISR?
- ¿Cómo se genera el pago?
- ¿Qué póliza contable produce?
- ¿Se relaciona con Bancos?
- ¿Qué datos podrían provenir en el futuro del módulo RRHH de plataforma?

**Clientes**
- ¿Dónde se da de alta primero un cliente? ¿Quién valida el NIT? ¿Qué datos extra exige cada cliente en la factura?

## 7. Riesgos

| # | Riesgo | Efecto | Mitigación propuesta |
|---|---|---|---|
| R1 | Tratar «Emitida» de plataforma como factura certificada | Contabilizar/cobrar sobre un documento sin validez fiscal | Rotular siempre «registrada en plataforma»; hito fiscal real antes de activar PR C |
| R2 | Dos o tres «saldos» (`fact_pagos`, `cont_cxc`, Milenium) | Decisiones con cifras distintas | Una sola vista informativa con rótulo de fuente; congelar `cont_cxc` como manual |
| R3 | Doble registro de cobros | Saldo incorrecto | Definir maestro (Milenium) y registrar en plataforma solo como **referencia** |
| R4 | Facturar de nuevo un viaje ya facturado en Milenium | Doble facturación | Referencia externa por viaje + exclusión en «viajes pendientes» (P1 #19) |
| R5 | Libro contable paralelo | Balances contradictorios | No generar pólizas automáticas; plataforma solo consulta hasta corte |
| R6 | Anulación desincronizada | Factura anulada en un lado y vigente en otro | No automatizar anulación; procedimiento manual con evidencia |
| R7 | Datos históricos incompletos | Estado de cuenta «incompleto» interpretado como completo | Rótulo y fecha de corte; carga inicial solo con acuerdo de Contabilidad |
| R8 | Canal de intercambio por archivos | Versiones desactualizadas, errores de formato | Archivos con fecha/huella, validación y solo lectura; sin escritura sobre DBF |
| R9 | Material sensible en copias de Milenium (llaves INFILE en claro) | Fuga de credenciales | Fuera de alcance de plataforma; **no** copiar datos de Milenium al repo (regla vigente) |
| R10 | Cambiar de proceso sin dueño | Responsabilidad difusa | Un responsable por proceso y por emisor (KT / Mónaco) |

## 8. Dependencias y bloqueos

- **Decisiones de Contabilidad** (IVA incluido o no, retenciones, anulación contable, fecha de corte, ¿póliza al emitir o al cobrar?).
- **Maestro del cliente** y **fecha de corte** por emisor (KT / Logiservicios Mónaco; configuración independiente).
- **Canal de intercambio con Milenium:** no hay API conocida; cualquier integración técnica exige **documentación del proveedor de
  Milenium** (§10) o aceptar un canal de **archivos** manuales. Hasta entonces, **no se escribe ningún conector**.
- **FEL/INFILE:** **pausado**. Mientras no exista un hito fiscal real y verificable, la contabilización automática y la anulación fiscal
  en plataforma **no** se activan (PR C inerte; FEL-2A solo con proveedor MOCK).
- **TI:** estado de la llave de hardware y del servidor de Milenium; respaldo; acceso de solo lectura a copias.

## 9. Arquitectura de coexistencia (fronteras, sin conectores)

```text
                       ┌──────────────────────────── plataforma-sitsa ────────────────────────────┐
  usuarios operativos  │ TMS: viaje → reporte → cargos → cierre → liquidación → resumen comercial  │
  (Programación,       │ (FUENTE MAESTRA de lo facturable)                                          │
   Operaciones)  ────▶ │                      │                                                      │
                       │                      ▼                                                      │
                       │   Facturación / administración (borrador, líneas, referencia externa,       │
                       │   estado de cuenta INFORMATIVO, reportes)                                   │
                       └─────────────┬────────────────────────────────────────┬─────────────────────┘
                                     │ canal por ARCHIVOS / manual asistido    │ (futuro, pausado)
                                     ▼                                         ▼
                              ┌─────────────┐                       ┌──────────────────┐
                              │  Milenium   │                       │ INFILE directo   │
                              │ (maestro    │──── FEL (INFILE) ────▶│ (proveedor FEL)  │
                              │  fiscal,    │                       └──────────────────┘
                              │  cartera,   │
                              │  bancos,    │
                              │  contab.)   │
                              └─────────────┘
```

**Fronteras propuestas (reglas, no código):**
1. **Plataforma → Milenium:** solo **datos estructurados de lectura** (hoja de facturación por viaje, cliente, referencia de viaje).
   Nunca escribe en las bases de Milenium.
2. **Milenium → plataforma:** solo **referencias** (serie, número, autorización, fecha, monto) y, si se acuerda, reportes exportados
   para **conciliación de solo lectura**. Nunca se importa «verdad contable» sin validación y sin fecha de corte.
3. **Un emisor/serie nunca emite en los dos sistemas a la vez** (regla ya establecida en la auditoría §17.1).
4. **Abstracción ya disponible:** el dominio FEL (`FelProvider`, idempotencia, estados) es **neutral al proveedor** y permite que, si más
   adelante hay INFILE directo o un conector de Milenium, se enchufe sin reescribir. Un proveedor real **no** debe confundirse con el MOCK.
5. **Tenant y entidad obligatorios:** toda referencia externa se guarda por `empresa_id` + `entidad_id` (KT / Mónaco); nada global.

## 10. Si algún día se decide una integración técnica con Milenium (qué habría que pedir al proveedor)

**No inferir ninguno de estos datos.** Solicitarlos por escrito al proveedor/mantenedor de Milenium:

1. ¿Existe API, webservice, servicio de importación o formato oficial de intercambio? ¿Documentación y versión soportada?
2. ¿Sandbox / base de pruebas separada y cómo se restaura?
3. Formato y esquema de importación (Excel/CSV/XML): campos obligatorios, validaciones, manejo de errores, identificador del lote.
4. ¿Qué devuelve Milenium tras importar (número interno, serie, autorización)? ¿Cómo se consulta después?
5. Manejo de **duplicados**: ¿hay clave de idempotencia? ¿Qué pasa si se importa el mismo lote dos veces?
6. Operación concurrente: ¿se puede importar con usuarios conectados? ¿Bloqueos de DBF?
7. Anulación y notas de crédito: ¿vía importación o solo manual?
8. Soporte de varias empresas (`BASESxxx`) y series por emisor.
9. Licenciamiento (llave de hardware) y su efecto en procesos automáticos.
10. Responsable técnico y ventana de cambios.

## 11. Siguiente fase recomendada y hoja de ruta

| Fase | Contenido | Tipo | Prerrequisitos |
|---|---|---|---|
| **M-1 (esta)** | Mapa de procesos, clasificación, entrevistas | Documental | — |
| **M-1b** | Ejecutar entrevistas (§6) y cerrar las preguntas de Contabilidad; confirmar usuarios reales por módulo | Operativa | Acceso a los usuarios |
| **M-2** | Estado de cuenta, facturas pendientes/pagadas y reportes de facturación/cobranza **solo lectura**, con rótulo «documentos registrados en plataforma» | P1, bajo riesgo | Confirmación de formato con cobranza |
| **M-3** | **Referencia externa de factura por viaje** (serie/número/autorización de Milenium) con control de duplicados y exclusión de «viajes pendientes» | P1 | Decisión de Contabilidad sobre campos y fecha de corte |
| **M-4** | **Hoja de facturación por viaje** (exportación estructurada para captura en Milenium) — sin IVA ni «total factura» | P1 | Reglas de agrupación y descripción (P-C1…P-C3) |
| **M-5** | Sincronización de catálogo de clientes por archivo | P2 | Maestro del cliente decidido |
| **M-6** | Cobros/retenciones/notas de crédito (aplicaciones, vencimiento congelado) | P3 | Hito fiscal real, reglas de retención, fecha de corte |
| **M-7** | Contabilización automática y reportes fiscales | P3/P4 | FEL real, períodos y numeración contable (C3C), validación de Contabilidad |

**No se recomienda** iniciar M-6/M-7 antes de que M-2/M-3 estén en uso y conciliados con Milenium durante al menos un ciclo mensual.

## 12. Evidencia revisada (para trazabilidad)

- **Código:** `src/lib/facturacion/*` (facturas, líneas, impuestos, borradores, confirmaciones bancarias, póliza de venta),
  `src/lib/fel/*` (proveedor, estados, servicio, mapper, credenciales), `src/lib/contabilidad/*`, `src/lib/compras/*`,
  `src/lib/tms/*` (liquidación, cargos, resumen comercial, fondos, gastos), `src/app/api/empresas/[slug]/{facturacion,contabilidad,compras,tms/fondos,tms/gastos}`,
  `src/app/e/[slug]/{facturacion,contabilidad,compras,fondos,gastos,reportes}`, `scripts/milenium/*`.
- **Esquema:** `sql/schema.sql` y migraciones `fact_*`, `cont_*`, `fel_*`, `compras_*`, `tms_*` (152 tablas distintas catalogadas).
- **Documentos:** auditoría de Milenium, homologación contable, FACT/CONT/FEL/COMPRAS/FONDOS (ver §0).
- **No revisado:** ninguna copia de Milenium, ninguna base de producción, ninguna credencial.
