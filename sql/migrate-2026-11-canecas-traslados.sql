-- Solo instalar tras revisar el preflight y autorizar la instalación. DDL no es transaccional.
-- La ausencia de IF NOT EXISTS hace visible una instalación parcial o incompatible.
CREATE TABLE canecas_traslados (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  origen_id INT NOT NULL,
  destino_id INT NOT NULL,
  numero VARCHAR(64) NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  huella CHAR(64) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  entrega VARCHAR(200) NOT NULL,
  transporte VARCHAR(200) NOT NULL DEFAULT '',
  observaciones VARCHAR(1000) NOT NULL DEFAULT '',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_por INT NULL,
  enviado_en DATETIME NULL,
  UNIQUE KEY uq_can_tras_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_tras_numero (empresa_id,numero),
  UNIQUE KEY uq_can_tras_clave (empresa_id,clave_operacion),
  CONSTRAINT chk_can_tras_ubicaciones CHECK (origen_id<>destino_id),
  CONSTRAINT chk_can_tras_estado CHECK ((estado='BORRADOR' AND enviado_por IS NULL AND enviado_en IS NULL) OR (estado IN ('ENVIADO','RECIBIDO','CON_DIFERENCIAS') AND enviado_por IS NOT NULL AND enviado_en IS NOT NULL)),
  CONSTRAINT fk_can_tras_origen FOREIGN KEY (empresa_id,origen_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_tras_destino FOREIGN KEY (empresa_id,destino_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_tras_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_can_tras_emisor FOREIGN KEY (enviado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_traslado_partidas (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  traslado_id INT NOT NULL,
  producto_id INT NOT NULL,
  cantidad INT NOT NULL,
  recibido INT NOT NULL DEFAULT 0,
  faltante INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_can_tras_par_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_tras_par_tras_id (empresa_id,traslado_id,id),
  UNIQUE KEY uq_can_tras_par_producto (empresa_id,traslado_id,producto_id),
  CONSTRAINT chk_can_tras_par_cantidad CHECK (cantidad>0 AND recibido>=0 AND faltante>=0 AND recibido+faltante<=cantidad),
  CONSTRAINT fk_can_tras_par_tras FOREIGN KEY (empresa_id,traslado_id) REFERENCES canecas_traslados(empresa_id,id),
  CONSTRAINT fk_can_tras_par_prod FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_traslado_recepciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  traslado_id INT NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  huella CHAR(64) NOT NULL,
  recibe VARCHAR(200) NOT NULL,
  condicion VARCHAR(500) NOT NULL,
  observaciones VARCHAR(1000) NOT NULL DEFAULT '',
  usuario_id INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_tras_rec_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_tras_rec_tras_id (empresa_id,traslado_id,id),
  UNIQUE KEY uq_can_tras_rec_clave (empresa_id,clave_operacion),
  CONSTRAINT fk_can_tras_rec_tras FOREIGN KEY (empresa_id,traslado_id) REFERENCES canecas_traslados(empresa_id,id),
  CONSTRAINT fk_can_tras_rec_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_traslado_recepcion_partidas (
  empresa_id INT NOT NULL,
  traslado_id INT NOT NULL,
  recepcion_id INT NOT NULL,
  partida_id INT NOT NULL,
  recibido INT NOT NULL,
  faltante INT NOT NULL DEFAULT 0,
  motivo VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (empresa_id,recepcion_id,partida_id),
  CONSTRAINT chk_can_tras_rp_cantidad CHECK (recibido>=0 AND faltante>=0 AND recibido+faltante>0 AND (faltante=0 OR CHAR_LENGTH(TRIM(motivo))>0)),
  CONSTRAINT fk_can_tras_rp_recepcion FOREIGN KEY (empresa_id,traslado_id,recepcion_id) REFERENCES canecas_traslado_recepciones(empresa_id,traslado_id,id),
  CONSTRAINT fk_can_tras_rp_partida FOREIGN KEY (empresa_id,traslado_id,partida_id) REFERENCES canecas_traslado_partidas(empresa_id,traslado_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Versiones documentales append-only. La aplicación debe guardar los bytes del logo,
-- nunca solo una URL mutable; no debe aceptar rutas arbitrarias del cliente.
CREATE TABLE canecas_traslado_documentos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  traslado_id INT NOT NULL,
  version INT NOT NULL,
  datos JSON NOT NULL,
  logo LONGBLOB NULL,
  logo_tipo VARCHAR(40) NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_tras_doc_version (empresa_id,traslado_id,version),
  CONSTRAINT fk_can_tras_doc_tras FOREIGN KEY (empresa_id,traslado_id) REFERENCES canecas_traslados(empresa_id,id),
  CONSTRAINT fk_can_tras_doc_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER can_tras_doc_no_update BEFORE UPDATE ON canecas_traslado_documentos FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Documento historico inmutable'; END//
CREATE TRIGGER can_tras_doc_no_delete BEFORE DELETE ON canecas_traslado_documentos FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Documento historico inmutable'; END//
DELIMITER ;

