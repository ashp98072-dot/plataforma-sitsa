-- Metadatos exclusivamente. Aplicaci?n manual despu?s de C3C-11.
CREATE TABLE IF NOT EXISTS cont_regularizacion_evidencias (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, ejercicio_id INT NOT NULL, solicitud_id BIGINT NOT NULL,
 codigo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, version INT NOT NULL,
 metadatos_json LONGTEXT NOT NULL, huella_metadatos CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_base CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,ejercicio_id,solicitud_id,codigo,version),
 UNIQUE KEY uq_c12_clave(empresa_id,entidad_id,clave_idempotencia),
 FOREIGN KEY(empresa_id,entidad_id,ejercicio_id,solicitud_id) REFERENCES cont_regularizacion_solicitudes(empresa_id,entidad_id,ejercicio_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(version>0 AND JSON_VALID(metadatos_json) AND huella_metadatos REGEXP '^[0-9a-f]{64}$' AND huella_base REGEXP '^[0-9a-f]{64}$' AND huella_solicitud REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS c12_evidencia_no_update BEFORE UPDATE ON cont_regularizacion_evidencias FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidencia versionada inmutable';
CREATE TRIGGER IF NOT EXISTS c12_evidencia_no_delete BEFORE DELETE ON cont_regularizacion_evidencias FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Evidencia versionada inmutable';
