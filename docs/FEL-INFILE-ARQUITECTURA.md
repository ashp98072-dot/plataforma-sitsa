# FEL con INFILE — Arquitectura propuesta

Estado: **DISEÑO. No implementado.** Nada de lo que sigue conecta con INFILE ni ejecuta SQL. Todo lo marcado **A CONFIRMAR** depende de documentación oficial que aún no tenemos ([DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md)). Complementa [DISCOVERY](FEL-INFILE-DISCOVERY.md) y [PLAN](FEL-INFILE-PLAN.md).

## 0. Principios

1. Una factura **no** está «emitida con FEL» hasta que el certificador confirmó el éxito y se guardó su autorización.
2. Nunca se llama al certificador dentro de una transacción de BD abierta.
3. Nunca se certifica dos veces «a ciegas»: toda respuesta incierta se **consulta** antes de reenviar.
4. La lógica de Facturación **no conoce** a INFILE: depende de una interfaz (`FelProvider`).
5. El emisor es **(empresa, entidad)**, no el tenant.
6. Secretos cifrados, write-only en la UI, nunca en git ni en logs.
7. TEST y PROD nunca se mezclan: **una sola fuente de verdad** del modo y documentos atados a su ambiente por FK (§2).
8. El aislamiento por empresa es **estructural** (FK compuestas con `empresa_id`), además de la validación en la aplicación (§6.0).
9. Un viaje ya facturado fuera de SITSA se marca **a nivel de viaje**, sin facturas ficticias (§6.2).

## 1. Estructura de código propuesta

```
src/lib/fel/
  tipos.ts              # dominio: TipoDocumentoFel, EstadoFel, DocumentoFelDto, errores tipados
  provider.ts           # interfaz FelProvider + resultados (unión discriminada)
  mapper/               # Factura SITSA -> DocumentoFelDto (puro, sin red)
  emisor.ts             # resolverConfiguracionActiva(empresa, entidad): ÚNICO punto que lee fel_modo y devuelve la fila de ambiente
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

## 2. Configuración por emisor y ambiente — una sola fuente de verdad

**Decisión: alternativa A.** `fel_emisores` es la configuración **lógica** por `(empresa_id, entidad_id)` y es la **única** fuente del modo activo (`fel_modo = DESACTIVADO | TEST | PROD`). La configuración fiscal y los secretos **por ambiente** viven en filas hijas `fel_emisor_ambientes` (`TEST`, `PROD`).

Por qué A y no B (una fila por ambiente con un boolean «activo»): en B el «modo efectivo» sería una invariante entre filas hermanas («solo una activa por emisor») que MariaDB no puede garantizar con un `UNIQUE` simple, y el modo se resolvería «fuera» de la tabla. En A el modo es **una columna** del padre; no existe forma de tener dos modos a la vez ni un modo que contradiga un ambiente.

**Por qué es imposible, por diseño, enviar una configuración TEST como PROD (o al revés):**
1. **No hay ambiente en el padre ni en la petición.** El ambiente efectivo para documentos **nuevos** es siempre `fel_emisores.fel_modo` (`TEST`→fila `TEST`, `PROD`→fila `PROD`, `DESACTIVADO`→no se certifica). Una única función (`resolverConfiguracionActiva(empresa, entidad)`) lee ese par; ninguna ruta ni formulario acepta un «ambiente» del cliente.
2. **El documento queda atado a su configuración por FK compuesta:** `fel_documentos(empresa_id, emisor_id, ambiente)` → `fel_emisor_ambientes(empresa_id, emisor_id, ambiente)`. El documento guarda el `ambiente` con el que nació y el proveedor se contextualiza **desde la fila referenciada por el documento**, no re-resolviendo el modo. Así un documento en vuelo (PENDIENTE/INCIERTA) se consulta/reenvía/anula con **su** ambiente aunque luego se cambie el modo del emisor; el cambio de modo solo gobierna documentos **nuevos**.
3. **Los secretos no son intercambiables:** el cifrado usa AAD = `empresa_id|entidad_id|ambiente`; un secreto TEST copiado a la fila PROD no descifra.
4. **Anfitrión permitido por ambiente:** cada fila hija guarda su `base_url` y la aplicación valida contra una lista cerrada de hosts por `(proveedor, ambiente)` (A CONFIRMAR cómo distingue INFILE los ambientes); el proveedor se niega a enviar si el host no corresponde al ambiente del documento.
5. **Promover a PROD es explícito:** `fel_modo = 'PROD'` solo se acepta si existe la fila `PROD` completa, con `verificada_en` (verificación de configuración exitosa) y `habilitada_prod_por/en`; requiere permiso `fel_configurar` y queda auditado. Pasar de TEST a PROD **no copia datos**: la fila PROD se captura aparte.

Otras reglas de separación: documentos TEST se rotulan «PRUEBA», se excluyen de reportes y cobros y **no consumen** numeración oficial; una factura con documento TEST certificado sigue en `Borrador`. Campos fiscales por ambiente (NIT, nombre, establecimiento, dirección, frases, correo, códigos del proveedor) viven en la fila hija porque el sandbox puede usar datos distintos (A CONFIRMAR); el padre solo lleva `proveedor`, `fel_modo`, `tipo_documento_default`, `inicio_emision` y `activo`.

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

// Resultado de ENVIAR (certificar): el certificador respondió de forma interpretable, o no.
type ResultadoCertificacion =
  | { tipo: "CERTIFICADO"; autorizacion: string; serie: string; numero: string; fechaCertificacion: string; xmlCertificado: string; pdfUrl?: string; rawRedactado: unknown }
  | { tipo: "RECHAZADO";   codigo?: string; mensaje: string; corregible: boolean; rawRedactado: unknown }   // el certificador RECIBIÓ y PROCESÓ la solicitud y la rechazó definitivamente (validación/regla)
  | { tipo: "INCIERTO";    motivo: "TIMEOUT" | "RED" | "HTTP_5XX" | "RESPUESTA_ILEGIBLE" }                    // NO se sabe si se certificó: NO reenviar a ciegas
  | { tipo: "ERROR_CONFIG"; mensaje: string };                                                                 // credenciales/ambiente/emisor

// Resultado de CONSULTAR: semántica DISTINTA a la de enviar. NO_ENCONTRADO != RECHAZADO.
type ResultadoConsulta =
  | { tipo: "CERTIFICADO";    autorizacion: string; serie: string; numero: string; fechaCertificacion: string; xmlCertificado: string; pdfUrl?: string } // recuperación
  | { tipo: "PENDIENTE";      detalle?: string }                  // el certificador lo tiene y aún no concluye: volver a consultar más tarde
  | { tipo: "RECHAZADO";      codigo?: string; mensaje: string }  // solo si el contrato de consulta lo expone: fue procesado y rechazado
  | { tipo: "NO_ENCONTRADO" }                                     // la OPERACIÓN DE CONSULTA, según el contrato oficial, confirma que NO existe certificación para la referencia enviada
  | { tipo: "INCIERTO";       motivo: "TIMEOUT" | "RED" | "HTTP_5XX" | "RESPUESTA_ILEGIBLE" | "NO_CONSULTABLE" }
  | { tipo: "ERROR_CONFIG";   mensaje: string };

type ResultadoAnulacion = /* mismo patrón: ANULADO | RECHAZADO | INCIERTO | ERROR_CONFIG; su consulta: ANULADO | NO_ANULADO | PENDIENTE | INCIERTO | ERROR_CONFIG */;
```

**Definiciones que no se pueden confundir:**
- `RECHAZADO` = el certificador recibió/procesó la solicitud y la **rechazó definitivamente** por validación o regla.
- `NO_ENCONTRADO` = la **operación de consulta** confirma que **no existe** certificación para la referencia enviada. Es una afirmación de la consulta, no de la certificación.
- **Nunca** se infiere `NO_ENCONTRADO` de un timeout, un corte, un HTTP 404/5xx ni de «no hubo respuesta»: eso es `INCIERTO`. Qué respuesta del certificador significa `NO_ENCONTRADO` (código HTTP, cuerpo, código de error) se define **solo** con la documentación oficial de INFILE (**A CONFIRMAR**). Si INFILE no ofrece una consulta confiable (`NO_CONSULTABLE`), el sistema **no** puede llegar a `NO_ENCONTRADO` y la única salida es la conciliación manual.

La clasificación interna es el contrato estable; cómo se obtiene de las respuestas de INFILE se define en FEL-3. El proveedor `MOCK` reproduce todos los caminos (incluidos `NO_ENCONTRADO` y `PENDIENTE`).

## 5. Ciclo de vida

Estados FEL **separados** de `estado_admin` (el ENUM `Borrador/Emitida/Anulada` no se modifica):

```
(sin documento)          NO_CERTIFICADA   (factura sin FEL: emisor DESACTIVADO o factura anterior)
   ── certificar ──▶     PENDIENTE        (documento registrado, solicitud enviada o por enviar)
   ── respuesta ──▶      CERTIFICADA | RECHAZADA | INCIERTA
   RECHAZADA     ── el certificador la rechazó: corregir ──▶ PENDIENTE (nueva clave si cambia el DTO)
   INCIERTA      ── consultar ──▶ CERTIFICADA                       (recuperación)
                              ──▶ INCIERTA (PENDIENTE en el certificador / consulta incierta: consultar luego)
                              ──▶ RECHAZADA (si la consulta expone «procesado y rechazado»)
                              ──▶ NO_ENCONTRADA                      (consulta confirma que NO existe)
   NO_ENCONTRADA ── reintento seguro (MISMO DTO y MISMA clave) ──▶ PENDIENTE
   CERTIFICADA   ── anular FEL ──▶ ANULACION_PENDIENTE ──▶ ANULADA | ANULACION_INCIERTA ──consultar──▶ ANULADA | CERTIFICADA (no anulada confirmada) | sigue incierta
```

`RECHAZADA` y `NO_ENCONTRADA` tienen semántica y tratamiento distintos: la primera exige **corregir** datos; la segunda no (el documento nunca llegó a certificarse) y se reenvía **idéntico**.

Relación con el estado interno cuando el emisor tiene FEL en modo `PROD`:

| Acción | `estado_admin` | Estado FEL |
|---|---|---|
| Crear/editar borrador | Borrador | — |
| «Emitir» (certificar) | Borrador **hasta** confirmar | PENDIENTE → CERTIFICADA |
| Éxito confirmado | **Emitida** (en la **misma transacción** que guarda la autorización) | CERTIFICADA |
| Rechazo | Borrador | RECHAZADA (editable) |
| Incierto / no encontrada | Borrador (bloqueado: no editable ni anulable) | INCIERTA / NO_ENCONTRADA |
| Anular FEL confirmado | **Anulada** (+ liberar viajes) en la misma transacción | ANULADA |

Mientras el estado FEL sea PENDIENTE/INCIERTA/NO_ENCONTRADA/ANULACION_* la factura queda **bloqueada** (no se edita, no se anula interna, no se registran pagos). Con el emisor `DESACTIVADO` el flujo actual no cambia.

## 6. Persistencia (propuesta; **NO se ejecuta SQL**)

Se evita ensuciar `fact_facturas` (tabla 1:1 por documento + historial append-only) y **no se contamina TMS** con estado fiscal.

### 6.0 Aislamiento multi-tenant estructural (FK compuestas)

Principio: toda tabla fiscal nueva lleva `empresa_id` y se relaciona con sus padres por **FK compuesta que incluye `empresa_id`**, de modo que la BD no permita asociar el documento fiscal de la empresa A con la factura, el emisor o el viaje de la empresa B. La aplicación sigue validando tenant (CLAUDE.md §5); la FK es la segunda barrera.

Inventario de claves necesarias (verificado contra `sql/schema.sql`; **no se inventan índices existentes**):

| Padre | Clave compuesta requerida | ¿Existe hoy? |
|---|---|---|
| `cont_entidades` | `UNIQUE (empresa_id, id)` | **Sí** — `uq_cont_entidad_empresa_id` |
| `tms_planes_viaje` | `UNIQUE (empresa_id, id)` | **Sí** — `uq_tmsplanes_empresa_id` |
| `fact_facturas` | `UNIQUE (empresa_id, id)` y `UNIQUE (empresa_id, id, entidad_id)` | **No.** Solo existe `uq_factura_numero (empresa_id, numero_factura)`. Hay que **agregarlas** (DDL aditivo sobre una tabla en producción, a revisar con preflight; las nuevas columnas `entidad_id` son NULL en lo histórico) |
| `fel_emisores` (nueva) | `UNIQUE (empresa_id, id)`, `UNIQUE (empresa_id, id, entidad_id)`, `UNIQUE (empresa_id, entidad_id)` | se define al crearla |
| `fel_emisor_ambientes` (nueva) | `UNIQUE (empresa_id, emisor_id, ambiente)` | se define al crearla |
| `fel_documentos` (nueva) | `UNIQUE (empresa_id, id)` | se define al crearla |

Nota (fuera de alcance, solo se reporta): las tablas actuales `fact_factura_viajes` y `fact_pagos` se relacionan **solo por `factura_id`/`plan_id`** (sin FK compuesta con `empresa_id`); no se modifican en esta línea de trabajo.

### 6.1 DDL conceptual

```sql
-- PROPUESTA (no ejecutar). MariaDB 11.8. Sin IF [NOT] EXISTS en ALTER (dio problemas en Hostinger).

-- 6.1.a Cambios aditivos en fact_facturas (tabla en producción; reconciliar sql/schema.sql, que hoy NO la contiene)
--   ADD COLUMN entidad_id INT NULL, ADD COLUMN moneda CHAR(3) NOT NULL DEFAULT 'GTQ', ADD COLUMN tipo_documento VARCHAR(10) NULL,
--   ADD UNIQUE KEY uq_factura_empresa_id (empresa_id, id),
--   ADD UNIQUE KEY uq_factura_empresa_id_entidad (empresa_id, id, entidad_id),
--   ADD CONSTRAINT fk_factura_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades (empresa_id, id)
--   (SIN columna «facturado_externo»: la facturación externa se modela a nivel de viaje, ver 6.1.f y 6.2)

-- 6.1.b Emisor LÓGICO por (empresa, entidad): única fuente del modo activo
CREATE TABLE fel_emisores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,                        -- KT / MONACO (cont_entidades)
  proveedor VARCHAR(20) NOT NULL DEFAULT 'INFILE',
  fel_modo ENUM('DESACTIVADO','TEST','PROD') NOT NULL DEFAULT 'DESACTIVADO',   -- ÚNICA fuente de verdad del modo
  tipo_documento_default VARCHAR(10) NULL,
  inicio_emision DATE NULL,                       -- fecha de corte (convivencia con Milenium)
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_emisor_entidad (empresa_id, entidad_id),
  UNIQUE KEY uq_fel_emisor_empresa_id (empresa_id, id),
  UNIQUE KEY uq_fel_emisor_empresa_id_entidad (empresa_id, id, entidad_id),
  CONSTRAINT fk_fel_emisor_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fel_emisor_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6.1.c Configuración y secretos POR AMBIENTE (filas hijas TEST / PROD)
CREATE TABLE fel_emisor_ambientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  emisor_id INT NOT NULL,
  ambiente ENUM('TEST','PROD') NOT NULL,
  base_url VARCHAR(300) NOT NULL,                 -- validada contra lista cerrada de hosts por (proveedor, ambiente)
  nit_emisor VARCHAR(20) NOT NULL,
  nombre_emisor VARCHAR(250) NOT NULL, nombre_comercial VARCHAR(250) NULL,
  afiliacion_iva VARCHAR(10) NOT NULL,            -- código SAT (A CONFIRMAR catálogo)
  codigo_establecimiento VARCHAR(10) NOT NULL,
  correo VARCHAR(160) NULL, telefono VARCHAR(40) NULL,
  direccion VARCHAR(300) NOT NULL, codigo_postal VARCHAR(10) NULL,
  municipio VARCHAR(80) NOT NULL, departamento VARCHAR(80) NOT NULL, pais CHAR(2) NOT NULL DEFAULT 'GT',
  frases_json JSON NULL, moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  config_proveedor_json JSON NULL,                -- ids/códigos que pida INFILE (A CONFIRMAR); SIN secretos
  secreto_cifrado TEXT NULL,                      -- v2.<kid>.iv.tag.cipher; AAD = empresa|entidad|ambiente
  secreto_actualizado_en DATETIME NULL, secreto_actualizado_por INT NULL,
  verificada_en DATETIME NULL,                    -- última verificación de configuración exitosa
  habilitada_prod_por INT NULL, habilitada_prod_en DATETIME NULL,    -- requerido para fel_modo = 'PROD'
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_amb (emisor_id, ambiente),
  UNIQUE KEY uq_fel_amb_empresa (empresa_id, emisor_id, ambiente),
  CONSTRAINT fk_fel_amb_emisor FOREIGN KEY (empresa_id, emisor_id) REFERENCES fel_emisores (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6.1.d Documento FEL: una fila VIGENTE por factura
CREATE TABLE fel_documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  factura_id INT NOT NULL,
  emisor_id INT NOT NULL,
  entidad_id INT NOT NULL,                        -- debe coincidir con la entidad de la factura Y del emisor (FKs abajo)
  ambiente ENUM('TEST','PROD') NOT NULL,          -- ambiente con el que NACIÓ; atado a su configuración por FK
  proveedor VARCHAR(20) NOT NULL,
  tipo_documento VARCHAR(10) NOT NULL,            -- FACT/FCAM/NCRE/NDEB… (A CONFIRMAR códigos)
  estado ENUM('PENDIENTE','CERTIFICADA','RECHAZADA','INCIERTA','NO_ENCONTRADA',
              'ANULACION_PENDIENTE','ANULACION_INCIERTA','ANULADA') NOT NULL,
  clave_idempotencia CHAR(36) NOT NULL,           -- UUID generado ANTES de enviar y persistido
  dto_json LONGTEXT NOT NULL,                     -- DTO congelado (emisor/receptor/ítems/impuestos/totales)
  xml_enviado LONGTEXT NULL, xml_enviado_sha256 CHAR(64) NULL,
  autorizacion VARCHAR(64) NULL, serie VARCHAR(40) NULL, numero VARCHAR(40) NULL, fecha_certificacion DATETIME NULL,
  xml_certificado LONGTEXT NULL,
  pdf_origen ENUM('SITSA','PROVEEDOR') NULL, pdf_ruta VARCHAR(500) NULL, pdf_url VARCHAR(500) NULL,
  motivo_anulacion VARCHAR(500) NULL, anulado_por INT NULL, anulado_en DATETIME NULL, autorizacion_anulacion VARCHAR(64) NULL,
  ultimo_error_codigo VARCHAR(60) NULL, ultimo_error_mensaje VARCHAR(500) NULL,
  intentos INT NOT NULL DEFAULT 0, ultima_consulta_en DATETIME NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_idempotencia (clave_idempotencia),
  UNIQUE KEY uq_fel_doc_empresa_id (empresa_id, id),
  UNIQUE KEY uq_fel_autorizacion (empresa_id, ambiente, autorizacion),
  KEY idx_fel_factura (empresa_id, factura_id),
  -- La factura es de la MISMA empresa y de la MISMA entidad que el documento (exige fact_facturas.entidad_id NOT NULL para certificar):
  CONSTRAINT fk_fel_doc_factura FOREIGN KEY (empresa_id, factura_id, entidad_id) REFERENCES fact_facturas (empresa_id, id, entidad_id) ON DELETE RESTRICT,
  -- El emisor es de la MISMA empresa y de la MISMA entidad:
  CONSTRAINT fk_fel_doc_emisor FOREIGN KEY (empresa_id, emisor_id, entidad_id) REFERENCES fel_emisores (empresa_id, id, entidad_id) ON DELETE RESTRICT,
  -- El ambiente del documento DEBE existir como configuración de ese emisor (imposible un TEST/PROD sin su fila):
  CONSTRAINT fk_fel_doc_ambiente FOREIGN KEY (empresa_id, emisor_id, ambiente) REFERENCES fel_emisor_ambientes (empresa_id, emisor_id, ambiente) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Una sola fila "viva" por factura: columna generada viva (estado NOT IN ('RECHAZADA','ANULADA') → 1, si no NULL) con
-- UNIQUE (empresa_id, factura_id, viva)  [a validar en MariaDB; los NULL no chocan].

-- 6.1.e Intentos (append-only; nunca UPDATE/DELETE), también con empresa_id
CREATE TABLE fel_intentos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  documento_id INT NOT NULL,
  tipo ENUM('CERTIFICAR','CONSULTAR','ANULAR','CONSULTAR_ANULACION','CONCILIAR_MANUAL') NOT NULL,
  clave_idempotencia CHAR(36) NOT NULL,
  resultado ENUM('ENVIANDO','CERTIFICADO','RECHAZADO','PENDIENTE','NO_ENCONTRADO','INCIERTO','ERROR_CONFIG','ANULADO','NO_ANULADO') NOT NULL,
  http_status SMALLINT NULL, duracion_ms INT NULL, codigo VARCHAR(60) NULL, mensaje VARCHAR(500) NULL,
  respuesta_redactada TEXT NULL,                  -- recortada y sanitizada (§13)
  usuario_id INT NULL, creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fel_int_doc (empresa_id, documento_id, creado_en),
  CONSTRAINT fk_fel_int_doc FOREIGN KEY (empresa_id, documento_id) REFERENCES fel_documentos (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6.1.f Facturación EXTERNA a nivel de VIAJE (reemplaza el antiguo fact_facturas.facturado_externo)
CREATE TABLE fact_viajes_facturacion_externa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,                           -- el viaje (tms_planes_viaje)
  entidad_id INT NULL,                            -- entidad emisora del documento externo (si se conoce)
  sistema_origen VARCHAR(20) NOT NULL DEFAULT 'MILENIUM',
  referencia_externa VARCHAR(120) NULL,           -- serie/número/autorización del documento externo, opcional
  fecha_documento DATE NULL,
  observacion VARCHAR(500) NULL,
  lote_importacion VARCHAR(60) NULL,              -- para la futura importación desde Milenium
  marcado_por INT NOT NULL, marcado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revertido_por INT NULL, revertido_en DATETIME NULL, motivo_reversion VARCHAR(500) NULL,
  vigente TINYINT NULL DEFAULT 1,                 -- 1 = marca viva; NULL = revertida (la fila se conserva como historial)
  UNIQUE KEY uq_fact_ext_plan_vigente (plan_id, vigente),      -- a lo sumo UNA marca viva por viaje; las revertidas (NULL) no chocan
  KEY idx_fact_ext_empresa (empresa_id, plan_id),
  CONSTRAINT fk_fact_ext_plan FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fact_ext_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 6.2 Facturación externa (viajes ya facturados en Milenium)

**Problema:** el viaje existe en SITSA, se facturó en Milenium y **no existe** una `fact_facturas` de SITSA donde guardar una marca. **Solución elegida: tabla separada y auditable a nivel de viaje** (opción A), `fact_viajes_facturacion_externa`, sin crear facturas ficticias y sin agregar estado fiscal a `tms_planes_viaje` (no se contamina TMS).

- **Excluir del listado:** `listarViajesPendientes` (hoy ya excluye con `NOT EXISTS (… fact_factura_viajes …)`) agrega `NOT EXISTS (SELECT 1 FROM fact_viajes_facturacion_externa x WHERE x.empresa_id = p.empresa_id AND x.plan_id = p.id AND x.vigente = 1)`. El mismo chequeo va en `validarYBloquearPlanes` (rechazo con mensaje «ya facturado fuera de SITSA») y en los reportes que derivan el estado del viaje («Facturado (externo)»).
- **Doble facturación:** `UNIQUE (plan_id, vigente)` impide dos marcas vivas; la exclusión mutua con una factura de SITSA (`UNIQUE(plan_id)` de `fact_factura_viajes`) se garantiza **en la aplicación**, dentro de la transacción que ya hace `SELECT … FOR UPDATE` sobre el plan (marcar y facturar toman el mismo lock del viaje y revalidan la otra tabla). No hay trigger.
- **Quién marcó y cuándo:** `marcado_por/marcado_en`, `sistema_origen`, `referencia_externa`, `fecha_documento`, `observacion`, más auditoría (`registrarAuditoriaTx`, acción `marcar_viaje_facturado_externo`).
- **Revertir un marcado erróneo con auditoría:** nunca se borra la fila: se llenan `revertido_por/en` + `motivo_reversion` y `vigente = NULL`; el viaje vuelve a ser facturable. Permiso propio (`fel_marcar_externo`), acción auditada `revertir_viaje_facturado_externo`. Solo si no hay factura SITSA viva sobre ese viaje.
- **Futura importación desde Milenium:** `lote_importacion` + `sistema_origen='MILENIUM'` + `referencia_externa` permiten cargar en lote (vista previa, rechazos, reintento idempotente por `plan_id`) y revertir un lote completo. No se importa nada en esta fase.
- **No requiere** crear una factura SITSA ficticia ni tocar `fact_factura_viajes`.

### 6.3 Decisiones de almacenamiento

Tabla 1:1 + historial (no columnas FEL en `fact_facturas`); XML en BD (≈15 KB por documento en los casos revisados); PDF como archivo en la raíz persistente de uploads con su ruta en BD (patrón de `src/lib/uploads.ts`); `ON DELETE RESTRICT` para que un documento certificado nunca se borre por cascada. **`src/lib/admin/limpiar-*` borra facturas hoy:** debe bloquear/ignorar facturas con documento FEL PROD (y marcas externas) antes de operar con datos reales.

## 7. Idempotencia, reintentos y respuesta incierta (crítico)

**Caso obligatorio:** SITSA envía, INFILE certifica, la conexión se corta antes de la respuesta.

Protocolo (cada paso es una transacción corta; la llamada HTTP queda **fuera** de cualquier transacción):

1. **Preparar (TX1):** `SELECT … FOR UPDATE` de la factura; validar (Borrador, emisor listo con su modo/ambiente resuelto **una sola vez**, viajes Cerrados y no marcados como facturados externos, sin documento vivo). Construir y **congelar** el DTO y el XML; generar `clave_idempotencia` (UUID) y su hash. Insertar `fel_documentos` (`PENDIENTE`, con su `ambiente`) y `fel_intentos` (`ENVIANDO`). **COMMIT.**
2. **Enviar (sin TX):** `provider.certificar(...)` con el contexto de la **fila de ambiente referenciada por el documento**, timeout acotado (valor recomendado por INFILE: A CONFIRMAR), usando la clave de idempotencia/referencia del emisor como identificador del documento (si INFILE lo admite — A CONFIRMAR; Milenium ya correlacionaba con un `NUMERO_GUID` en su Adenda).
3. **Registrar (TX2), según resultado de `certificar`:**
   - `CERTIFICADO` → guardar autorización/serie/número/XML, `estado=CERTIFICADA`, `fact_facturas.estado_admin='Emitida'` y número de factura = serie-número, intento `CERTIFICADO`, auditoría. Todo en **una** transacción.
   - `RECHAZADO` → `RECHAZADA` con el motivo (el certificador **procesó y rechazó** la solicitud); la factura sigue Borrador y editable.
   - `INCIERTO` (timeout, corte, 5xx, respuesta ilegible) → `INCIERTA`. **La factura queda bloqueada.** **No** se concluye nada sobre si existe o no.
4. **Si queda INCIERTA** el sistema **no** permite «Certificar» de nuevo. Solo **Consultar estado** (`provider.consultar` por la referencia/identificador enviado). Resultados:
   - `CERTIFICADO` → se **recupera**: completar TX2 como en el éxito (es la salida del caso obligatorio).
   - `PENDIENTE` → el certificador lo tiene en proceso: sigue `INCIERTA`; volver a consultar más tarde.
   - `RECHAZADO` (solo si el contrato de consulta lo expone) → `RECHAZADA`.
   - `INCIERTO` (la propia consulta falló o `NO_CONSULTABLE`) → sigue `INCIERTA`; no se avanza.
   - `NO_ENCONTRADO` → la consulta **confirma** que no existe certificación para esa referencia → `NO_ENCONTRADA`. **Recién entonces** se permite el reenvío seguro con el **mismo DTO/XML y la misma clave**, previa verificación de que la factura no cambió; si cambió, nueva clave **solo después** de esa confirmación. Guardia adicional configurable (valor A CONFIRMAR con INFILE): ventana mínima desde el envío y/o segunda consulta `NO_ENCONTRADO`, por si el certificador tiene consistencia eventual.
   - **Regla dura:** `NO_ENCONTRADO` solo existe como respuesta de la operación de consulta según el contrato oficial; **nunca** se infiere de un timeout, un corte o un HTTP 404/5xx.
   - Si INFILE **no permite consultar** (A CONFIRMAR): acción **«Conciliar manualmente»** (permiso especial): un humano verifica en el portal de INFILE/SAT y registra autorización/serie/número y XML, o declara «no emitida» con evidencia. Queda como intento `CONCILIAR_MANUAL` con usuario.
5. **Caída del servidor** entre TX1 y TX2: queda `PENDIENTE` con un intento `ENVIANDO` sin cierre. Al abrir la factura (o con «Reconciliar pendientes» del emisor) cualquier documento `PENDIENTE` con más de N minutos se trata como `INCIERTA` y exige consulta. No hay cron: la reconciliación es bajo demanda (puede añadirse un job externo después).
6. **Garantías de BD:** `UNIQUE(clave_idempotencia)`, una sola fila viva por factura, `version` optimista, `FOR UPDATE` en TX1/TX2, FK compuestas multi-tenant (§6.0): dos clics o dos usuarios no crean dos documentos, y un documento nunca se asocia a la factura/emisor de otra empresa.
7. **Auditoría de intentos:** cada envío/consulta/anulación es una fila en `fel_intentos` (sin XML completo ni secretos).
8. **Anulación:** mismo protocolo con `ANULACION_PENDIENTE/INCIERTA`; su consulta devuelve `ANULADO | NO_ANULADO | PENDIENTE | INCIERTO`; `NO_ANULADO` confirmado devuelve el documento a `CERTIFICADA` (nunca se infiere de timeout).

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

Permisos nuevos en el catálogo de Facturación (patrón de #411/#414; ninguno se asigna por defecto): `fel_certificar`, `fel_anular`, `fel_ver_xml` (ver/descargar XML y PDF), `fel_consultar`/`fel_reintentar`, `fel_conciliar`, `fel_marcar_externo`, `fel_configurar` (emisores/credenciales; Admin). «Emitir factura» **no** implica certificar sin FEL habilitado y viceversa; cada ruta valida tenant + que el emisor/entidad pertenezca a la empresa.

Logs y respuestas guardadas — **nunca**: tokens, contraseñas, llaves, cabeceras `Authorization`, secretos descifrados, ni el XML completo en logs. `redaccion.ts`: lista cerrada de claves a ocultar (`password`, `token`, `authorization`, `llave`, `secret`, `apikey`…) a cualquier profundidad, truncado (p. ej. 2 KB) y registro solo de ids/códigos/estado/duración. La respuesta cruda se guarda redactada y recortada; el XML certificado vive en `fel_documentos` con acceso por permiso y no se expone en listados.

## 14. API interna (tentativa; reutiliza rutas naturales)

| Ruta | Acción |
|---|---|
| `POST /facturacion/facturas/[id]/emitir` (**existe**) | Con emisor FEL en modo TEST/PROD delega a `fel/servicio.certificarFactura`; sin FEL, igual que hoy. **No** se crea un `/certificar` redundante |
| `GET /facturacion/facturas/[id]/fel` | Estado FEL + intentos (sin XML) |
| `POST /facturacion/facturas/[id]/fel/consultar` | Consultar estado (respuesta incierta / pendientes) |
| `POST /facturacion/facturas/[id]/fel/reintentar` | Reenvío tras `RECHAZADA` (con datos corregidos) o `NO_ENCONTRADA` (mismo documento y clave; solo si la consulta lo confirmó, §7) |
| `POST /facturacion/facturas/[id]/fel/anular` | Anulación FEL con motivo |
| `POST /facturacion/facturas/[id]/fel/conciliar` | Conciliación manual (permiso especial) |
| `GET /facturacion/facturas/[id]/fel/xml` · `…/pdf` | Descargas con permiso |
| `GET/PUT /facturacion/fel/emisores` | Configuración de emisores, filas de ambiente TEST/PROD y credenciales (write-only); cambio de `fel_modo` con validaciones de §2 |
| `GET/POST/DELETE /facturacion/viajes-externos` | Marcar / listar / revertir (con motivo, nunca borrado físico) viajes facturados fuera de SITSA (§6.2) |

## 15. UI (no implementada)

La tabla/detalle muestra **dos estados**: interno (`Borrador/Emitida/Anulada` + estado financiero) y FEL (`Sin FEL / Certificando / Certificada / Rechazada / Incierta — consultar / Anulación pendiente / Anulada`), con distintivo «PRUEBA» en TEST.

| Estado FEL | Acciones (según permiso) |
|---|---|
| Sin FEL / Borrador | Emitir (certificar) |
| Rechazada (el certificador la rechazó) | Ver motivo, editar, Reintentar |
| Incierta / Pendiente | Consultar (única acción), Conciliar manualmente |
| No encontrada (la consulta confirmó que no existe) | Reintentar con el mismo documento (reenvío seguro) |
| Certificada | Descargar XML/PDF, Anular FEL, Nota de crédito (FEL-5) |
| Anulada | Descargar |

La página de configuración de emisores (FEL-4) usa el patrón write-only de credenciales.
