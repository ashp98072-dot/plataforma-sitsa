-- FEL-2A. Solo aplicar manualmente tras preflight aprobado y comparación de DDL.
-- MariaDB 11.8.9. Sin seeds, sin backfill, sin emisores, sin credenciales, sin datos fiscales, sin asientos.
-- IF NOT EXISTS es NOOP estructural: NO repara drift; preflight/verify son obligatorios.
-- Orden: (1) clave única ADITIVA en fact_facturas, (2) fel_emisores, (3) fel_emisor_ambientes,
--        (4) fel_documentos, (5) fel_intentos. No toca columnas, datos ni FKs de tablas existentes.

-- (1) Único cambio sobre una tabla existente. `id` ya es PK, por lo que cualquier índice UNIQUE que lo contenga se
-- cumple trivialmente (el preflight lo comprueba de todos modos). Es el destino de la FK compuesta de fel_documentos:
-- impide, estructuralmente, ligar un documento fiscal a la factura (o entidad) de otra empresa.
ALTER TABLE fact_facturas
  ADD UNIQUE INDEX IF NOT EXISTS uq_factura_ambito (empresa_id, entidad_id, id);

-- (2) Emisor lógico por (empresa, entidad). ÚNICA fuente del modo. Sin NIT ni datos fiscales aquí.
CREATE TABLE IF NOT EXISTS fel_emisores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  modo VARCHAR(12) NOT NULL DEFAULT 'DESACTIVADO',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_emisor_entidad (empresa_id, entidad_id),
  UNIQUE KEY uq_fel_emisor_empresa_id (empresa_id, id),
  UNIQUE KEY uq_fel_emisor_ambito (empresa_id, id, entidad_id),
  CONSTRAINT fk_fel_emisor_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_emisor_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_emisor_modo CHECK (modo IN ('DESACTIVADO','TEST','PROD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (3) Configuración POR AMBIENTE (TEST / PROD en filas separadas). base_url/NIT/secreto son NULL hasta que el
-- responsable los configure; ningún valor fiscal ni URL de proveedor se inventa. Los datos que dependen de la
-- documentación de INFILE (afiliación IVA, establecimiento, frases, dirección) se agregan de forma aditiva en FEL-3.
CREATE TABLE IF NOT EXISTS fel_emisor_ambientes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  emisor_id INT NOT NULL,
  ambiente VARCHAR(4) NOT NULL,
  proveedor VARCHAR(20) NOT NULL,
  base_url VARCHAR(300) NULL,
  nit_emisor VARCHAR(20) NULL,
  nombre_fiscal VARCHAR(250) NULL,
  secreto_cifrado TEXT NULL,
  secreto_actualizado_en DATETIME NULL,
  secreto_actualizado_por INT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_amb (empresa_id, emisor_id, ambiente),
  UNIQUE KEY uq_fel_amb_proveedor (empresa_id, emisor_id, ambiente, proveedor),
  CONSTRAINT fk_fel_amb_emisor FOREIGN KEY (empresa_id, emisor_id) REFERENCES fel_emisores(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_amb_actor FOREIGN KEY (secreto_actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_amb_ambiente CHECK (ambiente IN ('TEST','PROD')),
  CONSTRAINT ck_fel_amb_proveedor CHECK (CAST(proveedor AS BINARY) REGEXP '^[A-Z0-9_]{2,20}$'),
  -- Un documento MOCK jamás puede pertenecer a un ambiente PROD: CERTIFICADO + PROD implica proveedor real.
  CONSTRAINT ck_fel_amb_mock_no_prod CHECK (NOT (proveedor = 'MOCK' AND ambiente = 'PROD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (4) Documento FEL: FUENTE DE VERDAD FISCAL. Nunca se borra (ON DELETE RESTRICT en todo). estado_admin de
-- fact_facturas NO es prueba fiscal. Un registro por envío fiscal; RECHAZADO es terminal (una corrección = fila nueva).
CREATE TABLE IF NOT EXISTS fel_documentos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  factura_id INT NOT NULL,
  emisor_id INT NOT NULL,
  entidad_id INT NOT NULL,
  ambiente VARCHAR(4) NOT NULL,
  proveedor VARCHAR(20) NOT NULL,
  tipo_documento VARCHAR(12) NOT NULL,
  estado VARCHAR(14) NOT NULL DEFAULT 'PENDIENTE',
  referencia_emisor CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella_dto CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dto_json LONGTEXT NOT NULL,
  documento_origen_id INT NULL,
  motivo VARCHAR(500) NULL,
  autorizacion VARCHAR(64) NULL,
  serie VARCHAR(40) NULL,
  numero VARCHAR(40) NULL,
  fecha_certificacion DATETIME NULL,
  anulado_en DATETIME NULL,
  anulado_por INT NULL,
  motivo_anulacion VARCHAR(500) NULL,
  ultimo_codigo VARCHAR(60) NULL,
  ultimo_mensaje VARCHAR(500) NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  -- A lo sumo UNA factura fiscal viva por fact_facturas: NULL (no choca) para notas y para RECHAZADO.
  factura_viva TINYINT GENERATED ALWAYS AS (CASE WHEN tipo_documento = 'FACTURA' AND estado <> 'RECHAZADO' THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY uq_fel_doc_referencia (referencia_emisor),
  UNIQUE KEY uq_fel_doc_empresa_id (empresa_id, id),
  UNIQUE KEY uq_fel_doc_origen (empresa_id, emisor_id, id),
  UNIQUE KEY uq_fel_doc_autorizacion (empresa_id, ambiente, autorizacion),
  UNIQUE KEY uq_fel_doc_serie_numero (empresa_id, emisor_id, ambiente, serie, numero),
  UNIQUE KEY uq_fel_doc_factura_viva (empresa_id, factura_id, factura_viva),
  KEY idx_fel_doc_factura (empresa_id, factura_id),
  KEY idx_fel_doc_estado (empresa_id, estado),
  CONSTRAINT fk_fel_doc_factura FOREIGN KEY (empresa_id, entidad_id, factura_id) REFERENCES fact_facturas(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_emisor FOREIGN KEY (empresa_id, emisor_id, entidad_id) REFERENCES fel_emisores(empresa_id, id, entidad_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_ambiente FOREIGN KEY (empresa_id, emisor_id, ambiente, proveedor) REFERENCES fel_emisor_ambientes(empresa_id, emisor_id, ambiente, proveedor) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_origen FOREIGN KEY (empresa_id, emisor_id, documento_origen_id) REFERENCES fel_documentos(empresa_id, emisor_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_doc_tipo CHECK (tipo_documento IN ('FACTURA','NOTA_CREDITO','NOTA_DEBITO')),
  CONSTRAINT ck_fel_doc_estado CHECK (estado IN ('PENDIENTE','CERTIFICADO','RECHAZADO','INCIERTO','NO_ENCONTRADO','ANULADO')),
  CONSTRAINT ck_fel_doc_ambiente CHECK (ambiente IN ('TEST','PROD')),
  -- CERTIFICADO/ANULADO exigen la identidad fiscal completa; el resto de estados no puede traerla.
  CONSTRAINT ck_fel_doc_certificacion CHECK (
    (estado IN ('CERTIFICADO','ANULADO') AND autorizacion IS NOT NULL AND serie IS NOT NULL AND numero IS NOT NULL AND fecha_certificacion IS NOT NULL)
    OR (estado NOT IN ('CERTIFICADO','ANULADO') AND autorizacion IS NULL AND serie IS NULL AND numero IS NULL AND fecha_certificacion IS NULL)
  ),
  CONSTRAINT ck_fel_doc_anulacion CHECK (
    (estado = 'ANULADO' AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL)
    OR (estado <> 'ANULADO' AND anulado_en IS NULL AND anulado_por IS NULL AND motivo_anulacion IS NULL)
  ),
  -- Notas de crédito/débito siempre referencian un documento origen; una FACTURA con origen es una refacturación.
  -- La no-autorreferencia NO puede garantizarla la BD: MariaDB no admite AUTO_INCREMENT en un CHECK y la FK acepta una
  -- fila que se referencia a sí misma si se inserta con id explícito. Es una invariante de APLICACIÓN: el servicio solo
  -- inserta el origen ya existente, jamás hace UPDATE de documento_origen_id (lo exige una prueba de arquitectura) y
  -- verify-2026-10-fel-2a-modelo.sql la audita. Sin autorreferencia y con origen inmutable no hay ciclos posibles.
  CONSTRAINT ck_fel_doc_origen CHECK (tipo_documento = 'FACTURA' OR documento_origen_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (5) Intentos: un envío/consulta/anulación por fila, con la clave de solicitud y la huella del contenido. Se inserta
-- ENVIANDO antes de la llamada externa y se CIERRA una sola vez (ENVIANDO -> resultado). Sin secretos ni XML.
CREATE TABLE IF NOT EXISTS fel_intentos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  documento_id INT NOT NULL,
  tipo VARCHAR(12) NOT NULL,
  estado VARCHAR(14) NOT NULL DEFAULT 'ENVIANDO',
  clave_solicitud VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  codigo VARCHAR(60) NULL,
  mensaje VARCHAR(500) NULL,
  respuesta_redactada TEXT NULL,
  usuario_id INT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finalizado_en DATETIME(3) NULL,
  UNIQUE KEY uq_fel_int_solicitud (empresa_id, clave_solicitud),
  KEY idx_fel_int_doc (empresa_id, documento_id, id),
  CONSTRAINT fk_fel_int_doc FOREIGN KEY (empresa_id, documento_id) REFERENCES fel_documentos(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_int_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_int_tipo CHECK (tipo IN ('CERTIFICAR','CONSULTAR','ANULAR')),
  CONSTRAINT ck_fel_int_estado CHECK (estado IN ('ENVIANDO','CERTIFICADO','RECHAZADO','PENDIENTE','NO_ENCONTRADO','INCIERTO','ERROR_CONFIG','ANULADO')),
  CONSTRAINT ck_fel_int_cierre CHECK ((estado = 'ENVIANDO' AND finalizado_en IS NULL) OR (estado <> 'ENVIANDO' AND finalizado_en IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
