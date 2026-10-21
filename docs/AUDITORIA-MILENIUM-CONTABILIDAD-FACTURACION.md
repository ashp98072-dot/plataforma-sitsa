# Auditoría técnica y funcional del sistema legacy «Milenium» (contabilidad y facturación)

Estado: **DISCOVERY / AUDITORÍA. Documento versionado únicamente como documentación; sin cambios de código, sin SQL de escritura, sin llamadas a INFILE/SAT, sin emitir ni enviar documentos, sin tocar producción ni Hostinger.**
Fecha: 2026-10-08. Base de SITSA revisada: `origin/main` (incluye #421–#428).
Documentos hermanos ya existentes (esta auditoría los **confirma, corrige o completa** con evidencia nueva): [`FEL-INFILE-DISCOVERY`](FEL-INFILE-DISCOVERY.md) · [`FEL-INFILE-ARQUITECTURA`](FEL-INFILE-ARQUITECTURA.md) · [`FEL-INFILE-PLAN`](FEL-INFILE-PLAN.md) · [`FEL-INFILE-DATOS-FALTANTES`](FEL-INFILE-DATOS-FALTANTES.md) · [`MILENIUM-INVENTARIO-FUNCIONAL`](MILENIUM-INVENTARIO-FUNCIONAL.md) · [`MILENIUM-CONTABILIDAD-FASE1/2/2B`](MILENIUM-CONTABILIDAD-FASE1.md).

> **Cómo se hizo (y sus límites).** El análisis es **estático y de solo lectura** sobre la copia del sistema ubicada en `Downloads/Milenium2000` (zip de 1.6 GB; 4.7 GB descomprimido; archivos fechados hasta mayo de 2026). Se leyeron: el manual de usuario (139 págs., 2014), las instrucciones de instalación, cabeceras y filas **agregadas** de tablas DBF/DBC (conteos, tipos, estructura), plantillas de reportes (FRX), el log de errores de Visual FoxPro, 9 XML FEL de ejemplo y el **historial de llamadas FEL** que Milenium guarda (estructura de solicitud/respuesta). **No se ejecutó ningún EXE, DLL ni proceso del origen.** No se copiaron datos al repositorio. En este informe **no aparece ningún secreto, NIT, nombre de cliente ni valor financiero individual**; de las credenciales solo se indica *dónde están*.
>
> **Limitación principal:** **no hay código fuente** (no existen `.prg/.scx/.vcx/.pjx/.mnx`; solo `sistema.EXE` y archivos auxiliares). El ejecutable está comprimido/ofuscado (no expone cadenas legibles de URLs ni SQL). Por eso el flujo se reconstruye a partir de **manual + datos + plantillas + historial FEL**, no del código. Cada afirmación relevante se rotula con una de tres categorías que se mantienen **separadas**: **COMPROBADO** (visto directamente en datos o archivos de la copia), **INFERIDO** (deducido de nombres, estructura o del diseño; puede estar equivocado) o **PENDIENTE DE CONFIRMACIÓN** (no se puede afirmar con esta copia: requiere el código fuente, a Contabilidad/TI o a INFILE).

### Matriz de evidencia (resumen de lo más importante)

| Tema | COMPROBADO | INFERIDO | PENDIENTE DE CONFIRMACIÓN |
|---|---|---|---|
| Tecnología | Visual FoxPro 9, tablas DBF/CDX/FPT en carpeta compartida, 12 carpetas de empresa, ejecutable compilado sin fuente | Reglas de negocio implícitas en el EXE (IVA, correlativos, póliza automática) | Algoritmos exactos del código |
| Viaje → factura | No existen tablas de viajes con datos; la factura es genérica con líneas de servicio y descripción libre | El vínculo viaje↔factura es manual y humano | Proceso real de captura (validar con el operador) |
| Proveedor FEL | INFILE, S.A. en los XML certificados y en 49 601 registros del historial FEL | — | Contrato vigente con INFILE |
| Integración INFILE | Solicitud: DTE XML sin firma; respuesta: JSON con uuid, serie, número y XML certificado (estructura vista en el historial) | Que se transmite por HTTP (curl/WinHTTP) y que INFILE firma el documento | **Endpoint exacto, autenticación, ambiente sandbox/producción y mecanismo oficial de idempotencia: NO se conocen todavía** |
| Duplicados | 129 referencias internas tienen más de un UUID certificado; el GUID de la Adenda cambia entre reintentos en la mayoría de los casos | Que Milenium no implementa una clave de idempotencia estable | **Si esas 129 son reemisiones legítimas tras anulación o posibles duplicados: requieren revisión de Contabilidad; no se afirma doble facturación** |
| Windows 7 | Existe protección con llave de hardware Sentinel (DLL y servidor de llaves); instrucciones de 2014 con puerto paralelo | Que la llave/driver pueda limitar el uso de un Windows moderno | **Si Milenium requiere obligatoriamente Windows 7: no se comprobó**; tipo de llave (paralelo/USB), driver y versión de Windows de las estaciones |
| Seguridad | Hay credenciales/llaves FEL almacenadas **en texto claro** en una tabla de datos (no se reproducen sus valores); copia completa del sistema en esta estación | Claves de operador con ofuscación reversible (no hash) | Si la clave por defecto del administrador fue cambiada; quién accede a la carpeta compartida |
| Contabilidad | Módulos y reportes listados en el menú; volumen de pólizas, bancos y cartera | Semántica de varios tipos de documento (`R/E/C/A`) | Tipos `E`, series `0A`/`FL`, uso real de cada módulo |

---

## 1. Resumen ejecutivo

1. **Milenium 2000 («Millenium») es un ERP contable de escritorio en Visual FoxPro 9**, cliente–servidor *de archivos* (DBF/CDX/FPT sobre una carpeta compartida de Windows), con 14 módulos: Contabilidad, Bancos, Inventarios, Producción, Facturación, Cuenta por Cobrar, Cuenta por Pagar, Activos Fijos, Planilla, Mercadeo, Ejecución de Proyectos, Proyectos de Ventas, Requisiciones/Órdenes de compra y Utilitarios. Es **multiempresa**: 12 empresas del grupo, cada una con su carpeta `BASESxxx` de 267 tablas.
2. **No es un software de transporte.** **Milenium no tiene concepto de «viaje»**: no existen tablas con datos de viajes, pilotos, camiones ni plan de rutas (el menú «Despacho por ruteo» existe pero sus tablas están vacías). Una factura de transporte es una **factura genérica con líneas de «servicio»** (SERVICIO DE CONTENEDOR, CAMIÓN 5 TN/10 TN, CUADRILLA…) cuya descripción —ruta, fecha, piloto, viáticos, combustible, hospedaje— es **texto libre** escrito por el usuario. **No hay vínculo viaje→factura en el sistema legacy**; ese vínculo hoy es manual y humano.
3. **Proveedor FEL real: INFILE, S.A.** (COMPROBADO: `NombreCertificador = INFILE, S.A.` en los 9 XML; 49 601 registros del historial con `NOMCER = INFILE` en las 9 empresas con historial FEL). Mecanismo: Milenium arma el **DTE XML sin firmar** (esquema SAT `dte/fel/0.2.0`; anulación `0.1.0`), lo envía a INFILE (que **firma y certifica**), y recibe **JSON** con `resultado, uuid, serie, numero, xml_certificado (Base64), control_emision{Saldo, Creditos}, alertas_infile, alertas_sat, descripcion_errores[]`. **PENDIENTE DE CONFIRMACIÓN con INFILE (todavía no se conocen): el endpoint exacto, el método de autenticación, el sandbox y el mecanismo oficial de idempotencia** (ver §7.1). Existen credenciales/llaves FEL (alias, código y dos llaves) **almacenadas en texto claro** en una tabla de datos (§12); en este informe **no se copian ni se exponen sus valores**.
4. **Documentos reales emitidos:** facturas cambiarias electrónicas **FCAM** (serie FE en KT, F3 en Mónaco), **notas de crédito NCRE** (serie NF), **notas de abono NABN** (serie NA) y **facturas especiales FESP** (serie ES), más anulaciones. Todo en **GTQ**, **IVA 12 % incluido en el precio**, sin exportación ni retenciones usadas en los datos revisados.
5. **Contabilidad completa pero tradicional:** catálogo de cuentas multinivel, pólizas (196 mil líneas solo en KT), libros de diario/mayor, balances, estados de resultados, presupuestos, **libros de ventas/compras y archivo para ASISTE LIBROS**, bancos con conciliación, CxC, CxP, activos fijos, planilla. La **póliza de ventas se genera automáticamente** desde la factura según cuentas parametrizadas.
6. **Riesgos críticos:** (a) **llaves de INFILE en claro** en `f50` dentro de la carpeta compartida, y **una copia completa con esas llaves está en Descargas** de esta estación; (b) **no se observa un mecanismo de idempotencia** (el GUID de la Adenda se regenera entre reintentos) y **129 referencias internas tienen más de un UUID certificado: requieren revisión de Contabilidad para distinguir reemisiones legítimas tras una anulación de posibles duplicados** (no se afirma doble facturación); (c) base de datos de archivos sin transacciones reales, con caídas `C0000006` recurrentes; (d) licencia por **llave de hardware Rainbow/SafeNet Sentinel** con driver antiguo — **INFERIDO** como posible limitación para modernizar el sistema operativo; **no se comprobó que Milenium requiera obligatoriamente Windows 7**; (e) sin código fuente.
7. **Recomendación:** no reemplazar de golpe. La **primera pieza a migrar** es la **capa «viaje cerrado → documento por facturar»** (lo que Milenium nunca tuvo) junto con el dominio FEL contra un **proveedor simulado** validado con las **estructuras reales** de solicitud/respuesta de INFILE que esta auditoría documenta; la certificación real en sandbox, la cartera y la contabilidad vienen después, con Milenium emitiendo oficialmente hasta una fecha de corte por emisor.

---

## 2. Arquitectura de Milenium

### 2.1 Inventario técnico (COMPROBADO salvo indicación)
| Aspecto | Hallazgo |
|---|---|
| Lenguaje / framework | **Visual FoxPro 9.0** (runtime `vfp9r.dll`/`vfp9t.dll`/`vfp9resn.dll`, MSVCR71; `VFP9RENU.DLL`). Librerías de la comunidad: **FoxyPreviewer** (vista previa/exportación de reportes), `reportbuilder/reportoutput/reportpreview.app` (ReportListener de VFP 9 SP2) |
| Tipo | Aplicación **de escritorio** (32 bits), cliente–servidor de **archivos**: el cliente ejecuta `\\<servidor>\Milenium2000\sistema.exe` y abre los DBF por SMB. No hay motor de base de datos de servidor |
| Punto de entrada | `sistema.EXE` (3.9 MB, compilado y comprimido; el log de errores muestra `main1` → `mainform`). Utilitarios: `creabases.exe` (crea/estructura las bases de una empresa), `importadatos.exe` (importación), `borraemp.exe` (borra empresa), `foxhhelp9.exe` (ayuda `Manual.chm`) |
| Código fuente | **No disponible** (solo compilados). No traducible automáticamente |
| Tamaño | 4.7 GB; **12 carpetas de empresa** (`BASES000…BASES00B`, 585 archivos / 267 DBF cada una); 48 DBF «generales» en la raíz |
| Estructura de menú | Tabla `opciones` (5 016 filas): 12 empresas → 14 módulos → submenús (Configuración / Ingreso de transacciones / Reportes / Utilitarios) → opciones; permisos por operador y empresa en `s06` (89 536 filas) |
| Componentes externos | `Sxfoxpro.dll` + `NSLMS324.DLL` + servidor `RainbowSSD` = **Rainbow/SafeNet Sentinel SuperPro / NetSentinel 5.31** (COMPROBADO: existe protección por llave de hardware Sentinel; las instrucciones de 2014 piden «poner el procesador en el puerto paralelo»; **INFERIDO** que el sistema depende de esa llave para ejecutarse). `MiDll.dll` (2017, 45 KB): envoltorio propio de **impresión GDI directa** (`CreaDC/EmpiezaDoc/EmpiezaPagina/EndPage`). `libhpdf.dll` (libharu) para PDF. `sqlite3.dll` (uso pendiente de confirmación). `GdiPlus.dll.old` |
| Instalador | `Instrucciones.txt` (2014): copiar `\sistema` al servidor, **compartir con control total y sin «solo lectura»**, instalar el servidor de llaves, `setup.exe` en cada cliente, acceso directo «iniciar en» la ruta de red |
| Servicios / tareas programadas | No hay servicios propios ni tareas programadas en la copia (la llave de hardware usa un servicio de Windows del fabricante). Sin evidencia de procesos batch nocturnos |
| Rutas compartidas | Recurso SMB `\\<servidor>\Milenium2000` (el log muestra que migró de un servidor anterior al servidor actual de la empresa en 2026). Nota `OptLocks en el server.txt`: se desactivan *oplocks* (`MRXSmb OplocksDisabled=1`) y se suben los reintentos de violación de uso compartido — **parche clásico para evitar corrupción de DBF sobre SMB** |
| Impresoras | Reportes FEL a «Microsoft Print to PDF» / «Bullzip PDF Printer»; formatos **preimpresos** (cheques, facturas, planillas, etiquetas) con coordenadas X/Y en `imp01–imp06`; impresión directa por `MiDll.dll` |
| Windows 7 | **No se comprobó que sea obligatorio.** Posibles limitaciones inferidas: llave Sentinel y su driver, impresión directa, SMB (ver §13) |
| Código activo vs abandonado | **Activo:** facturación FEL, CxC, contabilidad, bancos, CxP (miles de movimientos hasta 2026). **Sin datos / aparentemente sin uso:** Producción, Mercadeo, Proyectos, Despacho por ruteo, Activos fijos en KT (tablas vacías o casi) |
| Componentes críticos | La carpeta de datos de cada empresa; `f50/f12` (series y credenciales FEL); `f61` (historial FEL, único respaldo local de lo certificado); la llave de hardware |

### 2.2 Empresas del grupo en la copia
`00` Logiservicios Mónaco (histórico) · `01` **Transportes SITSA Kuiq Trans (KT)** · `08` **Logiservicios Mónaco (actual)** · `02`–`07`, `09`, `0A`, `0B`: otras empresas y carpetas del grupo (incluida una de restauración de respaldos y una de persona individual), que no se nombran aquí porque no son objeto de este proyecto. Para este proyecto (transporte) importan **KT (`BASES001`)** y **Mónaco (`BASES008` actual + `BASES000` histórico)**, consistente con los documentos previos.

Volumen (registros en `f06` facturas / historial FEL / `cc03` detalle CxC / `co03` líneas de póliza):
| Empresa | Facturas | Historial FEL | CxC detalle | Líneas de póliza |
|---|---:|---:|---:|---:|
| 01 KT | 12 529 | 9 499 | 16 713 | 196 002 |
| 08 Mónaco actual | 721 | 867 | 1 211 | 13 927 |
| 00 Mónaco histórico | 204 | 0 | 279 | 3 348 |
| (resto del grupo: empresas 02–07, 09) | ~42 000 | ~39 000 | | |

---

## 3. Tecnologías

Visual FoxPro 9 (xBase), tablas libres DBF con índices CDX y memos FPT; reportes FRX/FRT; formularios SCX (compilados); SMB; Sentinel SuperPro; libharu (PDF); FoxyPreviewer (vista previa y exportación a PDF/XLS/HTML); Excel/CSV como medio de importación y exportación; SMTP para enviar documentos (tabla `f76` con servidores/puertos: proveedor de hosting propio, Gmail y Yahoo, puerto 465). VFP 9 está **sin soporte de Microsoft desde 2015** (y Windows 7 desde 2020, si las estaciones aún lo usan: PENDIENTE DE CONFIRMACIÓN).

---

## 4. Base de datos

| Aspecto | Hallazgo |
|---|---|
| Motor / versión | **Archivos DBF de Visual FoxPro 9** (cabecera 0x30/0x31). Sin servidor |
| Contenedores | `bgeneral.dbc` (45 tablas, 293 campos, 70 índices) y `administracion.dbc` en la raíz; **`gcBAse.DBC` por empresa: 267 tablas, 4 141 campos, 554 índices, 3 vistas**. **Sin procedimientos almacenados, sin triggers, sin relaciones persistentes ni integridad referencial en el contenedor** (COMPROBADO: el código de procedimientos del DBC mide 0 bytes) |
| Vistas | `blistacuentas` (lista de cuentas bancarias), `vclientesporlimcre` (clientes por límite de crédito), `pvlistaausencias` (planilla) — solo apoyo de pantallas |
| Reglas de negocio | **Viven en el código compilado**, no en la base: IVA, correlativos, pólizas automáticas, saldos |
| Claves / secuencias | Claves por convención (serie + número, códigos C/N). **Correlativos** en `f12` (`fcorrelativosporserie`: último número por serie) y `f12a` (lista de correlativos); `UNIQUE` no garantizado por el motor |
| Concurrencia | Bloqueos de registro/archivo de VFP sobre SMB; sin transacciones ACID entre tablas (el DBC declara `TransactionLog` pero no se usa como garantía) |
| Integridad | Rotulado: **BAJA** (corrupción de DBF/CDX documentada: 102 caídas `C0000006` y 11 `C0000005` registradas 2019–2026) |

### 4.1 Mapa funcional de tablas (solo las que existen)
Nombre largo del DBC → archivo. Se indica si hay datos en KT.

| Tema solicitado | Tabla (archivo) | Registros KT | Observación |
|---|---|---:|---|
| **Clientes** | `cccatalogoclientes` (`cc01`) | 214 | 52 campos: NIT, nombre comercial/de factura, correo, dirección, días de crédito, límite de crédito, cartera, vendedor, ruta, lista de precios, tipo de identificación, correo de envío, meses de facturación recurrente |
| Proveedores | `cccatalogoproveedores` (`cc02`) | 1 147 | |
| **Facturas (cabecera)** | `fcabecerafacturas` (`f06`) | 12 529 | 117 campos (ver §6) |
| **Detalle de factura** | `fdetallefacturas` (`f07`) | 27 177 | línea: artículo, cantidad, precio unitario, total, descuento, **memo `OTRDES` (descripción libre)**, flag servicio |
| Copias `f06e` / `f07e` | `f06e`, `f07e` | 482 / 624 | misma estructura que factura/detalle; **semántica por confirmar** (¿cola de emisión, espejo o facturas eliminadas?) |
| **Series y correlativos** | `fcorrelativosporserie` (`f12`), `fseriesface` (`f50`), `flistacorrelativos` (`f12a`) | 8 / 4 / 472 | `f12`: serie, tipo de documento, activo FEL, certificador; **`f50`: configuración FEL por serie y credenciales** |
| **Documentos FEL** | `fhistorialfel` (`f61`) | 9 499 | UUID, serie/número FEL, referencia interna, fecha de envío, **XML enviado, respuesta, XML certificado**, certificador, tipo (CERTIFICACION/ANULACION), GUID |
| Frases / escenarios | `f62`, `f63` | 1 / 4 | catálogo de frases SAT |
| Rutas (catálogo) | `fcatalogorutas` (`f01`) | 2 | origen/destino/distancia **vacíos** (agrupador comercial) |
| Vendedores | `fcatalogovendedores` (`f02`) | 1 | comisiones |
| **Servicios / artículos** | `icatalogoarticulos` (`i08`) | 18 | «servicio de contenedor / camión 5 TN / camión 10 TN / cuadrilla / plataforma / estadía / tiempo de espera…» |
| Impuestos | `cccxprangosretenciones` (`cc17`), parámetros de IVA en utilitarios | 1 | IVA 12 % como tasa de sistema; retenciones por rangos (CxP) |
| **Cuenta por cobrar (cabecera de transacciones)** | `cccxccabeceratransacciones` (`cc05`) | 5 793 | recibos/pagos, notas de crédito/cargo, anticipos; **incluye campos de FEL, anulación FEL y factura aplicada** |
| **Cuenta por cobrar (detalle de aplicación)** | `cccxcdetalletransacciones` (`cc03`) | 16 713 | aplicación de cada transacción a documentos |
| Cheques de clientes | `cccheprefec` (`cc30`) | 1 202 | cheques posfechados |
| **Pagos / bancos** | `btransacciones` (`b03`), `bcatalogobancos`, `bcatalogocuentas`, `bfechaconcilia` | 29 366 | depósitos, cheques, notas, conciliación |
| **Contabilidad** | `cocatalogocuentas` (`co01`) 658; `cocabecerapolizascontables` (`co02`) 662; `codetallepolizascontables` (`co03`) 196 002; `coexplicacionpolizas`; `coperiodoscontables` (`co06`) | | catálogo, pólizas, detalle, explicación (memo), períodos |
| Pólizas automáticas de ventas | `fpolizadeventas` (`f10`) | 1 | cuentas de caja, clientes, IVA por pagar, ventas, ganancias, anticipos… |
| CxP | `cccxptransacciones` (`cc06`), `cccxpdetalle` (`cc08`) | 40 275 / 72 580 | |
| Activos fijos | `afcatalogoactivosfijos` y afines | 4 ubicaciones | uso mínimo |
| Usuarios / permisos | `s05` (67 operadores), `s06` (permisos), `s10` | | |
| Empresas | `s02` (12) | | datos fiscales de cada empresa |
| Tasas de cambio / monedas | `g01` (175), `g02` | 0 | multimoneda configurada, **todo se factura en GTQ** |
| Auditoría | Campos `QUIENGRABO / QUIENMODIF / HORAGRABAD / HORAMODIFI` en las tablas principales; log de llamadas FEL `f61`; **no existe tabla de bitácora general** | | auditoría mínima (usuario y hora de alta/última modificación) |

**No existen** (no inventar): tabla de viajes, de pilotos/camiones con datos, de notas de débito FEL (hay soporte de nota de cargo en CxC pero `ESNDB` = falso en las series), de exportación (`EXPOR` = 0), de “empresas emisoras” separadas del esquema `s02`, ni de “UUID” como tabla propia (el UUID vive en `f61` y en `f06.AUTFEL`).

---

## 5. Módulos de Milenium

Menú real de KT (verificado en `opciones`): **Contabilidad** (43 opciones) · **Bancos** (29) · **Inventarios** · **Producción** · **Facturación** (39) · **Cuenta por Cobrar** (31) · **Cuenta por Pagar** (23) · **Activos Fijos** · **Planilla** · **Mercadeo** · **Ejecución de proyectos** · **Proyectos de ventas** · **Requisiciones y órdenes de compra** · **Utilitarios** (20). Cada módulo = *Configuración / Ingreso de transacciones / Reportes / Utilitarios*.

---

## 6. Flujo «viaje → factura» (el más importante)

**Conclusión previa:** en Milenium **no existe «viaje → factura»**; existe «**el usuario digita una factura**». El viaje vive en otros sistemas o en la cabeza/Excel del operador. A continuación, paso por paso, lo comprobado (fuentes: manual §Facturación, estructura de `f06/f07`, plantillas FRX, y 9 XML/49 601 registros FEL).

**Pantallas de captura** (Facturación → Ingreso de transacciones): *Ingreso de facturación normal* (con póliza automática), *Generar facturación automática* (facturación recurrente por cliente: meses y día de facturación en `cc01`), *Lista de artículos a facturar recursivamente por cliente* (CxC), *Importación masiva de facturas de ventas* (Contabilidad → IVA), *Captura de consumos / moras / consumo de agua* (módulos de otro giro).

| # | Elemento | Cómo ocurre (COMPROBADO / INFERIDO) | Obligatorio |
|---|---|---|---|
| 1 | Selección del «viaje» | **No hay selección de viaje.** Se elige el **cliente** y se capturan líneas de servicio | — |
| 2 | Cliente | Código de cliente → `cc01` (cabecera: copia congelada de código, nombre de factura, NIT, dirección, teléfono) | Sí |
| 3 | NIT | Del cliente; editable en la factura. Tipo de identificación (`TIPOID`: NIT / otros) | Sí |
| 4 | Nombre / razón social | `NomFac` del cliente; editable | Sí |
| 5 | Dirección fiscal | Del cliente; editable | Sí (FEL la exige en el DTE) |
| 6 | Correo | `EMAIL`/`MAILENV` del cliente; puede enviarse el documento por correo (SMTP) | Opcional |
| 7 | Tipo de documento | Lo determina la **serie** elegida (`f12/f50`): FE → FCAM; NF → NCRE; NA → NABN; ES → FESP | Sí |
| 8 | Descripción del servicio | **Texto libre por línea** (memo `OTRDES`); artículo genérico («servicio de contenedor»…). Palabras recurrentes: renta, flete, hacia, fecha, camión, piloto, auxiliar, viáticos, combustible, hospedaje, entregas, destinos varios, descarga | Sí (texto) |
| 9 | Origen/destino | **Solo dentro del texto libre.** `fcatalogorutas` tiene origen/destino/distancia vacíos y se usa como agrupador comercial | No |
| 10 | Fecha | Fecha de factura; `FechaHoraEmision` del DTE | Sí |
| 11 | Tarifa | **Digitada** por línea (precio unitario con IVA); listas de precios casi sin uso (1 lista) | Sí |
| 12 | Subtotal | `SUBTOT_CFA` = suma de líneas (con IVA incluido); descuento por línea o por factura | Calculado |
| 13 | IVA | **12 % incluido en el precio**: `IVA = total / 1.12 × 0.12` (verificado en 2 999 de 3 000 facturas); separado en bienes/servicios/exentos (`IVABIE/IVASER`, `TOTBIE/TOTSER/TOTEXE`) | Calculado |
| 14 | Total | `TOTFAC_CFA`; hay copia en moneda local (`...L`) para multimoneda | Calculado |
| 15 | Moneda | `CODMON` (siempre GTQ en los datos) y `TASACAM` (1.000000) | Sí |
| 16 | Retenciones | Campos `RETISRR/RETIVAR/RETIVA/RETISR` existen pero **no se usan** en los datos (todas falsas) | No |
| 17 | Serie | Elegida por el usuario entre las series activas | Sí |
| 18 | Número | **`AUTONUM`**: Milenium asigna el correlativo interno (`f12.CORRE`) y, con FEL, **INFILE asigna serie y número de autorización**; ambos se guardan (`NUMFEL`, `AUTFEL`) | Auto |
| 19 | Usuario que factura | `QUIENGRABO` / `QUIENMODIF` + `Operador` en la Adenda del DTE | Auto |
| 20 | Empresa emisora | La empresa de trabajo seleccionada al entrar (`EmpresaOrigen` en la Adenda); datos fiscales en `s02`/`f50` | Auto |
| 21 | Referencias internas | `CorrelativoInterno` (p. ej. serie+número local), `CodigoCliente`, `CodigoRuta`, `CodigoVendedor`, `CodigoCentroCosto`, `NUMERO_GUID` (se envían como **Adenda**) | Auto |
| 22 | Observaciones | Hasta 100 caracteres en cabecera (casi siempre usadas) | No |
| 23 | UUID / autorización FEL | Del JSON de INFILE; se guarda en `f06.AUTFEL/NUMFEL` y en `f61` | Auto |
| 24 | XML | XML enviado, respuesta JSON y **XML certificado** (Base64 en la respuesta, decodificado en `DECXML`) se **conservan completos en `f61`** | Auto |
| 25 | PDF | Reporte FRX (`fFacturaFel`, `fFacturaFelUnitarioYTotales`, `fnotacreditofel`) → «Microsoft Print to PDF»/Bullzip; carpeta `FacturasPdf`; opción por serie para generar PDF y adjuntarlo | Auto |
| 26 | Impresión | Por impresora de Windows o por `MiDll.dll` (formas preimpresas) | Opcional |
| 27 | Envío por correo | SMTP (`f76`); marcas `MAILED_CFA`/`MODMAIL`; copia por serie (`CCEMAIL`) | Opcional |
| 28 | Contabilización | **Póliza de ventas automática** (cuentas de `f10`) o manual; regenerable por utilitario; afecta Contabilidad e Inventarios | Auto |
| 29 | Cuenta por cobrar | Si la factura es **a crédito** (`CREDIT`), nace como documento de cartera con `DIASCR`; el saldo **se deriva** de las aplicaciones (no hay campo de saldo almacenado) | Auto |

Bloqueos y reglas observadas: factura contado/crédito (7 021 de 12 529 son a crédito; plazos más usados 30, 90, 45, 20 días; también aparecen valores atípicos como 100 u 800 en `DIASCR`, que sugieren uso del campo para otra cosa — dato a depurar); anulaciones con motivo obligatorio (1 787 anuladas en KT; **816 anulaciones FEL**); utilitarios de **corregir número de factura**, **cambiar código de cliente de una factura**, **modificar el detalle de artículos de una venta** y **rehabilitar facturas** (motivos de rehabilitación): es decir, **Milenium permite alterar documentos ya emitidos internamente**, lo que obliga a vigilar la coherencia con lo certificado.

---

## 7. Integración FEL (INFILE)

### 7.0 Lo que TODAVÍA NO se conoce de INFILE (PENDIENTE DE CONFIRMACIÓN)
Esta auditoría **no establece** y no debe usarse como fuente para: **(1) el endpoint exacto** (URL y operaciones) de certificación, consulta y anulación; **(2) el método de autenticación** (cabeceras, tokens, vigencia); **(3) el sandbox** (URL, credenciales de prueba y cómo se distingue de producción); **(4) el mecanismo oficial de idempotencia** (si INFILE acepta un identificador del emisor, qué responde ante un reenvío y cómo consultar un documento inexistente o en proceso). Todo ello debe obtenerse de la **documentación oficial de INFILE** y de su soporte antes de escribir código de integración (ver `FEL-INFILE-DATOS-FALTANTES §B`).

### 7.1 Proveedor, versión y formatos (COMPROBADO salvo lo marcado)
- **Certificador:** INFILE, S.A. (en el XML certificado, en las plantillas del PDF y en el campo `NOMCER_FLF` de las 9 empresas con historial FEL).
- **Esquema SAT:** `GTDocumento` `http://www.sat.gob.gt/dte/fel/0.2.0` (versión 0.1 del documento); anulación `GTAnulacionDocumento` `…/fel/0.1.0`; complemento de factura cambiaria `CompCambiaria/0.1.0` (abonos con fecha de vencimiento). Firma XAdES/XML-DSig presente en el documento certificado y ausente en la solicitud (**INFERIDO** que la aplica el certificador).
- **Qué envía Milenium:** el **XML DTE sin firma** (49 601 de 49 601 solicitudes guardadas no contienen `ds:Signature`), con `Adenda` propia.
- **Qué responde INFILE:** JSON `{resultado, fecha, origen, descripcion, control_emision{Saldo,Creditos}, alertas_infile[], alertas_sat[], cantidad_errores, descripcion_errores[{resultado, fuente, categoria, numeral, validacion, mensaje_error}], informacion_adicional, uuid, serie, numero, xml_certificado(Base64)}`. En rechazos, `uuid=""`, `numero=0` y `xml_certificado=""`.
- **Modelo comercial (INFERIDO):** la respuesta incluye `control_emision.Saldo/Creditos`, lo que sugiere un esquema de créditos por documento; confirmar con INFILE y monitorear el saldo.
- **Transporte/protocolo:** el campo `f12.LOGCURL_CP` («registrar llamadas curl»), el utilitario «Limpiar historial de llamadas de facturas electrónicas» y la forma JSON de la respuesta indican **llamadas HTTP (curl/WinHTTP)** — INFERIDO. **El endpoint exacto, el método de autenticación (cabeceras) y los ambientes pruebas/producción NO se conocen** (PENDIENTE DE CONFIRMACIÓN; ver §7.0): el ejecutable está ofuscado y `f76` solo guarda servidores SMTP. Los campos de credenciales que existen (alias, código y dos llaves) sugieren un esquema de firma y de certificación con credenciales distintas, pero **eso es una inferencia y debe confirmarse con la documentación oficial de INFILE** (no asumir).

### 7.2 Configuración (dónde está, sin mostrar secretos)
- **`f50` (`fseriesface`)**: una fila por serie FEL con tipo de documento SAT (`FCAM/NCRE/NABN/FESP`), `TIPAFIF=GEN` (afiliación IVA general), establecimiento = `1`, escenario/frase (`CODESCF/TIPFRAF` = 1/1; FESP usa frase 5), certificador `CERFEL=1`, moneda `GTQ`, país `GT`, datos del emisor (NIT, razón, dirección, municipio, departamento, correo), y **cuatro campos de credenciales: alias, código, llave de firma y llave de certificación** (presentes en las 4 series de KT; **«Existe credencial configurada en `f50`»**). Hay además **campos de credenciales de otro proveedor** (`USERWSGF/PASSWSGF/USERGF/PASSGF/NITEMIGF…`, prefijo «GF») **vacíos** en estas copias: INFERIDO que el sistema soporta o soportó un segundo certificador.
- **`f12`**: por serie, `ACTFEL` (activa FEL), `TIPDOC` (5=FCAM, 6=NCRE, 7=NABN, 8=FESP), `CERFEL`, `AUTONUM`, `IMPPDFC` (generar PDF), `NOGENIVA`, `DEVCERO`, `LOGCURL`.
- **Ambientes:** **no se puede identificar** si la configuración corresponde a pruebas o producción; el historial no marca ambiente. NO ASUMIR.

### 7.3 Flujo FEL completo (COMPROBADO en datos; el transporte es INFERIDO)
Milenium (factura/nota capturada) → arma DTE XML 0.2.0 + Adenda → [firma y certificación en INFILE con alias/llaves] → SAT → respuesta JSON → Milenium guarda `uuid/serie/numero` en la factura (`AUTFEL`, `NUMFEL`) y **toda la conversación** en `f61` → genera PDF (FRX) → imprime/envía por correo → póliza de ventas y cartera.

### 7.4 Manejo de errores (lo que muestra el historial)
- Respuestas: **48 513 con `resultado=true`, 997 con `false`, 91 sin JSON** (falla de conexión/timeout/respuesta no parseable).
- Fuentes de rechazo: «FEL Reglas y Validaciones» (1 102), «Validaciones de Rechazo Inmediato» (268), «Validaciones del Sistema» (154), «Firma Digital del Emisor» (20), «Validaciones de Integridad del Documento» (10). Códigos de la forma `FEL-GUI-nn` y `FEL_ANU464` (rechazo de anulación por la SAT).
- **Reintentos:** 742 referencias internas fueron enviadas **más de una vez** (patrones: error→éxito 317, éxito→éxito 167, error,error→éxito 66, hasta 36 envíos de una misma referencia).
- **Proveedor caído / timeout:** quedan registros «sin JSON»; no hay cola ni reintento automático visible (el usuario reintenta).
- **NIT inválido / IVA incorrecto:** aparecen como `FEL-GUI-xx` (validaciones de reglas).

### 7.5 ⚠️ ¿Cómo evita duplicar si INFILE certificó pero Milenium perdió la respuesta? — **No se observa ningún mecanismo (INFERIDO a partir del historial)**
- COMPROBADO: el `NUMERO_GUID` de la Adenda **cambia en 397 de 491** referencias con reintentos (solo 94 lo conservan); por tanto **no parece actuar como clave de idempotencia** (INFERIDO).
- COMPROBADO: **129 referencias internas tienen ≥ 2 certificaciones exitosas con UUID distintos** (otras 109 tienen el mismo UUID en ambas respuestas). **Esto NO prueba doble facturación:** puede deberse a **anulaciones seguidas de reemisión legítima** (la referencia interna se reutiliza) o a **posibles duplicados**. **PENDIENTE DE CONFIRMACIÓN:** requiere revisión de Contabilidad, documento por documento, para distinguir unas de otras (ver pregunta P-9).
- No se encontró en la copia una rutina de conciliación («¿ya existe en INFILE?»); como no hay código fuente, **no se puede descartar que exista en el ejecutable** (PENDIENTE DE CONFIRMACIÓN). El respaldo observable es `f61` + el portal del certificador.
- **Implicación para el diseño nuevo:** la idempotencia (clave estable por documento, estado «incierto», consulta/conciliación antes de reintentar) **debe diseñarse como requisito propio del sistema nuevo** (ya esbozada en `FEL-INFILE-ARQUITECTURA §7`), **sin suponer** que INFILE ofrezca idempotencia nativa: eso es parte de lo PENDIENTE (§7.0).

---

## 8. Tipos de documentos (lo que **realmente** existe)

| Tipo | Código SAT | Serie (KT / Mónaco) | Evidencia | Notas |
|---|---|---|---|---|
| **Factura cambiaria electrónica** | **FCAM** | FE / F3 | 9 de 9 XML; `f50`; 8 225+ certificaciones | Incluye complemento de abonos (cambiaria) y **Nota legal de facturas cambiarias**; es el documento principal. Los XML son todos FCAM: **FACT/FPEQ no aparecen** |
| Nota de crédito | **NCRE** | NF | `f50`, `fnotacreditofel.FRX`, 217 NC en `f61`, 138 en CxC | Se genera desde CxC («Notas de crédito FEL», «Generar XML de nota de crédito FEL»); referencia al documento origen (autorización, fecha) |
| Nota de abono | **NABN** | NA | `f50`, `f12` | Para abonos de la cambiaria |
| Factura especial | **FESP** | ES | `f50`, `f12` (`ESFES`), PDF habilitado | Frase 5 |
| Anulación | `GTAnulacionDocumento` | (de cada serie) | 930 (KT) / 126 (Mónaco) en `f61` | Pasa por motivo interno + evento a INFILE/SAT |
| Nota de débito | NDEB | — | `ESNDB=falso` en todas las series | **No usada** (existe “nota de cargo a clientes” interna sin FEL) |
| Recibo | RECI/RDON | — | plantilla con ramas `RDON` («recibo de donación») | Existe en la plantilla; **no hay serie activa** |
| Exportación (FEXP) | | | `EXPOR=falso`, 0 documentos | No usada |
| Series sin FEL | | `0A` (2017-2020, 2 956 docs), `FL` (2020-2021 y residuales, 1 803 docs) | `ACTFEL=falso` | Facturación previa/legacy; `FL` tiene autorización FEL en 1 795 documentos (proveedor/modo anterior) — **semántica por confirmar** |

Reglas comprobadas: precios con IVA incluido; la afiliación al IVA es general (`GEN`) con frase 1/escenario 1; IVA se informa por ítem (`NombreCorto=IVA`, monto gravable y monto impuesto) y total; bien o servicio por línea (`S` en todos los XML); sin retenciones; sin descuentos significativos.

---

## 9. Contabilidad (separada de la facturación)

| Capacidad | Estado en Milenium | Evidencia |
|---|---|---|
| Catálogo de cuentas multinivel (estructura configurable, multimoneda opcional) | **IMPLEMENTADO** | `co01` 658 cuentas; utilitario «modificar la estructura de las cuentas» |
| Tipos de póliza, partidas/pólizas, detalle y explicación | **IMPLEMENTADO** | `co02`, `co03` (196 mil líneas), `co04`; captura manual, **importación masiva de pólizas** y de cuentas |
| Libro diario, diario mayor, balance de saldos, balance general, estado de resultados (también por centro de costo), comparativos, origen y aplicación de fondos | **IMPLEMENTADO** | menú «Reportes» (15 reportes) |
| Presupuestos (captura, clonación, ejecución) | **IMPLEMENTADO** | menú |
| Centros de costo, fábricas/fincas, actividades, proyectos | **IMPLEMENTADO** | `co03` con centro de costo y proyecto |
| Períodos contables, cierres | **IMPLEMENTADO** | `coperiodoscontables`, «Reportes tipo cierre», «Impresión de partidas de cierre», rol «Administrador financiero» (cierres anuales) |
| IVA: libros de ventas/compras (con resoluciones autorizadas), archivo **ASISTE LIBROS (SAT)**, cuadre del IVA por cobrar, gastos no deducibles | **IMPLEMENTADO** | menú «Reportes del IVA» |
| Bancos: cheques, depósitos, notas, programación de pagos, **conciliación bancaria**, disponibilidad | **IMPLEMENTADO** | `b03` 29 366 movimientos |
| Cuentas por pagar (contraseñas de pago, notas, liquidación de documentos varios), anticipos | **IMPLEMENTADO** | `cc06/cc08` |
| Cuentas por cobrar (cartera) | **IMPLEMENTADO** (ver §10) | |
| Activos fijos y depreciación | **PARCIAL** (módulo completo; en KT casi sin datos) | |
| Planilla | **IMPLEMENTADO en el producto** (en este grupo la planilla vive en SITSA/RRHH; no revisado) | |
| Inventarios (kárdex, valuación) | **IMPLEMENTADO**, **sin uso en KT** (servicios) | |
| Retenciones IVA/ISR (CxP) | **IMPLEMENTADO** (rangos), no usadas en ventas | `cc17` |
| Tipo de cambio / multimoneda | **IMPLEMENTADO**; sin uso real (todo GTQ) | |
| Costos (costo de ventas, producción) | **PARCIAL / sin uso** | |

**Facturación ≠ contabilidad:** la facturación genera la póliza, pero la contabilidad es un módulo propio (pólizas, libros, balances, IVA, bancos, CxP). En SITSA la contabilidad existe **solo como base** (cuentas, asientos con cuadre, CxC/CxP básicas y entidades): ver §11.

---

## 10. Cuentas por cobrar

COMPROBADO / INFERIDO:
- La **factura a crédito es el documento de cartera** (`CREDIT`, `DIASCR`, vencimiento); `PAGADA` no se usa (0 de 12 529): **el saldo se deriva**, no se almacena.
- Las transacciones de cobro viven en `cc05` (cabecera) y `cc03` (detalle de aplicación): tipos **R** (3 413), **E** (2 239), **C** (138), **A** (2). Interpretación: `C` = nota de crédito, `A` = anticipo, `R` = recibo de cobro; **`E` queda PENDIENTE DE CONFIRMACIÓN** (¿efectivo/depósito?) → pregunta P-6.
- Operaciones del manual y menú: *operación de pagos con liquidación de documentos (parciales y totales)*, *notas de cargo*, *notas de crédito (por liquidar y de aplicación directa; FEL)*, *anticipos por liquidar*, *notas de crédito bancarias con abono a clientes*, *ingreso manual del número FACE/FEL*, *cobrar a clientes / historial de cobranza*, *contratos en cuotas*, **análisis de antigüedad de saldos**, **estado de cuenta del cliente**, cobros por vendedor/artículo, cruce de recibos y depósitos.
- **Crédito del cliente:** `DIASCR`, `LIMCRE` (límite) y cartera por tipo; existe vista de clientes por límite de crédito.
- **Contabilización:** automática (usa `f10`) o manual.
- **Pagos con cheques posfechados:** `cc30` (consignación y rechazo).
- **Cartera vencida:** derivada por reporte de antigüedad (no hay estado «vencida» persistido).

---

## 11. Relación con plataforma-sitsa — mapeo

Estado de SITSA verificado en `main` y `sql/`: módulo **Facturación interno** (`fact_facturas`, `fact_factura_viajes`, `fact_pagos`, `fact_empresa_perfil`, `fact_cliente_perfil`) sin FEL ni IVA ni serie ni receptor congelado; **Contabilidad base** (`cont_entidades`, `cont_cuentas`, `cont_asientos` con detalle, `cont_cxc`, `cont_cxp`); **TMS** con `tms_clientes`, `tms_planes_viaje` (viajes con `tarifa_comercial`, estados, fecha del plan), `tms_ruta_tarifas`, `tms_cotizaciones`, `tms_lugares`, `tms_unidades`, `tms_personal`, viáticos, evidencias; `clientes` (+ puente `tms_cliente_id`), permisos, auditoría, multiempresa. No hay código `fel` ni `infile` (solo un campo de cuestionario).

| MILENIUM | PLATAFORMA-SITSA | Clasificación |
|---|---|---|
| Empresa (`s02`, carpeta `BASESxxx`) | `empresas` (tenant) + `cont_entidades` (emisor legal) | **Existe pero requiere adaptación**: el emisor legal ≠ tenant; hacen falta NIT, afiliación IVA, establecimiento, dirección fiscal estructurada |
| Cliente (`cc01`) | `clientes` + `tms_clientes` + `fact_cliente_perfil` | **Existe pero requiere adaptación**: falta tipo de identificación estructurado, NIT validado, correo FEL, días/límite de crédito, cartera |
| Serie/correlativo (`f12`, `f50`) | — | **No existe** (la serie y el número los asignará el certificador; falta serie interna/de transición) |
| Factura cabecera (`f06`) | `fact_facturas` | **Requiere adaptación**: faltan moneda, IVA, tipo de documento, entidad emisora, receptor congelado, serie, UUID/autorización, estado FEL |
| Detalle de factura (`f07`) | `fact_factura_viajes` (una fila por viaje) | **Requiere adaptación**: faltan líneas descriptivas, cantidad, unidad, precio unitario, impuestos |
| «Viaje» | `tms_planes_viaje` (+ estado Cerrado, cliente, ruta, unidad, piloto, `tarifa_comercial`) | **YA EXISTE** — **y es lo que Milenium no tiene** |
| Ruta (`f01`: código sin datos) | `tms_cliente_rutas`, `tms_ruta_tarifas`, `tms_lugares` | **YA EXISTE** (más rico) |
| Servicio/artículo (`i08`: 18 conceptos) | tipo de vehículo/unidad + tarifa; conceptos adicionales (espera, estadía, cuadrilla) en el plan | **Existe pero requiere adaptación**: catálogo de conceptos facturables con IVA y unidad de medida |
| Tarifa digitada por línea | `tarifa_comercial`, `tms_ruta_tarifas`, cotizaciones | **Existe**; falta decisión de IVA incluido/no incluido |
| Historial FEL (`f61`) | — | **No existe** (será `fel_documentos`/`fel_intentos` según diseño) |
| Credenciales FEL (`f50`) | `proveedores/credenciales.ts` (AES-GCM) como patrón | **Existe como patrón**, no como funcionalidad FEL |
| Cuenta por cobrar (factura a crédito + `cc05/cc03`) | `fact_pagos` + `cont_cxc` (nombre libre, saldo básico) | **Requiere adaptación**: unificar cobros de Facturación con CxC contable sin duplicar efectos |
| Pago/recibo (`cc05` R) | `fact_pagos` | **Existe parcial** (pagos a la factura completa; sin recibos ni aplicaciones parciales por documento múltiple) |
| Nota de crédito (`cc05` C) | — («no implementado» en `anularFactura`) | **No existe** |
| Póliza de ventas automática (`f10`) | `cont_asientos` | **Requiere adaptación**: reglas de cuentas por tipo de documento |
| Catálogo de cuentas / pólizas / períodos | `cont_cuentas`, `cont_asientos`, (`cont_*` sin períodos) | **Existe base**, faltan tipos, períodos y numeración (ver `MILENIUM-INVENTARIO-FUNCIONAL`, C1–C7) |
| Libro de ventas / ASISTE LIBROS | — | **No existe** |
| Bancos y conciliación | — | **No existe** |
| Vendedores y comisiones (`f02`) | — | **No debe migrarse** salvo que se confirme que se usan |
| Adenda (código de ruta, vendedor, centro de costo, GUID) | referencias a viaje/plan | **No debe migrarse literal**: reemplazar por la **referencia al/los viaje(s)** |
| Usuarios/permisos (`s05/s06`) | `usuarios`, `usuario_empresa`, permisos granulares | **No debe migrarse** (rediseñado y superior) |
| Formas preimpresas (`imp01–06`), `MiDll.dll` | — | **No debe migrarse** (PDF/impresión moderna) |

---

## 12. Seguridad

| Nivel | Hallazgo | Evidencia |
|---|---|---|
| **CRÍTICO** | **Llaves de INFILE (alias, código, llave de firma y de certificación) guardadas en claro** en la tabla DBF `f50` de cada empresa, dentro de una carpeta compartida con «control total». Quien pueda leer la carpeta puede **emitir/anular documentos fiscales a nombre de la empresa** y consumir créditos | `f50`: los campos de credenciales tienen valor en las 4 series de KT y se leen como texto (no cifrados). *No se imprimen ni se copian* |
| **CRÍTICO** | **Esta estación tiene una copia completa del sistema** (zip de 1.6 GB y carpeta descomprimida en Descargas) que incluye esas llaves, bases con NIT/direcciones de clientes y documentos fiscales. **Rotar las llaves de INFILE cuando termine la migración o de inmediato si la copia sale de un entorno controlado, y eliminar las copias innecesarias** | ubicación `Downloads/Milenium2000*` |
| **ALTO** | Carpeta de datos compartida con **control total y sin cifrado** (las instrucciones lo piden); sin auditoría de lecturas | `Instrucciones.txt` |
| **ALTO** | **Usuario administrador preinstalado, con clave por defecto documentada en el manual del producto** (no se reproduce aquí); la copia tiene 67 operadores (2 de tipo 1 y 65 de tipo 3) — **no se pudo verificar si la clave por defecto fue cambiada** | manual §Registrarse; `s05` |
| **ALTO** | Claves de operador en campo de **15 caracteres**, con esquema no estándar (valores no alfanuméricos → ofuscación reversible probable, **no hash**) | `s05.CLAVES_OPE` |
| **ALTO** | Base de datos de archivos: sin transacciones, sin integridad referencial; **corrupción/caídas** (`C0000006`: 102 en 2019-2026) | `VFP9Rerr.log` |
| **ALTO** | Plataforma fuera de soporte (VFP 9 desde 2015); llave de hardware y driver antiguos (INFERIDO como limitación de modernización; no se comprobó que se requiera Windows 7) | §13 |
| **MEDIO** | Utilitarios que **modifican documentos ya emitidos** (corregir número, cambiar cliente, modificar detalle, rehabilitar) y borrado de empresa (`borraemp.exe`) | menú Utilitarios |
| **MEDIO** | El historial FEL guarda el XML completo con datos personales de receptores sin controles de retención | `f61` |
| **MEDIO** | Datos operativos mezclados en la carpeta del sistema (hojas Excel con extractos bancarios, PDFs de facturas, XML): **procesos «sombra»** fuera del sistema | raíz de `Milenium2000` |
| **BAJO** | Inyección SQL: **no aplicable en el sentido clásico** (no hay servidor SQL); riesgo de macros (`&`) en código VFP **no verificable** sin fuente | — |
| **BAJO** | Auditoría mínima (usuario/hora de último cambio) | tablas principales |

---

## 13. Dependencias de Windows 7 (nada comprobado como obligatorio)

**COMPROBADO:** nada en los archivos de la copia exige *literalmente* Windows 7, y esta auditoría **no comprobó** que Milenium lo requiera obligatoriamente. **PENDIENTE DE CONFIRMACIÓN:** probarlo en un entorno controlado y con TI. A continuación, los factores que **podrían** limitar el uso de un Windows moderno (todos **INFERIDOS**; el runtime de VFP 9 de 32 bits suele ejecutarse en Windows 10/11, aunque sin soporte de Microsoft):

1. **Llave de hardware Rainbow/SafeNet Sentinel SuperPro / NetSentinel 5.31** (`Sxfoxpro.dll`, `NSLMS324.DLL`, `RainbowSSD5.39.2.exe`, `nssrvice.exe`, referencia a `SENTINEL.VXD`): COMPROBADO que existe esta protección; **INFERIDO** que el programa necesita la llave para ejecutarse y que su driver es de una generación antigua (puerto paralelo o su variante USB). **Inferencia pendiente de confirmar con TI:** tipo de llave (paralelo/USB), versión de driver y si funciona en el sistema operativo actual de cada estación.
2. **Impresión directa y formas preimpresas** vía `MiDll.dll` (32 bits, GDI) y la dependencia de «Microsoft Print to PDF»/**Bullzip PDF Printer** (este último solo existe si está instalado).
3. **SMB con *oplocks* deshabilitados** (`OptLocks…txt`): en servidores modernos con SMB 2/3 y *leasing*, los DBF en red suelen corromperse; las caídas `C0000006` son el síntoma. El «parche» es de registro del sistema operativo.
4. **Excel/OLE** para importar el libro de compras y exportar (FoxyPreviewer `DoMakeXLSOffline`): requiere Office instalado — INFERIDO.
5. **Paquete FEL**: no se observa ninguna DLL del certificador (la integración parece ser HTTP); **no se evidencia dependencia de software del certificador**.
6. Runtime VFP 9 en 64 bits de Windows: **funciona** (WoW64) — no es un impedimento.

Lo que **podría** dificultar un Windows moderno (inferencia): el driver/licencia de la llave Sentinel y la corrupción de archivos por *oplocks*/SMB; lo demás parece resoluble. **Nada de esto está confirmado.**

---

## 14. Reportes

| Área | Reportes (menú real) | Tecnología |
|---|---|---|
| Facturación | Reporte de ventas; comisiones; ventas y cobranza diaria; correlativo de facturas; ventas valuadas; cruce cliente/artículo (con y sin costos); lista de precios | FRX → vista previa FoxyPreviewer → PDF/XLS/HTML o impresora |
| Facturas/NC FEL | `fFacturaFel`, `fFacturaFelUnitarioYTotales`, `fnotacreditofel` | FRX → «Microsoft Print to PDF»/Bullzip |
| Cuenta por cobrar | Catálogo de clientes; **antigüedad de saldos**; **estado de cuenta**; correlativo de documentos; adeudos y cobros por artículo/vendedor; análisis de cobros; cruce de recibos y depósitos | FRX |
| IVA | **Libro de ventas** (también por rango), **libro de compras**, **archivo ASISTE LIBROS**, cuadre de IVA por cobrar, gastos no deducibles | FRX / archivo plano |
| Contabilidad | Diario, diario mayor, balance de saldos, balance general, estado de resultados (por centro de costo), comparativos, ejecución de presupuesto, origen y aplicación de fondos, catálogo de cuentas | FRX |
| Bancos | Disponibilidad, libro de bancos, conciliación, listados de cheques | FRX / hoja electrónica generada |
| Definición | Diccionario de reportes: `rcr` (317) y `rcf` (447) + formatos de columnas `it02` (161) | tablas |

No existen reportes «por viaje» ni «por unidad»; el único agrupador es cliente/artículo/vendedor/ruta comercial.

---

## 15. Procesos externos

- **INFILE/SAT:** certificación y anulación de DTE (HTTP) — COMPROBADO por las respuestas.
- **Correo SMTP:** envío de documentos (servidor propio, Gmail, Yahoo).
- **Excel:** importaciones (libro de compras, pólizas, cuentas, facturas masivas) y exportaciones de reportes.
- **ASISTE LIBROS (SAT):** archivo plano de libros.
- **Impresoras / PDF virtual.**
- **Archivos compartidos:** la carpeta del sistema contiene extractos bancarios `.XLS`, PDFs de facturas, XML FEL sueltos (proceso paralelo manual).
- **Bancos:** sin integración electrónica (conciliación por captura).
- **GPS u otros sistemas internos:** **no** hay integración (el viaje vive fuera).

---

## 16. Modelo propuesto para plataforma-sitsa (sin implementar)

Se **confirma y refina** `FEL-INFILE-ARQUITECTURA` con lo comprobado:

```mermaid
flowchart LR
  V[Viaje cerrado\n tms_planes_viaje] --> P[Documento por facturar\n (agrupa viajes de un cliente/emisor)]
  P --> F[Factura borrador\n receptor + emisor congelados\n líneas con IVA]
  F --> D[Documento FEL\n estado + clave de idempotencia]
  D --> I[Intentos y eventos\n sin secretos]
  D -->|certificar| C[Proveedor FelProvider\n INFILE sandbox/prod]
  C --> S[SAT]
  C --> R[UUID, serie, número, XML certificado]
  R --> A[Almacenamiento XML/PDF]
  A --> X[Envío/descarga]
  R --> K[Cuenta por cobrar]
  K --> G[Pago / nota de crédito / cancelación]
  R --> L[Libro de ventas / asiento]
```

Entidades necesarias (nombres tentativos, ya esbozados en la arquitectura; **no crear todavía**):
`fel_emisores` / `fel_emisor_ambientes` (NIT, establecimiento, frases, ambiente, credenciales cifradas), `fel_documentos` (tipo, receptor congelado, totales, estado, UUID/serie/número, XML), `fel_intentos` (cada llamada, resultado, identificador de solicitud), **`fact_documentos_por_facturar`** o equivalente para agrupar viajes (con regla de descripción e IVA), extensiones aditivas de `fact_facturas` (entidad, moneda, tipo, estado FEL), `fact_viajes_facturacion_externa` (viajes ya facturados en Milenium), y para cartera: `cobros` + `aplicaciones` unificadas con `cont_cxc` (clave idempotente para no contabilizar dos veces).

**Reglas de factura de viajes a decidir** (Milenium no las codifica porque no tiene viajes): 1 viaje = 1 línea; 1 factura = varios viajes de un cliente y período (hoy es el patrón dominante: facturas de 1 línea 9 147 y de 6+ líneas 1 720); conceptos adicionales (espera, estadía, cuadrilla, viáticos, combustible, hospedaje) como líneas propias con IVA; descuentos; moneda GTQ; exento solo por casos puntuales (290 de 12 529).

---

## 17. Estrategia de migración (gradual, sin detener la operación)

Ajuste de las fases pedidas a lo hallado (Milenium **sigue emitiendo oficialmente**; no hay punto de apoyo en el legacy para viajes):

| Fase | Contenido | Criterio de salida |
|---|---|---|
| **0 — Cerrar preguntas** | Respuestas de Contabilidad (§18) y solicitud de documentación/sandbox a INFILE | Reglas de IVA, descripción, tipos y emisores firmadas |
| **1 — Solo lectura / auditoría** | Esta auditoría; **rotar llaves y limpiar copias** | Informe aceptado |
| **2 — «Documentos por facturar» desde viajes + dominio FEL con proveedor simulado** | `Viaje cerrado → documento por facturar`; mapper DTE; protocolo de idempotencia; pruebas con las **estructuras reales** de solicitud/respuesta de INFILE de §7.1 | Pruebas en verde; el caso «certificó pero no recibí respuesta» se recupera sin duplicar |
| **3 — FEL en sandbox de INFILE** | Certificación/consulta/anulación en pruebas | Facturas de prueba con estructura equivalente a casos históricos |
| **4 — Comparación paralela** | Para viajes reales, SITSA arma el **borrador/simulación** y se compara **total, IVA, cliente, descripción** contra la factura oficial de Milenium (sin certificar) | Diferencias explicadas y aceptadas |
| **5 — Facturación controlada en producción** | Un emisor (el de menor volumen: **Mónaco**, ~720 documentos) desde una **fecha de corte**; viajes anteriores marcados como facturados externamente | Revisión contable del paralelo; plan de reversión |
| **6 — Cuentas por cobrar** | Cobros, aplicaciones, notas de crédito, antigüedad, estado de cuenta; enlace a contabilidad | Saldos reproducibles vs Milenium |
| **7 — Otros módulos contables** | Pólizas automáticas de venta, libro de ventas/ASISTE LIBROS, bancos/conciliación, CxP (C3–C5 del roadmap contable) | Reportes conciliados con casos conocidos |
| **8 — Retiro progresivo de Milenium** | Solo lectura histórica; luego archivo | Un ciclo fiscal completo sin diferencias |

### 17.1 Convivencia sin doble factura
- **Un emisor/establecimiento/serie nunca emite en los dos sistemas a la vez**: antes de la fecha de corte emite Milenium; después, SITSA (serie propia si INFILE lo permite).
- Hasta el corte SITSA **no certifica** (modo TEST/simulación). La simulación paralela **no usa el cliente de certificación real**.
- Viajes ya facturados en Milenium se marcan **por viaje** (`fact_viajes_facturacion_externa`) con la referencia (serie/número/autorización); el listado de facturables los excluye.
- Notas de crédito de facturas de Milenium siguen en Milenium hasta que SITSA soporte documento origen externo.
- Comparación: totales, IVA, receptor, descripciones y UUID (cuando exista) contra `f61`/XML del legacy, solo en lectura.

---

## 18. Datos históricos

| Categoría | Qué | Recomendación |
|---|---|---|
| **DEBEN MIGRAR** | Clientes activos (NIT validado, crédito); **facturas vigentes y sus UUID/serie/número/autorización** (para notas de crédito y anulaciones futuras); **cartera abierta** (documentos con saldo) y anticipos/NC por liquidar; catálogo de cuentas y saldos iniciales por período aprobado; series y último correlativo | Con vista previa, lotes, rechazos y reintentos idempotentes; primero catálogo, luego saldos; **no sumar saldos iniciales e historia duplicada** |
| **PUEDEN QUEDAR COMO ARCHIVO HISTÓRICO** | Facturas y notas ya cobradas/cerradas; **XML certificados y PDF** (conservar íntegros: son evidencia fiscal); pólizas de ejercicios cerrados; historial FEL (`f61`); documentos de CxP; bancos de ejercicios cerrados | Respaldo en solo lectura (BD exportada + XML/PDF) con índice de consulta; no reimportar movimiento a movimiento |
| **NO CONVIENE MIGRAR** | Series sin FEL (`0A`, `FL`) salvo consulta; formas preimpresas y configuración de impresión; permisos/operadores (`s05/s06`); menú `opciones`; tablas de módulos sin uso (producción, mercadeo, proyectos, ruteo); empresas de prueba/restauración (`06`); utilitarios de “corrección” de documentos; **las credenciales** (se crean nuevas por emisor) | — |

Volumen orientativo KT: 12 529 facturas, 9 499 eventos FEL, 16 713 líneas de cobro, 196 002 líneas de póliza. La migración de historia contable debe decidirse con el contador (**historia completa o saldos iniciales**).

---

## 19. Riesgos de reemplazar Milenium

1. **Posible doble certificación / doble factura** durante la convivencia (mitigación: corte por emisor, marca por viaje, idempotencia propia).
2. **Pérdida del único registro local de lo certificado** (`f61`) si se retira Milenium sin respaldar XML/PDF.
3. **Reglas de negocio implícitas en el EXE** que nadie documentó (IVA incluido, póliza automática, correlativos, comisiones): sin código fuente → **se deducen de datos y de la salida**; riesgo de diferencias.
4. **Dependencia de la llave de hardware** (INFERIDO): si falla o el servidor se pierde, Milenium podría dejar de funcionar — **riesgo operativo a verificar**, independiente de la migración.
5. **Cierres fiscales / ASISTE LIBROS**: el libro de ventas depende de Milenium hasta que se reemplace; la omisión puede generar incumplimiento.
6. **Calidad de datos fiscales de clientes** (NIT, correo) en `clientes` de SITSA.
7. **Campo «descripción» libre**: la factura nueva seguirá exigiendo texto; si se estructura demasiado, no coincidirá con lo que los clientes esperan (p. ej. órdenes de compra, “según orden…”).
8. **Créditos de INFILE** (saldo): el sistema nuevo debe monitorear `control_emision.Saldo`.
9. **Seguridad de las llaves** (ver §12) durante todo el proyecto.
10. **Dependencia de unas pocas personas** que conocen los procesos (capacitación y paralelo).

---

## 20. Diagramas

### 20.1 Flujo ACTUAL (solo conexiones comprobadas)
```mermaid
flowchart LR
  OP[Operador de facturación] -->|digita cliente + líneas de texto libre| M[Milenium sistema.EXE\n(VFP 9, carpeta compartida)]
  VJ[Viaje: fuera del sistema\n (Excel/mensajes/otro sistema)] -.manual, sin vínculo.-> OP
  M --> F[(f06/f07 factura)]
  M -->|DTE XML sin firma 0.2.0 + Adenda| INF[INFILE, S.A.\n firma y certifica]
  INF --> SAT[SAT]
  INF -->|JSON: uuid, serie, numero, xml_certificado, saldo| M
  M --> H[(f61 historial: XML enviado/respuesta/certificado)]
  M --> PDF[FRX → PDF virtual / impresora]
  M --> MAIL[SMTP]
  M --> POL[(Póliza de ventas automática\n co02/co03)]
  M --> CXC[(Cartera derivada\n cc05/cc03)]
  POL --> LIB[Libro de ventas / ASISTE LIBROS]
```

### 20.2 Flujo PROPUESTO en plataforma-sitsa
```mermaid
flowchart LR
  T[Viaje Cerrado + tarifa + cliente + emisor] --> PF[Documento por facturar]
  PF -->|revisión: receptor, IVA, descripción| FB[Factura borrador congelada]
  FB -->|certificar (clave idempotente)| FD[fel_documentos]
  FD --> FP[FelProvider\n(MOCK → INFILE sandbox → PROD)]
  FP --> INF2[INFILE] --> SAT2[SAT]
  FP -->|resultado: CERTIFICADO / RECHAZADO / INCIERTO| FD
  FD -->|INCIERTO| CON[Consulta/conciliación antes de reintentar]
  FD --> ART[XML + PDF archivados]
  FD --> CXC2[Cuenta por cobrar]
  CXC2 --> PAG[Pagos/NC con aplicaciones]
  FD --> ASI[Asiento y libro de ventas]
```

---

## 21. Comparación final

| FUNCIÓN | MILENIUM | PLATAFORMA ACTUAL | FALTA | RECOMENDACIÓN |
|---|---|---|---|---|
| Clientes | `cc01` completo (NIT, crédito, cartera) | `clientes`/`tms_clientes` + cuestionario | NIT validado, tipo de ID, correo FEL, crédito | Adaptar; validar NIT |
| Viajes | **No existe** | Sí (`tms_planes_viaje`, cerrados, tarifa) | — | **Fuente de verdad** de lo facturable |
| Documento por facturar | No existe | Parcial (agrupa viajes cerrados en factura) | Reglas de agrupación, líneas, IVA | **Primera implementación** |
| Facturación (captura) | Libre, por línea de texto | Interna mínima (total + viajes) | Líneas, IVA, moneda, receptor/emisor congelados | Rediseñar |
| FEL (certificación) | INFILE, XML sin firma, JSON | No existe | Todo | FelProvider + mock, luego sandbox |
| Idempotencia FEL | **No observada** | Diseñada, no implementada | Implementarla | Obligatoria (§7.5) |
| PDF de factura | FRX → PDF virtual | No existe | Plantilla | PDF propio o del proveedor |
| XML certificado | En `f61` | No existe | Almacenamiento | Archivar íntegro |
| Anulación | Sí (816 FEL en KT), con motivo | Interna (solo sin pagos) | Anulación FEL | Fase FEL-5 |
| Nota de crédito | Sí (NCRE, desde CxC) | No existe | Todo | Fase FEL-5 |
| Nota de abono (NABN) | Sí | No | Todo | Confirmar uso real |
| Factura especial (FESP) | Sí (activa) | No | Todo | Confirmar volumen |
| Cuenta por cobrar | Sí (derivada) | `cont_cxc` básica + `fact_pagos` | Aplicaciones, antigüedad, estado de cuenta | Unificar y completar |
| Pago / recibo | Sí | Pagos simples | Recibos, parciales múltiples, cheques posfechados | Fase de cartera |
| Libro de ventas / ASISTE LIBROS | Sí | No | Todo | Fase contable |
| IVA | 12 % incluido, por ítem | No existe | Modelo de impuestos | Decisión de negocio P-1 |
| Póliza automática de ventas | Sí (`f10`) | Asientos manuales base | Reglas por tipo | Fase contable |
| Catálogo de cuentas / pólizas | Completo | Base (`cont_*`) | Períodos, numeración, tipos | C3–C5 |
| Bancos y conciliación | Sí | No | Todo | Fase posterior |
| CxP | Sí | `cont_cxp` básica | Distribución, pagos | Fase posterior |
| Multiempresa | 12 empresas | Tenants + entidades | Emisor legal estructurado | Modelar `fel_emisores` |
| Permisos / auditoría | Mínimos | Granulares y auditoría | — | SITSA es superior |
| Seguridad de secretos | **Claro en DBF** | Patrón AES-GCM | Clave dedicada y rotación | Implementar |

---

## 22. Preguntas pendientes para Contabilidad / TI

1. **P-1 IVA:** ¿las tarifas de los viajes incluyen IVA (como hoy en Milenium)? ¿hay servicios exentos y con qué criterio?
2. **P-2 Documentos:** ¿se sigue emitiendo **FCAM** como documento principal o se desea **FACT**? ¿Siguen usándose **NABN**, **FESP** y **notas de crédito**?
3. **P-3 Descripción:** ¿qué texto exige cada cliente en la factura (órdenes de compra, rutas, fechas, pilotos)? ¿una línea por viaje o línea consolidada?
4. **P-4 Agrupación:** ¿cuándo se factura (por viaje, semanal, mensual, por cliente)? ¿cómo se agregan combustible, espera, estadía, cuadrilla, viáticos, hospedaje?
5. **P-5 Emisores:** ¿qué entidad (KT/Mónaco) emite cada viaje? Datos fiscales de cada una (NIT, establecimiento, afiliación, frases).
6. **P-6 Cartera:** significado de los tipos `R/E/C/A` de `cc05`; ¿hay recibos físicos; manejo de cheques posfechados; política de mora?
7. **P-7 Series:** ¿qué son las series `0A` y `FL`? ¿alguna sigue en uso (hay documentos `FL` en 2022-2026)?
8. **P-8 INFILE:** documentación oficial, sandbox, credenciales de prueba, **cómo identifican duplicados**, consulta por referencia, saldo de créditos, límites (ver `FEL-INFILE-DATOS-FALTANTES §B`).
9. **P-9 Duplicados:** revisar las **129 referencias internas** con más de un UUID certificado para distinguir **reemisiones legítimas tras una anulación** de **posibles duplicados** (no se asume que sean doble facturación).
10. **P-10 Contabilidad:** ¿historia completa o saldos iniciales? ¿fecha de corte? ¿qué reportes sirven de referencia de conciliación?
11. **P-11 Operación:** ¿quién usa realmente cada módulo (bancos, CxP, activos fijos, planilla de Milenium)?
12. **P-12 TI:** tipo y estado de la **llave Sentinel** (¿paralelo o USB?), driver y servidor; versión de Windows de cada estación; respaldo actual; ¿se puede cambiar el servidor sin la llave?
13. **P-13 Seguridad:** ¿la clave del usuario administrador preinstalado fue cambiada? ¿quién tiene acceso a la carpeta compartida? ¿cuándo se rotaron las llaves de INFILE?
14. **P-14 Comisiones/vendedores:** ¿se usan?
15. **P-15 ASISTE LIBROS:** ¿quién presenta mensualmente y desde qué reporte?

---

## 23. Recomendación de primera implementación

**Migrar primero lo que Milenium nunca tuvo y es de menor riesgo: «viaje cerrado → documento por facturar» con borrador congelado (receptor, emisor, líneas con IVA), más el dominio FEL con proveedor SIMULADO** validado contra las estructuras reales de solicitud/respuesta de INFILE descritas aquí (incluidos rechazos, timeout y reintento). Razones: (1) entrega valor inmediato (menos digitación y trazabilidad viaje↔factura); (2) **no emite nada ni compite con Milenium**; (3) resuelve por diseño el defecto crítico (idempotencia); (4) permite la **comparación paralela** (Fase 4) sin riesgo fiscal; (5) la certificación real, la cartera y la contabilidad quedan para después, cuando INFILE entregue sandbox y Contabilidad responda las preguntas.

En paralelo y **sin código**: rotar/proteger las llaves de INFILE, asegurar el respaldo y la llave de hardware, y definir la fecha de corte por emisor.

---

## 24. Respuestas finales (lo pedido explícitamente)

- **Lenguaje de Milenium:** Visual FoxPro 9.0 (xBase), compilado; sin fuente.
- **Motor de BD:** archivos DBF/CDX/FPT de VFP 9 sobre carpeta compartida SMB (sin servidor); contenedores DBC sin procedimientos ni triggers.
- **Proveedor FEL real:** **INFILE, S.A.** (comprobado en XML y en 49 601 registros).
- **Cómo factura un viaje:** no hay viaje en el sistema; el operador digita una factura (cliente + líneas de servicio con descripción libre); serie → tipo de documento; IVA 12 % incluido; Milenium arma el DTE sin firma, INFILE firma/certifica, Milenium guarda UUID/serie/número, XML y PDF y genera póliza y cartera.
- **Tablas clave:** `f06/f07` (facturas), `f12/f50` (series y configuración FEL), `f61` (historial FEL), `cc01` (clientes), `cc05/cc03` (cobros/NC), `co01/co02/co03` (contabilidad), `b03` (bancos), `i08` (artículos de servicio).
- **Integración FEL:** DTE XML 0.2.0 sin firma → INFILE (HTTP **inferido**; **endpoint, autenticación, sandbox e idempotencia oficial: pendientes de confirmar con INFILE**) → JSON con `uuid/serie/numero/xml_certificado/control_emision`; anulación con `GTAnulacionDocumento 0.1.0`.
- **Riesgos críticos:** llaves de INFILE almacenadas en texto claro (valores no reproducidos aquí) y copia en esta estación; no se observa idempotencia y hay 129 referencias por revisar (no se afirma doble facturación); base de archivos con corrupción; llave de hardware y plataforma sin soporte (limitación de modernización inferida); sin código fuente; modificación de documentos emitidos.
- **Dependencias de Windows 7:** **no se comprobó** que Milenium lo requiera obligatoriamente. Inferencias pendientes de confirmar con TI: la llave Sentinel y su driver, la impresión directa/PDF virtual y la sensibilidad de los DBF a SMB.
- **Primera parte a migrar:** «viaje cerrado → documento por facturar» + dominio FEL con proveedor simulado (§23).
- **Información adicional necesaria:** respuestas P-1 a P-15, documentación/sandbox de INFILE, datos fiscales de cada emisor, tipo de llave de hardware y reportes de referencia para conciliar.
