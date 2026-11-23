-- FONDOS DIARIOS (Fase 3): «Otros fondos del viaje» (hospedaje, combustible, mantenimiento, cuadrilla extra, peajes, parqueo, otros) registrados en Programación y sincronizados
-- a la MISMA solicitud diaria que los viáticos. REQUIERE la migración de la Fase 2 (sql/migrate-2026-11-fondos-diarios.sql). Aplicación MANUAL; NO la ejecuta la aplicación.
-- Aditiva e IDEMPOTENTE (CREATE TABLE / ADD … IF NOT EXISTS; la restricción se reemplaza de forma atómica). No borra ni modifica filas existentes.
-- El código funciona ANTES de aplicarla (los viáticos siguen sincronizándose; la sección «Otros fondos» queda oculta, detectada por sonda de columnas).
-- Reversión: sql/rollback-2026-12-fondos-otros.sql (se niega a borrar si existen otros fondos o líneas automáticas; ejecutar ANTES que el rollback de la Fase 2).

-- 1) Otros fondos por viaje. El beneficiario es SIEMPRE un empleado de RRHH de la empresa (piloto, auxiliar u otro). La cuenta/teléfono se sugiere desde RRHH y se puede corregir.
--    `pago_pendiente_sync` = el método de pago/cuenta cambió en Programación y debe reflejarse en la línea PENDIENTE de la solicitud (lo limpia la sincronización).
CREATE TABLE IF NOT EXISTS tms_plan_otros_fondos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  categoria VARCHAR(40) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  descripcion VARCHAR(300) NULL,
  empleado_id INT NOT NULL,
  metodo_pago VARCHAR(40) NULL,
  cuenta VARCHAR(100) NULL,
  pago_pendiente_sync TINYINT NOT NULL DEFAULT 0,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_planotro_empresa_id (empresa_id, id),
  KEY idx_planotro_plan (empresa_id, plan_id),
  CONSTRAINT fk_planotro_plan FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_planotro_empleado FOREIGN KEY (empresa_id, empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_planotro_monto CHECK (monto > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Línea de solicitud generada desde un otro fondo. SIN FK a propósito (igual que viatico_id): el historial de una solicitud autorizada no debe bloquear el retiro del otro fondo.
--    UNIQUE (empresa, solicitud, otro fondo): un mismo otro fondo no puede aparecer dos veces en la MISMA solicitud.
ALTER TABLE tms_solicitud_fondo_lineas ADD COLUMN IF NOT EXISTS otro_fondo_id INT NULL DEFAULT NULL;
ALTER TABLE tms_solicitud_fondo_lineas ADD UNIQUE INDEX IF NOT EXISTS uq_fondolin_otro (empresa_id, solicitud_id, otro_fondo_id);
ALTER TABLE tms_solicitud_fondo_lineas ADD INDEX IF NOT EXISTS idx_fondolin_otro (empresa_id, otro_fondo_id);
-- Restricción estricta (reemplazo atómico, idempotente): viático ↔ AUTO_VIATICO, otro fondo ↔ AUTO_OTRO, nunca ambos.
ALTER TABLE tms_solicitud_fondo_lineas
  DROP CONSTRAINT IF EXISTS ck_fondolin_origen,
  ADD CONSTRAINT ck_fondolin_origen CHECK (
    (origen IS NULL AND otro_fondo_id IS NULL)
    OR (origen = 'AUTO_VIATICO' AND viatico_id IS NOT NULL AND otro_fondo_id IS NULL)
    OR (origen = 'AUTO_OTRO' AND otro_fondo_id IS NOT NULL AND viatico_id IS NULL));

-- 3) Verificación (solo lectura): tabla 1, columna 1, índices únicos 2 (viático + otro fondo).
SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_otros_fondos') AS tablas_esperadas_1,
       (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME = 'otro_fondo_id') AS columnas_esperadas_1,
       (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('uq_fondolin_viatico', 'uq_fondolin_otro') AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1) AS indices_unicos_esperados_2;
