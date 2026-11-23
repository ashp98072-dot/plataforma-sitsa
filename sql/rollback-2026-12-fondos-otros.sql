-- REVERSIÓN de sql/migrate-2026-12-fondos-otros.sql (Fase 3). Aplicación MANUAL. Idempotente. Ejecutar ANTES que sql/rollback-2026-11-fondos-diarios.sql (Fase 2).
--
-- SEGURA POR DEFECTO: si ya existen «otros fondos» registrados en viajes o líneas de solicitud generadas desde ellos (origen AUTO_OTRO), NO borra NADA (solo informa).
-- Al quitar `otro_fondo_id` esas líneas perderían su vínculo con el viaje de origen y al borrar la tabla se pierden los otros fondos capturados.
-- Para revertir con datos existentes hay que decidirlo de forma EXPLÍCITA (en la misma sesión, tras respaldar tms_plan_otros_fondos y tms_solicitud_fondo_lineas):
--   SET @CONFIRMAR_PERDIDA_DE_DATOS = 'SI';
-- Con confirmación, las líneas AUTO_OTRO pasan a ser líneas manuales (origen NULL) para no dejar líneas automáticas huérfanas.

SET @tabla_otros = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_otros_fondos');
SET @col_otro = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME = 'otro_fondo_id');
SET @sql_cuentas = CONCAT('SELECT ', IF(@tabla_otros = 1, '(SELECT COUNT(*) FROM tms_plan_otros_fondos)', '0'), ' + ', IF(@col_otro = 1, '(SELECT COUNT(*) FROM tms_solicitud_fondo_lineas WHERE origen = ''AUTO_OTRO'' OR otro_fondo_id IS NOT NULL)', '0'), ' INTO @datos_otros');
PREPARE p_cuentas FROM @sql_cuentas; EXECUTE p_cuentas; DEALLOCATE PREPARE p_cuentas;

SET @rollback_bloqueado = IF(@datos_otros > 0 AND COALESCE(@CONFIRMAR_PERDIDA_DE_DATOS, '') <> 'SI', 1, 0);
SELECT @datos_otros AS registros_de_otros_fondos,
       IF(@rollback_bloqueado = 1, 'BLOQUEADO: existen otros fondos o líneas generadas desde ellos; no se borró nada (ver encabezado)', 'PROCEDE') AS estado_rollback;

-- Líneas AUTO_OTRO → manuales (solo con confirmación explícita y si la columna existe).
SET @rb = IF(@rollback_bloqueado = 1 OR @col_otro = 0, 'DO 0', 'UPDATE tms_solicitud_fondo_lineas SET origen = NULL, otro_fondo_id = NULL WHERE origen = ''AUTO_OTRO''');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP CONSTRAINT IF EXISTS ck_fondolin_origen, ADD CONSTRAINT ck_fondolin_origen CHECK (origen IS NULL OR (origen = ''AUTO_VIATICO'' AND viatico_id IS NOT NULL))');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX IF EXISTS uq_fondolin_otro');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX IF EXISTS idx_fondolin_otro');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'ALTER TABLE tms_solicitud_fondo_lineas DROP COLUMN IF EXISTS otro_fondo_id');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;
SET @rb = IF(@rollback_bloqueado = 1, 'DO 0', 'DROP TABLE IF EXISTS tms_plan_otros_fondos');
PREPARE p_rb FROM @rb; EXECUTE p_rb; DEALLOCATE PREPARE p_rb;

-- Verificación (solo lectura): 0 = revertido por completo; >0 = bloqueado por datos existentes o ya parcialmente revertido.
SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_otros_fondos')
     + (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME = 'otro_fondo_id') AS elementos_que_quedan;
