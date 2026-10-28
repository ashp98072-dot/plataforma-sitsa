-- PROPUESTA: solo ensayo aislado tras preflight. NO ejecución operativa autorizada.
-- MySQL 8.0.16+ / MariaDB 11.8. DDL no atómico: detenerse ante cualquier fallo.
-- Los nombres de CHECK proceden exactamente de C3C-1. DROP CONSTRAINT MariaDB
-- debe sustituirse por DROP CHECK en MySQL mediante el adaptador explícito del ensayo.
ALTER TABLE cont_periodos DROP CONSTRAINT ck_cp_estado;
ALTER TABLE cont_periodos ADD CONSTRAINT ck_cp_estado CHECK (estado IN ('CONFIGURADO','ABIERTO','CERRADO')),
  ADD COLUMN version INT NOT NULL DEFAULT 0,
  ADD COLUMN revision_cierre INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_cp_version CHECK (version>=0 AND revision_cierre>=0);

CREATE TABLE cont_control_libro (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL,
 estado VARCHAR(20) NOT NULL DEFAULT 'NO_ACTIVADO', version INT NOT NULL DEFAULT 0,
 cambios BIGINT NOT NULL DEFAULT 0, operadores_version INT NOT NULL DEFAULT 0,
 activado_en DATETIME NULL,
 PRIMARY KEY(empresa_id,entidad_id),
 FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id) ON DELETE RESTRICT,
 CHECK(estado IN ('NO_ACTIVADO','ACTIVO')), CHECK(version>=0 AND cambios>=0 AND operadores_version>=0),
 CHECK((estado='ACTIVO' AND activado_en IS NOT NULL) OR (estado='NO_ACTIVADO' AND activado_en IS NULL))
) ENGINE=InnoDB;
CREATE TABLE cont_periodos_operadores (
 empresa_id INT NOT NULL, entidad_id INT NOT NULL, usuario_id INT NOT NULL,
 capacidad VARCHAR(24) NOT NULL, activo TINYINT NOT NULL, otorgado_por INT NOT NULL,
 actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(empresa_id,entidad_id,usuario_id,capacidad),
 FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_control_libro(empresa_id,entidad_id) ON DELETE RESTRICT,
 FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 FOREIGN KEY(otorgado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(activo IN (0,1)), CHECK(usuario_id<>otorgado_por),
 CHECK(capacidad IN ('abrir','cerrar','reabrir_solicitar','reabrir_aprobar','diagnosticar','activar_solicitar','activar_aprobar','operadores'))
) ENGINE=InnoDB;
CREATE TABLE cont_control_diagnosticos (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL,
 actor_id INT NOT NULL, version_control INT NOT NULL, cambios BIGINT NOT NULL,
 operadores_version INT NOT NULL, reglas VARCHAR(40) NOT NULL,
 bloqueantes INT NOT NULL, advertencias INT NOT NULL, hallazgos MEDIUMTEXT NOT NULL,
 huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_diag_ambito(empresa_id,entidad_id,id),
 FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_control_libro(empresa_id,entidad_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(bloqueantes>=0 AND advertencias>=0), CHECK(JSON_VALID(hallazgos))
) ENGINE=InnoDB;
CREATE TABLE cont_periodos_solicitudes (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL,
 tipo VARCHAR(12) NOT NULL, periodo_id INT NULL, diagnostico_id INT NULL,
 solicitante_id INT NOT NULL, decisor_id INT NULL, motivo VARCHAR(1000) NOT NULL,
 motivo_resolucion VARCHAR(1000) NULL, acepta_historia TINYINT NOT NULL DEFAULT 0,
 estado VARCHAR(16) NOT NULL DEFAULT 'PENDIENTE', version INT NOT NULL DEFAULT 0,
 version_objeto INT NOT NULL, operadores_version INT NOT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, resuelto_en DATETIME NULL,
 UNIQUE KEY uq_sol_ambito(empresa_id,entidad_id,id), KEY ix_sol_estado(empresa_id,entidad_id,estado,id),
 FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_control_libro(empresa_id,entidad_id) ON DELETE RESTRICT,
 FOREIGN KEY(empresa_id,entidad_id,periodo_id) REFERENCES cont_periodos(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(empresa_id,entidad_id,diagnostico_id) REFERENCES cont_control_diagnosticos(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(solicitante_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 FOREIGN KEY(decisor_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(tipo IN ('ACTIVAR','REABRIR')), CHECK(estado IN ('PENDIENTE','EJECUTADA','RECHAZADA')),
 CHECK((tipo='ACTIVAR' AND diagnostico_id IS NOT NULL AND periodo_id IS NULL) OR (tipo='REABRIR' AND periodo_id IS NOT NULL AND diagnostico_id IS NULL)),
 CHECK(decisor_id IS NULL OR decisor_id<>solicitante_id), CHECK(acepta_historia IN(0,1)),
 CHECK(CHAR_LENGTH(TRIM(motivo)) BETWEEN 20 AND 1000),
 CHECK((estado='PENDIENTE' AND decisor_id IS NULL AND resuelto_en IS NULL AND motivo_resolucion IS NULL) OR
 (estado<>'PENDIENTE' AND decisor_id IS NOT NULL AND resuelto_en IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_resolucion)) BETWEEN 20 AND 1000))
) ENGINE=InnoDB;
CREATE TABLE cont_periodos_historial (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL,
 operacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, actor_id INT NOT NULL,
 accion VARCHAR(32) NOT NULL, motivo VARCHAR(1000) NOT NULL, detalle MEDIUMTEXT NOT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_periodos_operacion(empresa_id,entidad_id,operacion), KEY ix_hist_libro(empresa_id,entidad_id,id),
 FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_control_libro(empresa_id,entidad_id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(JSON_VALID(detalle)), CHECK(CHAR_LENGTH(TRIM(motivo)) BETWEEN 20 AND 1000)
) ENGINE=InnoDB;
CREATE TABLE cont_periodos_cierres (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL,
 periodo_id INT NOT NULL, revision INT NOT NULL, actor_id INT NOT NULL, motivo VARCHAR(1000) NOT NULL,
 huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 evidencia MEDIUMTEXT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cierre_revision(empresa_id,entidad_id,periodo_id,revision),
 FOREIGN KEY(empresa_id,entidad_id,periodo_id) REFERENCES cont_periodos(empresa_id,entidad_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(revision>0), CHECK(JSON_VALID(evidencia)), CHECK(CHAR_LENGTH(TRIM(motivo)) BETWEEN 20 AND 1000)
) ENGINE=InnoDB;
-- Sin INSERT de operadores, activaciones, apertura de períodos o UPDATE de asientos.
