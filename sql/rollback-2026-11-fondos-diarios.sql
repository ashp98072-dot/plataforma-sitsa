-- REVERSIÓN de sql/migrate-2026-11-fondos-diarios.sql. Aplicación MANUAL. Idempotente (DROP … IF EXISTS).
--
-- SEGURA POR DEFECTO: si ya existen solicitudes diarias/complementarias, líneas automáticas o viajes con empresa requirente, este script NO borra NADA
-- (solo informa las cuentas). Al quitar `origen` las líneas automáticas pasarían a ser líneas manuales sin protección y se perdería su viático de origen;
-- al quitar `entidad_requirente_id` se pierde la empresa requirente elegida en cada viaje. Para revertir con datos existentes hay que decidirlo de forma EXPLÍCITA:
--   SET @CONFIRMAR_PERDIDA_DE_DATOS = 'SI';   -- en la misma sesión, antes de ejecutar este script, y SOLO tras respaldar las tres tablas.
-- Sin datos de la integración (cuentas en 0) revierte directamente.
-- Orden recomendado: 1) desplegar el código anterior (revert del merge en main)  2) ejecutar este script  3) revisar el resultado final (columnas_que_quedan = 0).

SET @col_ya_migrada = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME = 'origen')
                    + (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_solicitudes_fondo' AND COLUMN_NAME = 'origen')
                    + (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje' AND COLUMN_NAME = 'entidad_requirente_id');
SET @sql_cuentas = IF(@col_ya_migrada < 3, 'SELECT 0 INTO @datos_integracion',
  'SELECT (SELECT COUNT(*) FROM tms_planes_viaje WHERE entidad_requirente_id IS NOT NULL) + (SELECT COUNT(*) FROM tms_solicitudes_fondo WHERE origen = ''DIARIA'' OR tipo = ''COMPLEMENTARIA'') + (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas WHERE origen IS NOT NULL) INTO @datos_integracion');
PREPARE p_cuentas FROM @sql_cuentas; EXECUTE p_cuentas; DEALLOCATE PREPARE p_cuentas;

SET @rollback_bloqueado = IF(@datos_integracion > 0 AND COALESCE(@CONFIRMAR_PERDIDA_DE_DATOS, '') <> 'SI', 1, 0);
SELECT @datos_integracion AS registros_de_la_integracion,
       IF(@rollback_bloqueado = 1, 'BLOQUEADO: existen datos de la integración; no se borró nada (ver encabezado)', 'PROCEDE') AS estado_rollback;

SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'CREATE INDEX IF NOT EXISTS idx_fondolin_solicitud_rb ON tms_solicitud_fondo_lineas (empresa_id, solicitud_id)');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP CONSTRAINT IF EXISTS ck_fondolin_origen');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX IF EXISTS uq_fondolin_viatico');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX IF EXISTS idx_fondolin_viatico');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP COLUMN IF EXISTS viatico_id, DROP COLUMN IF EXISTS origen');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitudes_fondo DROP CONSTRAINT IF EXISTS ck_fondo_diaria');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitudes_fondo DROP FOREIGN KEY IF EXISTS fk_fondo_principal');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitudes_fondo DROP INDEX IF EXISTS uq_fondo_clave_diaria');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitudes_fondo DROP INDEX IF EXISTS idx_fondo_principal');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitudes_fondo DROP COLUMN IF EXISTS clave_diaria, DROP COLUMN IF EXISTS solicitud_principal_id, DROP COLUMN IF EXISTS tipo, DROP COLUMN IF EXISTS origen');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_planes_viaje DROP FOREIGN KEY IF EXISTS fk_tmsplan_entidad_requirente');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_planes_viaje DROP INDEX IF EXISTS idx_tmsplan_req_dia');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_planes_viaje DROP COLUMN IF EXISTS entidad_requirente_id');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;

-- Verificación (solo lectura): 0 = revertido por completo; >0 = bloqueado por datos existentes o ya parcialmente revertido.
SELECT COUNT(*) AS columnas_que_quedan FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (
  (TABLE_NAME = 'tms_planes_viaje' AND COLUMN_NAME = 'entidad_requirente_id')
  OR (TABLE_NAME = 'tms_solicitudes_fondo' AND COLUMN_NAME IN ('origen', 'tipo', 'solicitud_principal_id', 'clave_diaria'))
  OR (TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME IN ('origen', 'viatico_id')));
