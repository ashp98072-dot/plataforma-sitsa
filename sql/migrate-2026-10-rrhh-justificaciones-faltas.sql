-- RRHH — Justificación de faltas desde Reportes de asistencia (capa sobre la ausencia real).
--
-- ADITIVA y no destructiva: solo CREATE TABLE IF NOT EXISTS (segura de repetir). No altera ni reinterpreta sesiones_trabajo,
-- incidencias, rrhh_asistencia_ausencias, vacaciones ni ninguna tabla de planilla. No inserta datos.
-- NO ejecutada por este PR. Correr antes: preflight-2026-10-rrhh-justificaciones-faltas.sql; después: verify-...
--
-- Una fila por empresa + empleado + fecha. La ausencia SIGUE siendo una ausencia: esta tabla solo registra que RRHH la justificó
-- (tipo del catálogo de incidencias, observación, quién y cuándo) y, si se revierte, quién/cuándo/por qué. Nunca se borra:
-- ACTIVA / REVERTIDA. La evidencia opcional reutiliza `documentos_empleados` (sin columnas nuevas allí).
--
-- Política de FKs (igual que rrhh_asistencia_ausencias): empresa y empleado CASCADE. Actores como VARCHAR(100) (username), igual
-- que sus tablas hermanas.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_asistencia_justificaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  fecha DATE NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  observacion VARCHAR(500) NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'ACTIVA',
  version INT NOT NULL DEFAULT 1,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por VARCHAR(100) NULL,
  actualizado_en DATETIME NULL,
  revertido_por VARCHAR(100) NULL,
  revertido_en DATETIME NULL,
  motivo_reversion VARCHAR(300) NULL,
  UNIQUE KEY uq_asist_just (empresa_id, empleado_id, fecha),
  INDEX idx_asist_just_fecha (empresa_id, fecha, estado),
  INDEX idx_asist_just_empleado (empleado_id),
  CONSTRAINT fk_asist_just_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_asist_just_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT ck_asist_just_estado CHECK (estado IN ('ACTIVA', 'REVERTIDA')),
  CONSTRAINT ck_asist_just_version CHECK (version >= 1),
  CONSTRAINT ck_asist_just_tipo CHECK (CHAR_LENGTH(TRIM(tipo)) >= 2),
  -- ACTIVA no conserva marcas de reversión; REVERTIDA exige quién, cuándo y motivo.
  CONSTRAINT ck_asist_just_reversion CHECK (
    (estado = 'ACTIVA' AND revertido_por IS NULL AND revertido_en IS NULL AND motivo_reversion IS NULL)
    OR (estado = 'REVERTIDA' AND revertido_por IS NOT NULL AND revertido_en IS NOT NULL AND motivo_reversion IS NOT NULL
        AND CHAR_LENGTH(TRIM(motivo_reversion)) >= 5)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
