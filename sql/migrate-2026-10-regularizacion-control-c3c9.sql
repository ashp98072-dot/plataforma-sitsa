-- Propuesta MariaDB 11.8.9. Aplicación MANUAL autorizada tras preflight. Sin backfill.
-- No crea permisos, no cambia asientos ni convierte datos históricos en procedencia verificada.
CREATE TABLE IF NOT EXISTS cont_asientos_origen (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, asiento_id INT NOT NULL, ejercicio_id INT NOT NULL,
 clase VARCHAR(20) NOT NULL, fuente VARCHAR(32) NOT NULL, referencia VARCHAR(120) NOT NULL,
 huella_asiento CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 registrado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,asiento_id),
 UNIQUE KEY uq_c9_origen_referencia(empresa_id,entidad_id,fuente,referencia),
 CONSTRAINT fk_c9_origen_asiento FOREIGN KEY(empresa_id,entidad_id,asiento_id) REFERENCES cont_asientos(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c9_origen_ejercicio FOREIGN KEY(empresa_id,entidad_id,ejercicio_id) REFERENCES cont_ejercicios(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c9_origen_usuario FOREIGN KEY(registrado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c9_origen CHECK(clase IN ('REGULARIZACION','NORMAL') AND fuente IN ('EMISION_CONTROLADA','REVISION_DOCUMENTADA') AND CHAR_LENGTH(TRIM(referencia))>0 AND huella_asiento REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS cont_regularizacion_borradores (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, ejercicio_id INT NOT NULL,
 version INT NOT NULL, estado VARCHAR(16) NOT NULL DEFAULT 'BORRADOR',
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_condiciones CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 politica_json LONGTEXT NOT NULL, nota VARCHAR(500) NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_c9_borrador_version(empresa_id,entidad_id,ejercicio_id,version),
 UNIQUE KEY uq_c9_borrador_clave(empresa_id,entidad_id,clave_idempotencia),
 CONSTRAINT fk_c9_borrador_ejercicio FOREIGN KEY(empresa_id,entidad_id,ejercicio_id) REFERENCES cont_ejercicios(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c9_borrador_usuario FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c9_borrador CHECK(version>0 AND estado='BORRADOR' AND JSON_VALID(politica_json) AND huella_solicitud REGEXP '^[0-9a-f]{64}$' AND huella_condiciones REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
