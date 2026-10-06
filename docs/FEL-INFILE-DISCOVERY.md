# FEL con INFILE — Fase 1: discovery del módulo actual

Estado: **DISCOVERY / DISEÑO. Sin código funcional, sin llamadas a INFILE, sin credenciales, sin SQL ejecutado.**
Base: `origin/main` `f2244c05`. Fecha: 2026-10-06.
Documentos hermanos: [ARQUITECTURA](FEL-INFILE-ARQUITECTURA.md) · [PLAN](FEL-INFILE-PLAN.md) · [DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md).

> **Aviso de alcance.** Nada de lo escrito aquí es documentación oficial de INFILE ni de la SAT. No se fija ningún endpoint, método de autenticación, formato de payload ni código de error. Todo lo que dependa del contrato del certificador está marcado **«A CONFIRMAR»** y se resuelve en [DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md). Del histórico de Milenium se usaron **solo nombres de elementos XML y de campos DBF** (estructura), nunca valores ni datos financieros.

## 1. Resumen ejecutivo

La plataforma tiene un módulo de Facturación **interno y administrativo**: agrupa viajes Cerrados de un cliente en una factura, la «emite» (número y fecha escritos a mano), la anula (si no tiene pagos) y registra pagos. **No tiene nada de FEL**: ni IVA, ni moneda, ni serie, ni tipo de documento, ni receptor congelado, ni datos fiscales del emisor, ni PDF de factura, ni integración con terceros.

Hallazgos que condicionan el diseño:

1. **El emisor legal no es el tenant.** `empresas` no guarda NIT ni dirección. KT (Kuiqtrans) y MONACO (Logiservicios Mónaco) son **entidades** (`cont_entidades`) dentro del mismo tenant; Frescofresh es otro tenant. `fact_facturas` **no tiene `entidad_id`**: hoy no se sabe qué entidad legal emite cada factura. La configuración FEL (NIT, establecimiento, credenciales) debe colgar del **emisor = (empresa, entidad)**.
2. **«Emitir» hoy no certifica nada.** Es un `UPDATE estado_admin='Emitida'` con número y fecha digitados. Para FEL debe pasar a depender de la confirmación del certificador.
3. **El modelo de factura es mínimo**: un total y una lista de viajes con `monto_asignado`. Faltan líneas descriptivas, impuestos, moneda, receptor congelado y complementos (p. ej. abonos de factura cambiaria).
4. **No hay infraestructura de colas ni cron** (se buscó en `src/`). Es la **primera integración HTTP con un tercero** del proyecto: no hay patrón de cliente externo, reintentos ni timeouts que reutilizar.
5. **Sí existe un patrón de secretos cifrados** reutilizable (`src/lib/proveedores/credenciales.ts`, AES-256-GCM), con una debilidad que hay que corregir para esto (ver ARQUITECTURA §3).
6. **Las tablas de facturas no están en `sql/schema.sql`** (solo en `sql/migrate-2026-08-fact-1-facturas-pagos.sql`, `APLICADO_CONFIRMADO` según `docs/AUDITORIA-MIGRACIONES-ESTADO-REAL.md`). Cualquier DDL nuevo debe tenerlo presente y reconciliar `schema.sql`.

## 2. Matriz de componentes

| Componente | Archivo | Estado actual | ¿Reutilizable? | Cambio requerido para FEL | Riesgo |
|---|---|---|---|---|---|
| Modelo de factura | `sql/migrate-2026-08-fact-1-facturas-pagos.sql` (`fact_facturas`) | `empresa_id, cliente_id, numero_factura (manual, UNIQUE por empresa), fecha_emision, monto_total, estado_admin ENUM('Borrador','Emitida','Anulada'), observaciones, auditoría de usuario`. Sin moneda, IVA, serie, tipo de documento, entidad emisora ni receptor congelado | Parcial (base, estados y pagos) | Columnas aditivas mínimas (`entidad_id`, `moneda`, tipo de documento); el resto del estado FEL va **fuera** de esta tabla (ver ARQUITECTURA §6) | Alto: tabla en producción, no está en `schema.sql` |
| Líneas | `fact_factura_viajes` | Una fila por viaje: `plan_id UNIQUE`, `monto_asignado`. Sin descripción, cantidad, unidad de medida, precio unitario ni impuestos | Parcial | El DTO de ítems se **deriva** al certificar (viaje → ítem) y se congela en el documento FEL; definir regla de descripción y de IVA | Alto: decisión de negocio sobre IVA/descripción |
| Pagos | `fact_pagos` + `registrarPago` | Pagos a la **factura completa**, solo si `Emitida`; no prorratea por viaje | Sí | Ninguno directo; bloquear pagos si FEL está `INCIERTO`/`PENDIENTE` | Bajo |
| Estados | `facturas.ts` (`EstadoAdminFactura`) | `Borrador / Emitida / Anulada`; estado financiero derivado (`Sin pagos / Pago parcial / Cobrado`) | Sí, **sin tocar el ENUM** | Estado FEL **separado** (otra tabla); `Emitida` con FEL habilitado solo tras confirmación | Medio |
| Emitir | `emitirFactura` (`facturas.ts`) y `POST …/facturas/[id]/emitir` | Valida Borrador, número y fecha obligatorios, monto > 0, ≥1 viaje, viajes aún Cerrados; `UPDATE … Emitida`; auditoría. **Nada se congela** salvo número/fecha/estado | Punto natural de entrada | Con FEL habilitado, delega a un servicio de certificación; sin FEL, queda igual | Alto |
| Numeración | `numero_factura` | Digitado por el usuario; `UNIQUE(empresa_id, numero_factura)`; sin serie | No | Serie y número los asigna el certificador al certificar; guardar autorización y serie; ver convivencia con Milenium (PLAN §Convivencia) | Alto |
| IVA | — | **No existe.** `monto_total = Σ monto_asignado` (`tarifa_comercial` del viaje o monto editado). `incluye_iva` es una respuesta libre del cuestionario | No | Modelo de impuestos (IVA 12 %, exento, base/IVA por ítem y totales); definir si la tarifa incluye IVA | Alto |
| Moneda | — | No se guarda; la UI muestra «Q». `moneda`/`moneda_cliente` son respuestas libres del cuestionario | No | `fact_facturas.moneda` (CHAR(3)) y tasa de cambio si hay USD | Medio |
| Receptor | `clientes` + `fact_cliente_perfil` | `clientes`: `nombre, razon_social, nit, email, direccion` (texto libre). Cuestionario (`respuestas_json`): razón social a facturar, NIT a facturar, dirección de factura, correo FEL — **texto libre, no autoritativo** | Parcial | Datos estructurados del receptor (tipo de identificación, NIT/CUI/extranjero, nombre, correo, dirección con depto/municipio) **congelados** al certificar; validación de NIT; consumidor final | Alto |
| Emisor | `empresas`, `cont_entidades`, `fact_empresa_perfil` | `empresas`: `codigo, nombre, slug, logo_url, modulos_json` — **sin fiscales**. `cont_entidades`: `codigo, nombre`. Cuestionario de empresa: régimen, `usa_fel`, `certificador_fel` (texto libre) | No | Nueva configuración por emisor (NIT, nombre, afiliación IVA, establecimiento, dirección fiscal, frases, credenciales, ambiente) | Alto |
| Auditoría | `registrarAuditoriaTx` | Texto libre por acción (`crear_factura`, `emitir_factura`, `anular_factura`, `registrar_pago`) | Sí | Acciones FEL nuevas con **ids y estado**, nunca XML ni secretos | Bajo |
| PDF | — | **No hay PDF de factura.** Hay `pdf-lib` y `pdfkit` en el proyecto (usados por otros módulos). Plantillas de Milenium disponibles solo como referencia visual (`fFacturaFel.FRX/FRT`, `fnotacreditofel.FRX/FRT`) | Librerías sí | PDF por SITSA o del proveedor (ARQUITECTURA §11) | Medio |
| Anulación | `anularFactura` | Solo si **no hay pagos**; `UPDATE Anulada` y **borra** `fact_factura_viajes` (libera los viajes). Con pagos exige «nota de crédito/reversa (no implementado)» | Parcial | Separar «anular interna» de «anular FEL certificada» (evento al certificador); no liberar viajes hasta confirmar | Alto |
| Viajes facturables | `listarViajesPendientes`, `validarYBloquearPlanes` | Viajes `Cerrado`, mismo cliente, vía puente `clientes.tms_cliente_id`; `UNIQUE(plan_id)` en `fact_factura_viajes` | Sí | Marca de «facturado fuera de SITSA (Milenium)» para la convivencia | Medio |
| Permisos | `requireTenantFacturacion`, catálogo (`permisos-catalogo.ts`) | Acciones: ver, crear, editar, emitir, anular, pagos, y desde #414 ver/editar configuración y requisitos | Sí | Acciones FEL propias (certificar, anular FEL, ver/descargar XML, configurar emisor, conciliar) | Medio |
| Configuración de empresa | `fact_empresa_perfil`, `GET/PUT /facturacion/empresa` | Cuestionario de texto libre (JSON) por **tenant** | Solo como referencia | **No** guardar datos fiscales ni secretos ahí; tabla nueva por emisor | Medio |
| Requisitos de cliente | `fact_cliente_perfil` | Cuestionario por cliente (JSON): razón social, NIT, dirección, correo FEL, retiene IVA/ISR, días de crédito, descripción que piden en la factura | Útil como **insumo** | Hoy no alimenta ninguna factura; definir qué campos pasan a estructura | Medio |
| Infraestructura | — | Sin colas/cron/workers; sin cliente HTTP a terceros; secretos por variables de entorno (`AUTH_SECRET`, `PORTAL_CREDENTIALS_KEY`) | Cifrado AES-GCM sí | Cliente HTTP con timeout, reintento manual, reconciliación bajo demanda | Alto |

## 3. Detalle de lo que ocurre hoy

- **Dónde ocurre «emitir»:** `emitirFactura` (`src/lib/facturacion/facturas.ts`) dentro de una transacción con `FOR UPDATE`.
- **Qué se congela al emitir:** solo `numero_factura`, `fecha_emision` y `estado_admin`. El `monto_total` se fijó al crear/editar el borrador. **No** se congelan: nombre/NIT/dirección/correo del cliente (se leen en vivo de `clientes`), descripciones, impuestos ni moneda. Para FEL esto es un hueco: el documento fiscal debe quedar inmutable.
- **Cómo se numera hoy:** a mano, `UNIQUE(empresa_id, numero_factura)`. NULL en borradores.
- **Cálculo de IVA:** ninguno.
- **Referencias a viajes:** `fact_factura_viajes(plan_id UNIQUE)`; anular **borra** la relación.
- **Auditoría:** `registrarAuditoriaTx` con texto libre por acción.
- **Permisos backend:** `requireTenantFacturacion(slug, accion)` para facturas; `requireFacturacionConfig` para configuración/requisitos.
- **Cierre de ciclo financiero:** los pagos solo se aceptan contra `Emitida`; estado financiero derivado.

## 4. Datos fiscales por empresa/emisor (qué existe y qué falta)

| Dato | ¿Existe? | Dónde | Observación |
|---|---|---|---|
| Razón social / nombre del emisor | Parcial | `empresas.nombre`, `cont_entidades.nombre` | Nombre interno, no necesariamente el fiscal |
| Nombre comercial | No | — | |
| NIT del emisor | **No** | — | Imprescindible |
| Dirección fiscal, departamento, municipio, código postal, país | **No** | — | El DTE las exige estructuradas |
| Afiliación IVA / régimen | Parcial | cuestionario `regimen` (texto libre) | Debe ser un código |
| Correo / teléfono del emisor | No | — | |
| Código de establecimiento | **No** | — | |
| Moneda | Parcial | cuestionario | Texto libre |
| Frases (tipo y escenario) | **No** | — | Dependen del régimen |
| Tipo de documento predeterminado | No | — | |
| Certificador y credenciales | No (solo `certificador_fel` en texto libre) | — | Ver §Credenciales |
| Ambiente TEST/PROD | No | — | |

**No se inventó ningún valor.** La lista completa de faltantes y preguntas está en [DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md).

## 5. Referencia de Milenium (solo estructura)

**XML históricos** (9 en la raíz de la copia revisada): esquema SAT `dte/fel/0.2.0`, firmados digitalmente, `Tipo` observado = `FCAM` en los 9 (**no se asume que todos sean FCAM**), certificador `INFILE, S.A.`. Estructura (solo nombres):

- `GTDocumento › SAT › DTE › DatosEmision`
  - `DatosGenerales` [CodigoMoneda, FechaHoraEmision, Tipo]
  - `Emisor` [AfiliacionIVA, CodigoEstablecimiento, CorreoEmisor, NITEmisor, NombreComercial, NombreEmisor] + `DireccionEmisor` (Direccion, CodigoPostal, Municipio, Departamento, Pais)
  - `Receptor` [CorreoReceptor, IDReceptor, NombreReceptor] + `DireccionReceptor`
  - `Frases › Frase` [CodigoEscenario, TipoFrase]
  - `Items › Item` [BienOServicio, NumeroLinea] (Cantidad, UnidadMedida, Descripcion, PrecioUnitario, Precio, Descuento, Impuestos › Impuesto (NombreCorto, CodigoUnidadGravable, MontoGravable, MontoImpuesto), Total)
  - `Totales` (TotalImpuestos › TotalImpuesto [NombreCorto, TotalMontoImpuesto], GranTotal)
  - `Complementos › Complemento` [IDComplemento, NombreComplemento, URIComplemento] › `AbonosFacturaCambiaria` › `Abono` (NumeroAbono, FechaVencimiento, MontoAbono)
- `Certificacion`: NITCertificador, NombreCertificador, `NumeroAutorizacion` [Numero, Serie], FechaHoraCertificacion
- `Adenda` (campos propios de Milenium, no del esquema SAT): código de cliente, días de crédito, dirección de entrega, crédito/contado, ruta, vendedor, centro de costo, observaciones, correlativo interno, `NUMERO_GUID`, tasa de cambio, NIT extranjero, nota legal de facturas cambiarias, etc.

**Tablas DBF de ventas** (solo nombres de campo): `cc03` y `cc05` incluyen campos de número y autorización FEL del documento (`NUMFEL`, `AUTFEL`), de la factura que se anula (`SERANUF`, `NUMANUF`, `NUMFELANU`, `AUTFELANU`), de factura aplicada por nota (`SERFACA`, `NUMFACA`, `NUMFELA`, `AUTFELA`), de exportación (`TIPEXP`, `NUMEXP`, `FRAEXIV`, `ESCEXIV`), retenciones (`RETIVA`, `RETISR`), exenta, moneda y tasa de cambio, y un `NUMGUID`. Esto confirma que Milenium maneja facturas, anulaciones, notas aplicadas, exportación y retenciones: **el alcance FEL real es más amplio que FCAM**.

**Plantillas** `fFacturaFel`, `fFacturaFelUnitarioYTotales`, `fnotacreditofel` (FRX/FRT): referencia visual para el PDF.

Uso permitido y previsto: casos de comparación (ver ARQUITECTURA §12). **No** se copian datos al repositorio ni se importan en esta fase.

## 6. Riesgos principales detectados

1. Emitir facturas fiscales con un modelo sin IVA/receptor/moneda congelados.
2. Emisor ambiguo (entidad vs tenant).
3. Doble certificación por reintento ciego tras un timeout.
4. Doble facturación del mismo viaje entre Milenium y SITSA durante la transición.
5. Secretos del certificador con la clave maestra de sesión (`AUTH_SECRET`): rotarla dejaría los secretos ilegibles.
6. Marcar una factura como emitida/anulada en BD sin confirmación del certificador.
7. Fuga de datos sensibles (XML, tokens) en logs.
8. Mezclar documentos de prueba con los reales.
