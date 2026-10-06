# FEL con INFILE — Arquitectura propuesta

Estado: **DISEÑO. No implementado.** Nada de lo que sigue conecta con INFILE ni ejecuta SQL. Todo lo marcado **A CONFIRMAR** depende de documentación oficial que aún no tenemos ([DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md)). Complementa [DISCOVERY](FEL-INFILE-DISCOVERY.md) y [PLAN](FEL-INFILE-PLAN.md).

## 0. Principios

1. Una factura **no** está «emitida con FEL» hasta que el certificador confirmó el éxito y se guardó su autorización.
2. Nunca se llama al certificador dentro de una transacción de BD abierta.
3. Nunca se certifica dos veces «a ciegas»: toda respuesta incierta se **consulta** antes de reenviar.
4. La lógica de Facturación **no conoce** a INFILE: depende de una interfaz (`FelProvider`).
5. El emisor es **(empresa, entidad)**, no el tenant.
6. Secretos cifrados, write-only en la UI, nunca en git ni en logs.
7. TEST y PROD nunca se mezclan.

## 1. Estructura de código propuesta

```
src/lib/fel/
  tipos.ts              # dominio: TipoDocumentoFel, EstadoFel, DocumentoFelDto, errores tipados
  provider.ts           # interfaz FelProvider + resultados (unión discriminada)
  mapper/               # Factura SITSA -> DocumentoFelDto (puro, sin red)
  emisor.ts             # resolver/validar configuración de emisor (por empresa+entidad+ambiente)
  credenciales.ts       # cifrado/descifrado con clave FEL dedicada (ver §3)
  servicio.ts           # orquestador: certificarFactura / anularDocumento / consultar / conciliar
  repositorio.ts        # persistencia fel_* (transacciones cortas)
  redaccion.ts          # sanitización de logs/respuestas
  providers/
    mock/               # proveedor simulado determinista (FEL-2, pruebas)
    infile/             # cliente HTTP + mapeo específico de INFILE (FEL-3)
src/app/api/empresas/[slug]/facturacion/...   # rutas finas: permisos -> servicio
src/components/facturacion/...                # UI: estado FEL y acciones
```

Reglas de dependencia: `facturas.ts` → `fel/servicio` (nunca `fetch`); `servicio` → `provider` (interfaz) y `repositorio`; solo `providers/infile` contiene `fetch()` hacia INFILE. La elección del proveedor sale de la configuración del emisor (`proveedor = 'INFILE' | 'MOCK'`).

## 2. Configuración por emisor y ambiente

Tabla nueva `fel_emisores` (propuesta, §6): una fila por **(empresa_id, entidad_id, ambiente)**, `ambiente ∈ {TEST, PROD}`, `proveedor = INFILE`.

Campos fiscales (todos **a capturar, nunca asumidos**): NIT, nombre del emisor, nombre comercial, afiliación IVA, código de establecimiento, correo, teléfono, dirección fiscal estructurada (dirección, código postal, municipio, departamento, país), frases (tipo/escenario), tipo de documento predeterminado, moneda, identificadores/códigos que exija INFILE (**A CONFIRMAR**), `activo`, y **`fel_modo`**: `DESACTIVADO | TEST | PROD` por emisor.

Separación TEST/PROD:
- Filas distintas con credenciales distintas; `fel_documentos.ambiente` y todos los intentos llevan el ambiente.
- El modo `PROD` solo se habilita explícitamente (permiso `fel_configurar`, Admin por defecto, con auditoría y confirmación). `TEST` no se puede promover: se crea la fila PROD aparte.
- Documentos TEST se rotulan «PRUEBA» en UI/PDF, se excluyen de reportes y de cobros, y **no consumen** la numeración oficial. Una factura que ya tiene un documento TEST certificado sigue en `Borrador` (no cambia a `Emitida`) — TEST es para validar el flujo, no para facturar.
- La URL del proveedor sale de la configuración por ambiente, nunca de variables que un deploy pueda cruzar sin querer. Un guard impide enviar a la URL PROD con credenciales TEST y viceversa (A CONFIRMAR cómo distingue INFILE los ambientes).

## 3. Credenciales

Hoy: `src/lib/proveedores/credenciales.ts` cifra con AES-256-GCM (`v1.iv.tag.cipher`), clave = `PORTAL_CREDENTIALS_KEY` si existe o, si no, derivada de `AUTH_SECRET`. **Debilidad:** si no hay clave dedicada, rotar `AUTH_SECRET` (secreto de sesiones) dejaría ilegibles todos los secretos.

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A) Variables de entorno por instalación** | Nada sensible en BD; estándar | No escala a N emisores sin redeploy ni variables dinámicas; difícil rotar por emisor; el equipo de Hostinger debe tocar variables para cada alta |
| **B) Secretos cifrados por empresa/emisor en BD** | N emisores, alta/rotación desde la app, auditable | Si la clave maestra se pierde/rota se pierden los secretos; un volcado de BD + clave expone todo |
| **C) Combinación (recomendada)** | Clave maestra **dedicada** en variable de entorno; secretos por emisor cifrados en BD con esa clave | Requiere una variable nueva y un procedimiento de rotación |

**Recomendación: C.**
- Variable nueva `FEL_CREDENTIALS_KEY` (≥ 32 caracteres, **distinta** de `AUTH_SECRET`; la app **falla al arrancar el módulo FEL** si falta, en vez de degradar). Esta variable la configura el responsable (no se toca desde el repo ni desde la sesión).
- Formato versionado con identificador de clave (`v2.<kid>.iv.tag.cipher`) y **AAD** = `empresa_id|entidad_id|ambiente` para que un secreto no sirva copiado a otra fila. Permite rotar: se descifra con la clave vieja, se re-cifra con la nueva.
- UI **write-only**: se pueden guardar/reemplazar, nunca leer ni mostrar (solo «configurado / fecha / quién»). El backend descifra únicamente dentro de `providers/infile` y en memoria.
- Auditoría de alta/rotación/borrado (sin valores).
- Soporta N emisores con credenciales distintas (KT y Mónaco).
- **Nunca** se buscan ni importan credenciales desde Milenium.

## 4. Interfaz del proveedor (sin fijar contrato de INFILE)

```ts
export interface FelProvider {
  readonly id: "INFILE" | "MOCK";
  certificar(s: SolicitudCertificacion, ctx: ContextoEmisor): Promise<ResultadoCertificacion>;
  anular(s: SolicitudAnulacion, ctx: ContextoEmisor): Promise<ResultadoAnulacion>;
  consultar(ref: ReferenciaDocumento, ctx: ContextoEmisor): Promise<ResultadoConsulta>;
  verificarConfiguracion?(ctx: ContextoEmisor): Promise<ResultadoVerificacion>; // health/check opcional
}

type ResultadoCertificacion =
  | { tipo: "CERTIFICADO"; autorizacion: string; serie: string; numero: string; fechaCertificacion: string; xmlCertificado: string; pdfUrl?: string; rawRedactado: unknown }
  | { tipo: "RECHAZADO";   codigo?: string; mensaje: string; corregible: boolean; rawRedactado: unknown }   // definitivo: se puede corregir y reenviar
  | { tipo: "INCIERTO";    motivo: "TIMEOUT" | "RED" | "HTTP_5XX" | "RESPUESTA_ILEGIBLE" }                    // NO reenviar a ciegas
  | { tipo: "ERROR_CONFIG"; mensaje: string };                                                                 // credenciales/ambiente/emisor
```

La clasificación **CERTIFICADO / RECHAZADO / INCIERTO / ERROR_CONFIG** es el contrato interno estable; cómo se obtiene de las respuestas de INFILE (códigos, textos) se define en FEL-3 con su documentación. `anular` y `consultar` siguen el mismo patrón. El proveedor `MOCK` permite probar todos los caminos (incluido el incierto) sin red.

## 5. Ciclo de vida

Estados FEL **separados** de `estado_admin` (el ENUM `Borrador/Emitida/Anulada` no se modifica):

```
(sin documento)          NO_CERTIFICADA   (factura sin FEL: emisor DESACTIVADO o factura anterior)
   ── certificar ──▶     PENDIENTE        (documento registrado, solicitud lista/enviada, sin respuesta)
   ── respuesta ──▶      CERTIFICADA | RECHAZADA | INCIERTA
   RECHAZADA  ── corregir y reenviar ──▶ PENDIENTE (nuevo intento, MISMA factura)
   INCIERTA   ── consultar ──▶ CERTIFICADA | RECHAZADA(no existe en el certificador) | sigue INCIERTA
   CERTIFICADA ── anular FEL ──▶ ANULACION_PENDIENTE ──▶ ANULADA | ANULACION_INCIERTA ──consultar──▶ …
```

Relación con el estado interno cuando el emisor tiene FEL en modo `PROD`:

| Acción | `estado_admin` | Estado FEL |
|---|---|---|
| Crear/editar borrador | Borrador | — |
| «Emitir» (certificar) | Borrador **hasta** confirmar | PENDIENTE → CERTIFICADA |
| Éxito confirmado | **Emitida** (en la **misma transacción** que guarda la autorización) | CERTIFICADA |
| Rechazo | Borrador | RECHAZADA (editable) |
| Incierto | Borrador (bloqueado: no editable ni anulable) | INCIERTA |
| Anular FEL confirmado | **Anulada** (+ liberar viajes) en la misma transacción | ANULADA |

Mientras el estado FEL sea PENDIENTE/INCIERTA la factura queda **bloqueada** (no se edita, no se anula interna, no se registran pagos). Con el emisor `DESACTIVADO` el flujo actual no cambia.

## 6. Persistencia (propuesta; **NO se ejecuta SQL**)

Se evita ensuciar `fact_facturas`: tabla 1:1 por documento + historial de intentos append-only.

```sql
-- PROPUESTA (no ejecutar). MariaDB 11.8. Sin IF [NOT] EXISTS en ALTER (dio problemas en Hostinger).

-- 6.1 Emisor fiscal por (empresa, entidad, ambiente)
CREATE TABLE fel_emisores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,                      -- cont_entidades.id (KT / MONACO)
  ambiente ENUM('TEST','PROD') NOT NULL,
  proveedor VARCHAR(20) NOT NULL DEFAULT 'INFILE',
  fel_modo ENUM('DESACTIVADO','TEST','PROD') NOT NULL DEFAULT 'DESACTIVADO',
  nit_emisor VARCHAR(20) NOT NULL,
  nombre_emisor VARCHAR(250) NOT NULL,
  nombre_comercial VARCHAR(250) NULL,
  afiliacion_iva VARCHAR(10) NOT NULL,          -- código SAT (A CONFIRMAR catálogo)
  codigo_establecimiento VARCHAR(10) NOT NULL,
  correo VARCHAR(160) NULL, telefono VARCHAR(40) NULL,
  direccion VARCHAR(300) NOT NULL, codigo_postal VARCHAR(10) NULL,
  municipio VARCHAR(80) NOT NULL, departamento VARCHAR(80) NOT NULL, pais CHAR(2) NOT NULL DEFAULT 'GT',
  frases_json JSON NULL,                        -- [{tipo, escenario}] según régimen
  tipo_documento_default VARCHAR(10) NULL,
  moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  config_proveedor_json JSON NULL,              -- ids/códigos que pida INFILE (A CONFIRMAR); SIN secretos
  secreto_cifrado TEXT NULL,                    -- v2.<kid>.iv.tag.cipher; AAD = empresa|entidad|ambiente
  secreto_actualizado_en DATETIME NULL, secreto_actualizado_por INT NULL,
  inicio_emision DATE NULL,                     -- fecha de corte (convivencia con Milenium)
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_emisor (empresa_id, entidad_id, ambiente),
  CONSTRAINT fk_fel_emisor_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6.2 Documento FEL: una fila VIGENTE por factura y ambiente
CREATE TABLE fel_documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  factura_id INT NOT NULL,                      -- fact_facturas.id
  emisor_id INT NOT NULL,                       -- fel_emisores.id (fija ambiente y entidad)
  ambiente ENUM('TEST','PROD') NOT NULL,
  proveedor VARCHAR(20) NOT NULL,
  tipo_documento VARCHAR(10) NOT NULL,          -- FACT/FCAM/NCRE/NDEB… (A CONFIRMAR códigos)
  estado ENUM('PENDIENTE','CERTIFICADA','RECHAZADA','INCIERTA','ANULACION_PENDIENTE','ANULACION_INCIERTA','ANULADA') NOT NULL,
  clave_idempotencia CHAR(36) NOT NULL,         -- UUID generado ANTES de enviar y persistido
  dto_json LONGTEXT NOT NULL,                   -- DTO congelado (emisor/receptor/ítems/impuestos/totales)
  xml_enviado LONGTEXT NULL, xml_enviado_sha256 CHAR(64) NULL,
  autorizacion VARCHAR(64) NULL, serie VARCHAR(40) NULL, numero VARCHAR(40) NULL,
  fecha_certificacion DATETIME NULL,
  xml_certificado LONGTEXT NULL,
  pdf_origen ENUM('SITSA','PROVEEDOR') NULL, pdf_ruta VARCHAR(500) NULL, pdf_url VARCHAR(500) NULL,
  motivo_anulacion VARCHAR(500) NULL, anulado_por INT NULL, anulado_en DATETIME NULL, autorizacion_anulacion VARCHAR(64) NULL,
  ultimo_error_codigo VARCHAR(60) NULL, ultimo_error_mensaje VARCHAR(500) NULL,
  intentos INT NOT NULL DEFAULT 0, ultima_consulta_en DATETIME NULL,
  version INT NOT NULL DEFAULT 1,               -- optimista
  creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_idempotencia (clave_idempotencia),
  UNIQUE KEY uq_fel_autorizacion (empresa_id, ambiente, autorizacion),
  KEY idx_fel_factura (empresa_id, factura_id),
  CONSTRAINT fk_fel_doc_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fel_doc_emisor FOREIGN KEY (emisor_id) REFERENCES fel_emisores (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Una sola fila "viva" por factura/ambiente: se garantiza con columna generada
--   viva TINYINT AS (estado NOT IN ('RECHAZADA','ANULADA')) y UNIQUE (factura_id, ambiente, viva)  [a validar en MariaDB]

-- 6.3 Historial de intentos (append-only; nunca UPDATE/DELETE)
CREATE TABLE fel_intentos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  documento_id INT NOT NULL,
  tipo ENUM('CERTIFICAR','CONSULTAR','ANULAR','CONCILIAR_MANUAL') NOT NULL,
  clave_idempotencia CHAR(36) NOT NULL,
  resultado ENUM('ENVIANDO','CERTIFICADO','RECHAZADO','INCIERTO','ERROR_CONFIG','ANULADO') NOT NULL,
  http_status SMALLINT NULL, duracion_ms INT NULL,
  codigo VARCHAR(60) NULL, mensaje VARCHAR(500) NULL,
  respuesta_redactada TEXT NULL,                -- recortada y sanitizada (§9)
  usuario_id INT NULL, creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fel_int_doc (documento_id, creado_en),
  CONSTRAINT fk_fel_int_doc FOREIGN KEY (documento_id) REFERENCES fel_documentos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6.4 Cambios aditivos mínimos en fact_facturas (tabla en producción; reconciliar sql/schema.sql, que hoy NO la contiene)
--   entidad_id INT NULL (emisor), moneda CHAR(3) NOT NULL DEFAULT 'GTQ', tipo_documento VARCHAR(10) NULL,
--   facturado_externo TINYINT(1) NOT NULL DEFAULT 0  (viajes facturados fuera de SITSA: convivencia)
```

Decisiones: tabla 1:1 + historial (no columnas en `fact_facturas`); XML en BD (≈15 KB por documento en los casos revisados; `LONGTEXT`), PDF como archivo en la raíz persistente de uploads con su ruta en BD (patrón de `src/lib/uploads.ts`); `ON DELETE RESTRICT` para que un documento certificado nunca se borre por cascada. **`src/lib/admin/limpiar-*` borra facturas hoy:** debe bloquear/ignorar facturas con documento FEL PROD antes de operar con datos reales.

## 7. Idempotencia, reintentos y respuesta incierta (crítico)

**Caso obligatorio:** SITSA envía, INFILE certifica, la conexión se corta antes de la respuesta.

Protocolo (cada paso es una transacción corta; la llamada HTTP queda **fuera** de cualquier transacción):

1. **Preparar (TX1):** `SELECT … FOR UPDATE` de la factura; validar (Borrador, emisor listo, viajes Cerrados, sin documento vivo). Construir y **congelar** el DTO y el XML; generar `clave_idempotencia` (UUID) y su hash. Insertar `fel_documentos` (`PENDIENTE`) y `fel_intentos` (`ENVIANDO`). **COMMIT.**
2. **Enviar (sin TX):** `provider.certificar(...)` con timeout acotado (valor recomendado por INFILE: A CONFIRMAR) usando la clave de idempotencia/referencia del emisor como identificador del documento (si INFILE lo admite — A CONFIRMAR; Milenium ya correlacionaba con un `NUMERO_GUID` en su Adenda).
3. **Registrar (TX2), según resultado:**
   - `CERTIFICADO` → guardar autorización/serie/número/XML, `estado=CERTIFICADA`, `fact_facturas.estado_admin='Emitida'` y número de factura = serie-número, intento `CERTIFICADO`, auditoría. Todo en **una** transacción.
   - `RECHAZADO` → `RECHAZADA` con el motivo; la factura sigue Borrador y editable.
   - `INCIERTO` (timeout, corte, 5xx, respuesta ilegible) → `INCIERTA`. **La factura queda bloqueada.**
4. **Si queda INCIERTA** el sistema **no** permite «Certificar» de nuevo. Solo:
   - **Consultar estado** (`provider.consultar` por la referencia/identificador enviado): si el certificador la tiene → pasar a `CERTIFICADA` y completar TX2 como en el éxito (es la recuperación del caso obligatorio); si confirma que **no existe** → `RECHAZADA` (reintentable, **reusando el mismo DTO/XML y la misma clave** mientras la factura no haya cambiado; si cambió, nueva clave solo después de la confirmación de inexistencia).
   - Si INFILE **no permite consultar** (A CONFIRMAR): acción **«Conciliar manualmente»** (permiso especial): un humano verifica en el portal de INFILE/SAT y registra autorización/serie/número y XML, o declara «no emitida». Queda como intento `CONCILIAR_MANUAL` con usuario y evidencia.
5. **Caída del servidor** entre TX1 y TX2: queda `PENDIENTE` con un intento `ENVIANDO` sin cierre. Al abrir la factura (o con una acción «Reconciliar pendientes» del emisor) cualquier documento `PENDIENTE` con más de N minutos se trata como `INCIERTA` y exige consulta. No hay cron: la reconciliación es bajo demanda (y puede añadirse un job externo después).
6. **Garantías de BD:** `UNIQUE(clave_idempotencia)`, una sola fila viva por factura/ambiente, `version` optimista, `FOR UPDATE` en TX1/TX2: dos clics o dos usuarios no crean dos documentos.
7. **Auditoría de intentos:** cada envío/consulta/anulación es una fila en `fel_intentos` (sin XML completo ni secretos).

## 8. Mapper y datos del DTE

`Factura SITSA → DocumentoFelDto (neutral, basado en la estructura SAT) → payload del proveedor`. El DTO neutral se **congela** en `dto_json`; el XML/payload específico del proveedor se genera desde él (FEL-3).

| Bloque DTE | Qué necesita | Qué cubre hoy SITSA | Faltante |
|---|---|---|---|
| DatosGenerales | tipo, moneda, fecha/hora de emisión | fecha digitada; sin tipo ni moneda | tipo de documento, moneda, hora |
| Emisor | NIT, nombre, nombre comercial, afiliación IVA, establecimiento, correo, dirección estructurada | nada fiscal | todo (`fel_emisores`) |
| Receptor | tipo/ID (NIT/CUI/extranjero/CF), nombre, correo, dirección | `clientes.nit/razon_social/email/direccion` (texto libre) + cuestionario libre | estructura, validación de NIT, consumidor final, depto/municipio, congelado |
| Frases | tipo y escenario según régimen | nada | por emisor |
| Ítems | descripción, cantidad, unidad, precio unitario, bien/servicio, descuento, impuestos | 1 viaje = monto_asignado (código del viaje) | regla de descripción (p. ej. la que pide el cliente), unidad, IVA |
| Impuestos/Totales | IVA (gravable/exento), total impuestos, gran total | `monto_total` sin impuestos | modelo y regla `incluye_iva`, redondeo |
| Complementos | p. ej. abonos de factura cambiaria (número, vencimiento, monto) | `dias_credito` en cuestionario (libre) | derivar abonos de días de crédito |
| Adenda (si el proveedor la admite) | datos propios (código de cliente, ruta, correlativo…) | disponibles en SITSA | A CONFIRMAR si INFILE la admite y cuáles se desean |

## 9. Tipos de documento (candidatos a confirmar)

SITSA hoy **no distingue** tipos: todo es «factura». Los XML de Milenium solo prueban `FCAM`; las tablas DBF evidencian además anulaciones, notas aplicadas, exportación y retenciones.

| Tipo (candidato) | Regla especial prevista | Estado en SITSA |
|---|---|---|
| `FACT` factura | Contado; sin complemento de abonos | no distingue |
| `FCAM` factura cambiaria | Complemento de **abonos** (número, vencimiento, monto); nota legal; crédito | no distingue; días de crédito solo en cuestionario |
| Nota de crédito (`NCRE` en el esquema SAT — el ticket dice `NCRED`: **confirmar**) | Referencia al documento origen certificado (autorización, serie, número, fecha); motivo; solo sobre documentos certificados; resuelve «anular con pagos» | no existe |
| `NDEB` nota de débito | Igual referencia al origen; ajuste al alza | no existe |
| Otros (`FPEQ`, `FESP`, exportación…) | Solo si negocio los usa | **confirmar con negocio e INFILE** |

La lista de tipos soportados por INFILE y su código exacto son **A CONFIRMAR**; el diseño es extensible (columna `tipo_documento`, validadores por tipo).

## 10. Anulaciones

Separar:
- **Anular factura interna** (hoy): sin FEL o `Borrador`; sin pagos; libera viajes. Se conserva.
- **Anular FEL certificada:** una factura con documento `CERTIFICADA` **no** puede quedar «Anulada» solo en BD.

Flujo: usuario con permiso `fel_anular` → solicita con **motivo obligatorio** y confirmación → `fel_documentos.estado=ANULACION_PENDIENTE` + intento `ANULAR` (misma disciplina de idempotencia que certificar) → `provider.anular` → éxito: `ANULADA`, `fact_facturas.estado_admin='Anulada'`, liberar viajes, en **una** transacción; incierto: `ANULACION_INCIERTA` → consultar/conciliar; error: sigue `CERTIFICADA` con el error visible. Plazos y condiciones de anulación ante SAT, y si la anulación exige que el receptor la acepte: **A CONFIRMAR**; fuera de plazo o con pagos se usa **nota de crédito**. Si hay pagos, el bloqueo actual se mantiene hasta tener notas de crédito.

## 11. PDF

Opciones: **A)** generado por SITSA (`pdf-lib`/`pdfkit` ya están en el proyecto; control total, plantillas inspiradas en `fFacturaFel`), **B)** el que devuelva INFILE (cero mantenimiento, fidelidad legal), **C)** soportar ambos.

**Recomendación: C**, con `pdf_origen` y `pdf_ruta`/`pdf_url`. FEL-3 usa el PDF del proveedor si existe (A CONFIRMAR) y FEL-4 agrega el PDF propio para tener representación gráfica sin depender de la disponibilidad de INFILE. En esta fase **no se altera ningún PDF**.

## 12. Histórico de Milenium como referencia

Material disponible: XML certificados, ~22,000 PDF, plantillas FRX/FRT y tablas DBF. Uso previsto **solo** como casos de comparación; **no** se copian datos financieros reales al repositorio ni se importan.

Herramienta offline futura (fuera del repositorio o en `scripts/` sin datos): lee una ruta local de Milenium, toma una factura histórica (XML + DBF) y compara con el DTO que SITSA generaría para el mismo caso: estructura (bloques presentes), tipo, moneda, receptor, ítems, impuestos y totales, con tolerancia de redondeo. Salida: informe de diferencias sin PII persistida. Los tests del repositorio usan **fixtures sintéticos** con la misma estructura.

## 13. Seguridad

Permisos nuevos en el catálogo de Facturación (patrón de #411/#414; ninguno se asigna por defecto): `fel_certificar`, `fel_anular`, `fel_ver_xml` (ver/descargar XML y PDF), `fel_consultar`/`fel_reintentar`, `fel_conciliar`, `fel_configurar` (emisores/credenciales; Admin). «Emitir factura» **no** implica certificar sin FEL habilitado y viceversa; cada ruta valida tenant + que el emisor/entidad pertenezca a la empresa.

Logs y respuestas guardadas — **nunca**: tokens, contraseñas, llaves, cabeceras `Authorization`, secretos descifrados, ni el XML completo en logs. `redaccion.ts`: lista cerrada de claves a ocultar (`password`, `token`, `authorization`, `llave`, `secret`, `apikey`…) a cualquier profundidad, truncado (p. ej. 2 KB) y registro solo de ids/códigos/estado/duración. La respuesta cruda se guarda redactada y recortada; el XML certificado vive en `fel_documentos` con acceso por permiso y no se expone en listados.

## 14. API interna (tentativa; reutiliza rutas naturales)

| Ruta | Acción |
|---|---|
| `POST /facturacion/facturas/[id]/emitir` (**existe**) | Con emisor FEL en modo TEST/PROD delega a `fel/servicio.certificarFactura`; sin FEL, igual que hoy. **No** se crea un `/certificar` redundante |
| `GET /facturacion/facturas/[id]/fel` | Estado FEL + intentos (sin XML) |
| `POST /facturacion/facturas/[id]/fel/consultar` | Consultar estado (respuesta incierta / pendientes) |
| `POST /facturacion/facturas/[id]/fel/reintentar` | Reenvío tras `RECHAZADA` o inexistencia confirmada (mismo protocolo §7) |
| `POST /facturacion/facturas/[id]/fel/anular` | Anulación FEL con motivo |
| `POST /facturacion/facturas/[id]/fel/conciliar` | Conciliación manual (permiso especial) |
| `GET /facturacion/facturas/[id]/fel/xml` · `…/pdf` | Descargas con permiso |
| `GET/PUT /facturacion/fel/emisores` | Configuración de emisores/credenciales (write-only) |

## 15. UI (no implementada)

La tabla/detalle muestra **dos estados**: interno (`Borrador/Emitida/Anulada` + estado financiero) y FEL (`Sin FEL / Certificando / Certificada / Rechazada / Incierta — consultar / Anulación pendiente / Anulada`), con distintivo «PRUEBA» en TEST.

| Estado FEL | Acciones (según permiso) |
|---|---|
| Sin FEL / Borrador | Emitir (certificar) |
| Rechazada | Ver motivo, editar, Reintentar |
| Incierta / Pendiente | Consultar (única acción), Conciliar manualmente |
| Certificada | Descargar XML/PDF, Anular FEL, Nota de crédito (FEL-5) |
| Anulada | Descargar |

La página de configuración de emisores (FEL-4) usa el patrón write-only de credenciales.
