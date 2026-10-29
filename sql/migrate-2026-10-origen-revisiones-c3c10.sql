-- MariaDB 11.8.9. Solo aplicación manual autorizada; depende de C3C-9.
-- Sin cambios de movimientos, permisos, declaraciones raíz ni backfill.
CREATE TABLE IF NOT EXISTS cont_asientos_origen_revisiones (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, asiento_id INT NOT NULL, ejercicio_id INT NOT NULL,
 version INT NOT NULL, tipo VARCHAR(32) NOT NULL, clase_anterior VARCHAR(20) NOT NULL, clase VARCHAR(20) NOT NULL,
 referencia VARCHAR(120) NOT NULL, justificacion VARCHAR(1000) NOT NULL,
 huella_anterior CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_asiento CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 clave_idempotencia CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 registrado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,asiento_id,version),
 UNIQUE KEY uq_c10_clave(empresa_id,entidad_id,clave_idempotencia),
 CONSTRAINT fk_c10_origen FOREIGN KEY(empresa_id,entidad_id,asiento_id) REFERENCES cont_asientos_origen(empresa_id,entidad_id,asiento_id) ON DELETE RESTRICT,
 CONSTRAINT fk_c10_ejercicio FOREIGN KEY(empresa_id,entidad_id,ejercicio_id) REFERENCES cont_ejercicios(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_c10_usuario FOREIGN KEY(registrado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CONSTRAINT ck_c10_revision CHECK(version>0 AND clase IN ('NORMAL','REGULARIZACION') AND clase_anterior IN ('NORMAL','REGULARIZACION') AND
 ((tipo='REVISION_DOCUMENTAL' AND clase=clase_anterior) OR (tipo='RECTIFICACION_DOCUMENTAL' AND clase<>clase_anterior)) AND
 CHAR_LENGTH(TRIM(referencia))>=5 AND CHAR_LENGTH(TRIM(justificacion))>=10 AND huella_anterior REGEXP '^[0-9a-f]{64}$' AND huella_asiento REGEXP '^[0-9a-f]{64}$' AND huella_solicitud REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS c10_historial_no_update BEFORE UPDATE ON cont_asientos_origen_revisiones FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Historial documental inmutable';
CREATE TRIGGER IF NOT EXISTS c10_historial_no_delete BEFORE DELETE ON cont_asientos_origen_revisiones FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Historial documental inmutable';
