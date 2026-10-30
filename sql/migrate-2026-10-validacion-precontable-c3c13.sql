-- MariaDB 11.8.9. Aplicación manual posterior a C3C-12. Sin cambios contables.
CREATE TABLE IF NOT EXISTS cont_regularizacion_evaluaciones (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, ejercicio_id INT NOT NULL, solicitud_id BIGINT NOT NULL,
 version INT NOT NULL, registro_json LONGTEXT NOT NULL,
 huella_registro CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_integral CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,ejercicio_id,solicitud_id,version),
 UNIQUE KEY uq_c13_clave(empresa_id,entidad_id,clave_idempotencia),
 CONSTRAINT fk_c13_solicitud FOREIGN KEY(empresa_id,entidad_id,ejercicio_id,solicitud_id) REFERENCES cont_regularizacion_solicitudes(empresa_id,entidad_id,ejercicio_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c13_usuario FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c13_identidad CHECK(COALESCE(JSON_EXTRACT(registro_json,'$.empresaId')=empresa_id,0) AND COALESCE(JSON_EXTRACT(registro_json,'$.entidadId')=entidad_id,0) AND COALESCE(JSON_EXTRACT(registro_json,'$.ejercicioId')=ejercicio_id,0) AND COALESCE(JSON_EXTRACT(registro_json,'$.version')=version,0) AND COALESCE(JSON_EXTRACT(registro_json,'$.actorId')=creado_por,0)),
 CONSTRAINT ck_c13_evaluacion CHECK(version>0 AND JSON_VALID(registro_json) AND huella_registro REGEXP '^[0-9a-f]{64}$' AND huella_integral REGEXP '^[0-9a-f]{64}$' AND huella_solicitud REGEXP '^[0-9a-f]{64}$' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(registro_json,'$.contrato')),'')='C3C13-CONSTANCIA-1' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(registro_json,'$.informe.estadoFormal')),'')='PENDIENTE' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(registro_json,'$.informe.contabilizado')),'')='false' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(registro_json,'$.informe.aprobacionFormalHabilitada')),'')='false')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS c13_evaluacion_no_update BEFORE UPDATE ON cont_regularizacion_evaluaciones FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Constancia precontable inmutable';
CREATE TRIGGER IF NOT EXISTS c13_evaluacion_no_delete BEFORE DELETE ON cont_regularizacion_evaluaciones FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Constancia precontable inmutable';
