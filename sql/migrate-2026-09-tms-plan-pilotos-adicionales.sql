-- =====================================================================
-- MIGRACIÓN (MariaDB/InnoDB) — piloto EXTRA por viaje: tabla tms_plan_pilotos_adicionales
-- Archivo: sql/migrate-2026-09-tms-plan-pilotos-adicionales.sql
--
-- NO SE EJECUTA AUTOMÁTICAMENTE. Ejecutar manualmente (phpMyAdmin) DESPUÉS de revisar
-- sql/preflight-2026-09-tms-plan-pilotos-adicionales.sql y ANTES del merge/deploy de la app que la usa.
--
-- Diseño:
--   * tms_planes_viaje.piloto_id NO cambia: sigue siendo el piloto PRINCIPAL (históricos, portal, reportes, cierre).
--   * Esta tabla guarda SOLO los pilotos ADICIONALES (hoy la app permite como máximo 1 "piloto extra"; el esquema queda preparado
--     para más sin migrar de nuevo). Es la tabla hermana de tms_plan_auxiliares.
--   * UNIQUE (plan_id, personal_id): una persona no puede repetirse en el mismo viaje.
--   * Mismas convenciones que tms_viaticos: empresa_id + FK a empresas / tms_planes_viaje / tms_personal con ON DELETE CASCADE
--     (borrar un plan, p. ej. en la limpieza de operaciones, limpia sus pilotos extra automáticamente).
--   * Es una tabla NUEVA: no altera ni rellena nada existente; la app anterior la ignora, por eso se puede crear antes del deploy.
-- Idempotente (CREATE TABLE IF NOT EXISTS). NO hace: DROP, DELETE, UPDATE, ni cambios en tablas existentes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tms_plan_pilotos_adicionales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  personal_id INT NOT NULL,          -- tms_personal.id (tipo 'Piloto'), el mismo espacio de ids que tms_planes_viaje.piloto_id
  orden TINYINT NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tppa_plan_personal (plan_id, personal_id),
  INDEX idx_tppa_plan (plan_id),
  INDEX idx_tppa_personal (personal_id),
  INDEX idx_tppa_empresa_plan (empresa_id, plan_id),
  CONSTRAINT fk_tppa_empresa  FOREIGN KEY (empresa_id)  REFERENCES empresas(id)         ON DELETE CASCADE,
  CONSTRAINT fk_tppa_plan     FOREIGN KEY (plan_id)     REFERENCES tms_planes_viaje(id) ON DELETE CASCADE,
  CONSTRAINT fk_tppa_personal FOREIGN KEY (personal_id) REFERENCES tms_personal(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------ POSTCHECK ------------------------------
SHOW CREATE TABLE tms_plan_pilotos_adicionales;
SHOW INDEX FROM tms_plan_pilotos_adicionales;
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_pilotos_adicionales' AND REFERENCED_TABLE_NAME IS NOT NULL;
SELECT COUNT(*) AS filas_iniciales FROM tms_plan_pilotos_adicionales;  -- esperado: 0
