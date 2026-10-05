-- PROPUESTA: NO ejecutada. MariaDB 11.8.9. Seleccionar explícitamente la BD de destino en phpMyAdmin.
-- Contexto: tms_cotizacion_costeos.motor_version es VARCHAR(20), pero el motor del PR #407 se llama «COSTEO_COTIZADOR_2026» (21 caracteres).
-- Con sql_mode estricto el INSERT de un costeo con ese motor falla («Data too long for column»); sin modo estricto se guarda truncado como «COSTEO_COTIZADOR_202».
-- El motor nuevo COSTEO_COTIZ_2026_V2 (20 caracteres) SÍ cabe y NO depende de esta propuesta. Esta propuesta solo diagnostica y, si se aprueba, corrige lo anterior.
-- La UI no depende de la columna: toma el motor de resultado_snapshot.motorVersion.

-- 1) DIAGNÓSTICO (solo lectura)
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor, @@sql_mode AS sql_mode;
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'motor_version';
-- Valores de motor_version guardados. Si aparece «COSTEO_COTIZADOR_202» hay filas truncadas; si no aparece ni «COSTEO_COTIZADOR_2026», no se guardó ningún costeo con ese motor.
SELECT motor_version, COUNT(*) AS costeos FROM tms_cotizacion_costeos GROUP BY motor_version ORDER BY motor_version;

-- 2) PROPUESTA (revisar el diagnóstico antes; ampliar la columna no pierde datos ni cambia importes ni snapshots)
ALTER TABLE tms_cotizacion_costeos MODIFY COLUMN motor_version VARCHAR(40) NOT NULL;

-- 3) REPARACIÓN OPCIONAL de filas truncadas (solo si el diagnóstico las muestra; el valor correcto está en resultado_snapshot). Comentada a propósito:
-- UPDATE tms_cotizacion_costeos SET motor_version = 'COSTEO_COTIZADOR_2026' WHERE motor_version = 'COSTEO_COTIZADOR_202';
