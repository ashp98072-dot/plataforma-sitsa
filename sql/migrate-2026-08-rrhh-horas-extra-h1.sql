-- RRHH H1 — Elegibilidad + aprobación de horas extra
--
-- Aditivo, no destructivo. No borra ni reinterpreta ningún dato existente.
--
-- empleados.horas_extra_habilitado:
--   Elegibilidad INDIVIDUAL para pago de horas extra. Default 0 (NO
--   elegible) — coincide con la realidad de que hoy solo pocos
--   colaboradores tienen autorizado el pago de horas extra. Como la
--   columna se agrega con DEFAULT 0 (no NULL), todos los empleados
--   existentes quedan automáticamente NO elegibles hasta que RRHH los
--   habilite uno por uno — nunca se deriva de puesto/categoria_ops/rol.
--
-- horas_extra_registros.estado:
--   Se agrega SIN DEFAULT (NULL) a propósito — los registros históricos
--   (ya escritos bajo el modelo anterior, que además ya insertaron su
--   propia fila en rrhh_prestaciones) quedan con estado = NULL, distinto
--   de 'PENDIENTE'. NO se reinterpretan automáticamente como PENDIENTE
--   (no deben volver a cobrarse) ni se marcan automáticamente como
--   APLICADA_EN_PLANILLA (no hay forma segura de confirmar, solo con los
--   datos de horas_extra_registros/rrhh_prestaciones, cuáles de esas filas
--   llegaron efectivamente a pagarse en una planilla real generada — no
--   existe vínculo a periodo en el modelo anterior). Los registros NUEVOS
--   (creados por la aplicación después de H1) siempre insertan
--   estado = 'PENDIENTE' explícitamente.
--
-- horas_extra_registros.autorizado_por / autorizado_en / motivo_rechazo:
--   Trazabilidad de la aprobación/rechazo administrativa (RRHH).
--
-- horas_extra_registros.planilla_periodo_id:
--   Reservado para H2 (aplicación en planilla) — ninguna escritura lo usa
--   todavía. Mismo patrón que rrhh_descuento_cuotas.planilla_periodo_id
--   en D1/D2.

SET NAMES utf8mb4;
SET @db := DATABASE();

-- =========================================================
-- empleados.horas_extra_habilitado
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND COLUMN_NAME = 'horas_extra_habilitado'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE empleados ADD COLUMN horas_extra_habilitado TINYINT(1) NOT NULL DEFAULT 0 AFTER estado',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- horas_extra_registros.estado
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND COLUMN_NAME = 'estado'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE horas_extra_registros ADD COLUMN estado VARCHAR(30) NULL AFTER prestacion_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- horas_extra_registros.autorizado_por
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND COLUMN_NAME = 'autorizado_por'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE horas_extra_registros ADD COLUMN autorizado_por VARCHAR(100) NULL AFTER estado',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- horas_extra_registros.autorizado_en
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND COLUMN_NAME = 'autorizado_en'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE horas_extra_registros ADD COLUMN autorizado_en DATETIME NULL AFTER autorizado_por',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- horas_extra_registros.motivo_rechazo
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND COLUMN_NAME = 'motivo_rechazo'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE horas_extra_registros ADD COLUMN motivo_rechazo VARCHAR(300) NULL AFTER autorizado_en',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- horas_extra_registros.planilla_periodo_id (reservado para H2)
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND COLUMN_NAME = 'planilla_periodo_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE horas_extra_registros ADD COLUMN planilla_periodo_id INT NULL AFTER motivo_rechazo',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice de estado (filtros de la bandeja RRHH)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND INDEX_NAME = 'idx_horext_estado'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE horas_extra_registros ADD INDEX idx_horext_estado (empresa_id, estado)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK planilla_periodo_id -> rrhh_planilla_periodos (ON DELETE SET NULL,
-- reservado para H2; solo se agrega si rrhh_planilla_periodos ya existe)
SET @tbl := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
);
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND CONSTRAINT_NAME = 'fk_horext_periodo'
);
SET @sql := IF(@tbl > 0 AND @fk = 0,
  'ALTER TABLE horas_extra_registros ADD CONSTRAINT fk_horext_periodo
     FOREIGN KEY (planilla_periodo_id) REFERENCES rrhh_planilla_periodos(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
