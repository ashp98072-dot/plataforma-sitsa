-- MIGRACIÓN — ATRACCION-TALENTO-2 (entrevistador/auxiliar por usuario)
-- Ejecutar primero sql/preflight-atraccion-entrevistadores-usuarios.sql.
-- Idempotente (seguro para re-ejecutar en phpMyAdmin: si algo ya existe se
-- omite sin romper el resto — mismo patrón que
-- sql/migrate-2026-08-rrhh-supervisor.sql), MariaDB-compatible, sin
-- DELETE/UPDATE, sin backfill (no se intenta adivinar qué usuario
-- corresponde a cada empleado histórico — eso podría asociar personas
-- incorrectas). NO se ejecuta automáticamente.
--
-- entrevistador_empleado_id NO se toca ni se elimina: se conserva para las
-- entrevistas históricas (ver regla de compatibilidad/precedencia en
-- src/lib/rrhh/entrevistas.ts — precedencia: usuario > empleado histórico).
SET NAMES utf8mb4;
SET @db := DATABASE();

-- entrevistas.entrevistador_usuario_id (solo si falta)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND COLUMN_NAME = 'entrevistador_usuario_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE entrevistas ADD COLUMN entrevistador_usuario_id INT NULL AFTER entrevistador_empleado_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- entrevistas.auxiliar_usuario_id (solo si falta)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND COLUMN_NAME = 'auxiliar_usuario_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE entrevistas ADD COLUMN auxiliar_usuario_id INT NULL AFTER entrevistador_usuario_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice para el catálogo "por entrevistador" en reportes (solo si falta)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND INDEX_NAME = 'idx_entrev_entrevistador_usuario'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE entrevistas ADD INDEX idx_entrev_entrevistador_usuario (empresa_id, entrevistador_usuario_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice equivalente para auxiliar (solo si falta)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND INDEX_NAME = 'idx_entrev_auxiliar_usuario'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE entrevistas ADD INDEX idx_entrev_auxiliar_usuario (empresa_id, auxiliar_usuario_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK entrevistador_usuario_id -> usuarios(id): si se elimina el usuario, la
-- entrevista histórica NO desaparece, solo queda sin entrevistador asignado.
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND CONSTRAINT_NAME = 'fk_entrev_entrevistador_usuario'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE entrevistas ADD CONSTRAINT fk_entrev_entrevistador_usuario
     FOREIGN KEY (entrevistador_usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK auxiliar_usuario_id -> usuarios(id): mismo criterio (ON DELETE SET NULL).
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND CONSTRAINT_NAME = 'fk_entrev_auxiliar_usuario'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE entrevistas ADD CONSTRAINT fk_entrev_auxiliar_usuario
     FOREIGN KEY (auxiliar_usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
