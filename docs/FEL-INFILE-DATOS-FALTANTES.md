# FEL con INFILE — Datos y accesos faltantes

Estado: checklist. **No se inventó ningún valor.** Sección A = datos que faltan dentro de SITSA / negocio. Sección B = lo que hay que pedir a INFILE. Ver [DISCOVERY](FEL-INFILE-DISCOVERY.md), [ARQUITECTURA](FEL-INFILE-ARQUITECTURA.md) y [PLAN](FEL-INFILE-PLAN.md).

## A. Datos internos y decisiones de negocio

### A1. Por emisor (KT, Mónaco y los demás; uno por entidad)
- [ ] NIT del emisor
- [ ] Nombre del emisor tal como figura ante la SAT / nombre comercial
- [ ] Afiliación al IVA (código) y régimen
- [ ] Código de establecimiento (y si hay más de uno)
- [ ] Dirección fiscal estructurada: dirección, código postal, municipio, departamento, país
- [ ] Correo y teléfono del emisor
- [ ] Frases requeridas (tipo y escenario) según régimen
- [ ] Moneda(s) de facturación
- [ ] Tipo de documento predeterminado
- [ ] Qué entidad (KT/MONACO) emite cada factura hoy (`fact_facturas` no lo guarda)
- [ ] Fecha de corte desde la cual SITSA emite (por emisor)

### A2. Por cliente (receptor)
- [ ] Tipo de identificación (NIT / CUI / extranjero / consumidor final) y NIT validado
- [ ] Nombre fiscal a facturar, correo FEL, dirección con departamento/municipio
- [ ] Qué campo manda cuando difieren `clientes` y el cuestionario (`razon_social_cliente`, `nit_cliente`, `direccion_factura`, `correo_factura`)
- [ ] Días de crédito y si el cliente genera factura cambiaria
- [ ] Retenciones (IVA/ISR) y exenciones

### A3. Reglas de facturación (decisión de negocio)
- [ ] ¿La `tarifa_comercial`/`monto_asignado` **incluye IVA**? ¿Hay exentos?
- [ ] Descripción del ítem: ¿una línea por viaje? ¿qué texto (ruta, código, el «descripción que piden en la factura» del cliente)?
- [ ] Unidad de medida y tipo bien/servicio de los ítems
- [ ] Tipos de documento que realmente se emiten (FACT, FCAM, notas, exportación, otros)
- [ ] Notas de crédito: ¿en qué casos? ¿cómo se tratan las facturas con pagos?
- [ ] Redondeo y moneda extranjera (tasa de cambio)
- [ ] ¿Se usará la Adenda (código de cliente, ruta, correlativo) como en Milenium?
- [ ] Quién puede certificar / anular / conciliar (roles)

### A4. Operación
- [ ] Contador/responsable que valida cada fase
- [ ] Cómo seguirá la contabilidad durante la convivencia (captura manual o exportación desde SITSA)
- [ ] Viajes ya facturados en Milenium que hay que marcar en `fact_viajes_facturacion_externa` (criterio: por fecha de corte, por cliente o lista; quién autoriza el marcado y su reversión; formato de la referencia externa: serie/número/autorización)
- [ ] Variable de entorno `FEL_CREDENTIALS_KEY` (la configura el responsable; nunca en git)

## B. Checklist para solicitar a INFILE

Pedir por escrito (y guardar la versión/fecha de cada documento recibido). **Ninguno de estos datos está asumido en el diseño.**

- [ ] Documentación oficial y vigente de la API (y su versión; política de cambios)
- [ ] URL de **sandbox** y URL de **producción** (¿y rutas distintas por operación?)
- [ ] Método de autenticación (usuario/llave/token), vigencia de tokens, renovación
- [ ] **Credenciales de sandbox** (por emisor) y **credenciales de producción** (por emisor), y cómo se rotan
- [ ] Formato del payload: ¿XML DTE firmado por SITSA o por INFILE? ¿JSON? ¿esquema y versión (Milenium usa DTE 0.2.0)?
- [ ] Quién firma el documento (¿firma en el certificador o certificado propio del emisor?)
- [ ] Tipos de DTE soportados y su código (FACT, FCAM, notas de crédito/débito, exportación, otros)
- [ ] Operación de **certificación**: request/response, campos devueltos (autorización, serie, número, fecha, XML, PDF)
- [ ] Operación de **anulación**: payload, plazos, condiciones, respuesta
- [ ] Operación de **consulta/estado** (por qué identificador: UUID del emisor, autorización, referencia propia) y **cómo responde cuando el documento NO existe** (código HTTP, cuerpo, código de error) y cuando está **en proceso**; sin esto no se puede declarar `NO_ENCONTRADO` ni habilitar un reenvío seguro
- [ ] ¿La consulta puede tener **consistencia eventual** (cuánto debe esperarse tras el envío antes de que «no existe» sea confiable)?
- [ ] ¿Se puede **reutilizar la misma referencia** tras un rechazo definitivo, o hay que enviar una nueva?
- [ ] Cómo distingue INFILE los **ambientes** (URL, host, credenciales, campos) para validar que una configuración TEST no se use como PROD
- [ ] **Idempotencia**: ¿aceptan un identificador/referencia del emisor que impida duplicados? ¿qué responden ante reenvío del mismo documento?
- [ ] Catálogo de **errores/códigos** (validación vs transitorios) y cuáles son reintentables
- [ ] Timeout recomendado, **límites/rate limits**, concurrencia máxima
- [ ] ¿Webhooks o notificaciones? ¿callbacks de estado?
- [ ] ¿Generan **PDF**? ¿formato, URL, vigencia del enlace, personalización/logo?
- [ ] XML devuelto: ¿certificado completo? ¿conservación/descarga posterior?
- [ ] Series: ¿quién asigna serie y número? ¿series por establecimiento? ¿serie separada para la transición?
- [ ] Soporte de **Adenda** y campos libres
- [ ] Ambiente de pruebas SAT (¿los documentos del sandbox llegan a la SAT de pruebas?) y reglas para pasar a producción (homologación/certificación del integrador, si aplica)
- [ ] Datos de contacto de soporte técnico y SLA
- [ ] Condiciones comerciales relevantes para el diseño (costo por documento, límites)

## C. Material de referencia ya disponible (sin copiar datos)

XML certificados históricos, PDFs, plantillas `fFacturaFel`/`fnotacreditofel` y tablas DBF de Milenium (solo para comparar estructura y totales; ver DISCOVERY §5). Los tests usarán fixtures sintéticos.
