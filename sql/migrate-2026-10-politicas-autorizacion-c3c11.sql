-- MariaDB 11.8.9. Aplicación manual autorizada después de C3C-9/C3C-10.
-- Solo metadatos técnicos: ningún estado aprobado o contabilizado; no concede permisos.
CREATE TABLE IF NOT EXISTS cont_regularizacion_politicas (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, ejercicio_id INT NOT NULL,
 codigo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, version INT NOT NULL,
 estado VARCHAR(32) NOT NULL DEFAULT 'PROPUESTA_NO_APROBADA',
 contrato_json LONGTEXT NOT NULL, huella_politica CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_condiciones CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 preparador_id INT NOT NULL, revisor_id INT NOT NULL, resolutor_id INT NOT NULL,
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,ejercicio_id,codigo,version),
 UNIQUE KEY uq_c11_politica_clave(empresa_id,entidad_id,clave_idempotencia),
 CONSTRAINT fk_c11_politica_ejercicio FOREIGN KEY(empresa_id,entidad_id,ejercicio_id) REFERENCES cont_ejercicios(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c11_politica_preparador FOREIGN KEY(preparador_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT fk_c11_politica_revisor FOREIGN KEY(revisor_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT fk_c11_politica_resolutor FOREIGN KEY(resolutor_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c11_politica CHECK(version>0 AND estado='PROPUESTA_NO_APROBADA' AND creado_por=preparador_id AND preparador_id<>revisor_id AND preparador_id<>resolutor_id AND revisor_id<>resolutor_id AND JSON_VALID(contrato_json) AND huella_politica REGEXP '^[0-9a-f]{64}$' AND huella_condiciones REGEXP '^[0-9a-f]{64}$' AND huella_solicitud REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS cont_regularizacion_solicitudes (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, ejercicio_id INT NOT NULL,
 politica_codigo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, politica_version INT NOT NULL,
 borrador_version INT NOT NULL, huella_condiciones CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 justificacion VARCHAR(1000) NOT NULL, diagnostico_json LONGTEXT NOT NULL,
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_c11_solicitud_ambito(empresa_id,entidad_id,ejercicio_id,id),
 UNIQUE KEY uq_c11_solicitud_clave(empresa_id,entidad_id,clave_idempotencia),
 UNIQUE KEY uq_c11_solicitud_fuente(empresa_id,entidad_id,ejercicio_id,borrador_version),
 CONSTRAINT fk_c11_solicitud_politica FOREIGN KEY(empresa_id,entidad_id,ejercicio_id,politica_codigo,politica_version) REFERENCES cont_regularizacion_politicas(empresa_id,entidad_id,ejercicio_id,codigo,version) ON DELETE RESTRICT,
 CONSTRAINT fk_c11_solicitud_borrador FOREIGN KEY(empresa_id,entidad_id,ejercicio_id,borrador_version) REFERENCES cont_regularizacion_borradores(empresa_id,entidad_id,ejercicio_id,version) ON DELETE RESTRICT,
 CONSTRAINT fk_c11_solicitud_usuario FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c11_solicitud CHECK(JSON_VALID(diagnostico_json) AND CHAR_LENGTH(TRIM(justificacion))>=10 AND huella_condiciones REGEXP '^[0-9a-f]{64}$' AND huella_solicitud REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS cont_regularizacion_decisiones (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, ejercicio_id INT NOT NULL, solicitud_id BIGINT NOT NULL, version INT NOT NULL,
 accion VARCHAR(32) NOT NULL, estado_anterior VARCHAR(40) NOT NULL, justificacion VARCHAR(1000) NOT NULL,
 huella_observada CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,ejercicio_id,solicitud_id,version),
 UNIQUE KEY uq_c11_decision_clave(empresa_id,entidad_id,clave_idempotencia),
 CONSTRAINT fk_c11_decision_solicitud FOREIGN KEY(empresa_id,entidad_id,ejercicio_id,solicitud_id) REFERENCES cont_regularizacion_solicitudes(empresa_id,entidad_id,ejercicio_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c11_decision_usuario FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c11_decision CHECK(version>0 AND accion IN ('REVISION_TECNICA','DEVOLVER','RECHAZAR','DEJAR_PENDIENTE','INVALIDAR') AND estado_anterior IN ('PREPARADA','REVISION_TECNICA_REGISTRADA','PENDIENTE_AUTORIZACION_FORMAL') AND CHAR_LENGTH(TRIM(justificacion))>=10 AND huella_observada REGEXP '^[0-9a-f]{64}$' AND huella_solicitud REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS c11_politica_no_update BEFORE UPDATE ON cont_regularizacion_politicas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Politica versionada inmutable';
CREATE TRIGGER IF NOT EXISTS c11_politica_no_delete BEFORE DELETE ON cont_regularizacion_politicas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Politica versionada inmutable';
CREATE TRIGGER IF NOT EXISTS c11_solicitud_no_update BEFORE UPDATE ON cont_regularizacion_solicitudes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Solicitud tecnica inmutable';
CREATE TRIGGER IF NOT EXISTS c11_solicitud_no_delete BEFORE DELETE ON cont_regularizacion_solicitudes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Solicitud tecnica inmutable';
CREATE TRIGGER IF NOT EXISTS c11_decision_no_update BEFORE UPDATE ON cont_regularizacion_decisiones FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Decision tecnica inmutable';
CREATE TRIGGER IF NOT EXISTS c11_decision_no_delete BEFORE DELETE ON cont_regularizacion_decisiones FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Decision tecnica inmutable';
