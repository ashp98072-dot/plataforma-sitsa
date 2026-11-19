-- =====================================================================
-- PROPUESTA PARA REVISIÓN — NO EJECUTADA EN NINGÚN ENTORNO REAL.
-- Migración NUEVA y SEPARADA: corrige el falso positivo de las guardas de fusión sin tocar sql/migrate-2026-11-flota-fusiones.sql.
--
-- Problema: sql/migrate-2026-11-flota-fusiones.sql instala triggers BEFORE INSERT/UPDATE `ffi_*`/`ffu_*` en toda columna que cumpla
--   /(^|_)vehiculo(_.*)?_id$/. Eso alcanza a columnas que NO son un vehículo y tienen clave foránea a OTRA tabla; el caso conocido es
--   tms_planes_viaje.vehiculo_solicitado_perfil_id (FK a tms_cotizacion_costeo_perfiles: un perfil de costeo). La guarda busca ese número
--   entre los vehículos fusionados y, si coincide con el ID de uno, el INSERT/UPDATE del plan falla con «Seleccione la unidad principal: ID fusionado».
--
-- Qué hace: elimina SOLO las guardas (ffi_/ffu_) de columnas que
--   (a) coinciden con la regex por nombre,
--   (b) tienen clave foránea a una tabla distinta de flota_vehiculos, y
--   (c) NO tienen clave foránea a flota_vehiculos(id), y no son `vehiculo_id` ni `unidad_recurrente_id`.
--   No toca ninguna otra guarda, ni los triggers de flota_vehiculos_fusiones / flota_vehiculos, ni ningún dato.
--
-- REVERSIBLE: antes de eliminar cada trigger guarda su definición exacta (information_schema.TRIGGERS) en la tabla
--   flota_fusion_guardas_v2_respaldo. sql/rollback-2026-11-flota-fusiones-guardas-v2.sql los recrea desde ahí y elimina esa tabla.
--
-- IDEMPOTENTE: reejecutarla no falla ni duplica respaldos (UNIQUE por nombre de trigger; DROP TRIGGER IF EXISTS).
--
-- Orden: 1) sql/preflight-2026-11-flota-fusiones-guardas-v2.sql  2) ESTA migración  3) sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql.
-- Requisito: sql/migrate-2026-11-flota-fusiones.sql ya aplicada. Requiere el usuario de instalación (privilegio TRIGGER y visibilidad de todos los triggers).
-- Esquema: opera sobre DATABASE() (seleccionar la base antes de ejecutar; en phpMyAdmin, elegir la base en el panel izquierdo).
-- NO habilita FLOTA_FUSIONES_APROBADAS ni ejecuta ninguna fusión. Dependencia documentada en docs/flota/consolidacion-vehiculos-lectores-alcance.md.
-- =====================================================================

CREATE TABLE IF NOT EXISTS flota_fusion_guardas_v2_respaldo (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tabla VARCHAR(64) NOT NULL,
 campo VARCHAR(64) NOT NULL,
 trigger_nombre VARCHAR(64) NOT NULL,
 momento VARCHAR(10) NOT NULL,
 evento VARCHAR(10) NOT NULL,
 accion LONGTEXT NOT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_guardas_v2_trigger (trigger_nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DELIMITER //
CREATE PROCEDURE corregir_guardas_fusion_v2()
BEGIN
 DECLARE fin INT DEFAULT 0;
 DECLARE v_tabla VARCHAR(64); DECLARE v_campo VARCHAR(64);
 DECLARE cur CURSOR FOR
 SELECT DISTINCT c.TABLE_NAME,c.COLUMN_NAME FROM information_schema.COLUMNS c
 JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
 WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE' AND c.TABLE_NAME NOT IN ('flota_vehiculos','flota_vehiculos_fusiones','flota_fusion_guardas_v2_respaldo')
 AND c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' AND c.COLUMN_NAME NOT IN ('vehiculo_id','unidad_recurrente_id')
 AND EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.REFERENCED_TABLE_NAME<>'flota_vehiculos')
 AND NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos');
 DECLARE CONTINUE HANDLER FOR NOT FOUND SET fin=1;
 OPEN cur;
 lectura: LOOP
  FETCH cur INTO v_tabla,v_campo;
  IF fin=1 THEN LEAVE lectura; END IF;
  IF v_tabla NOT REGEXP '^[a-zA-Z0-9_]+$' OR v_campo NOT REGEXP '^[a-zA-Z0-9_]+$' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Referencia no verificable'; END IF;
  SET @ffi=CONCAT('ffi_',LEFT(SHA2(CONCAT(v_tabla,':',v_campo),256),32));
  SET @ffu=CONCAT('ffu_',LEFT(SHA2(CONCAT(v_tabla,':',v_campo),256),32));
  -- 1) Respaldo exacto de la definición ANTES de eliminar (solo guardas que realmente existen).
  INSERT IGNORE INTO flota_fusion_guardas_v2_respaldo (tabla,campo,trigger_nombre,momento,evento,accion)
   SELECT EVENT_OBJECT_TABLE,v_campo,TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT
   FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=v_tabla AND TRIGGER_NAME IN (@ffi,@ffu);
  -- 2) Eliminar únicamente esas dos guardas (nombres derivados del hash, no por patrón).
  SET @ddl=CONCAT('DROP TRIGGER IF EXISTS `',@ffi,'`'); PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
  SET @ddl=CONCAT('DROP TRIGGER IF EXISTS `',@ffu,'`'); PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
 END LOOP;
 CLOSE cur;
END//
CALL corregir_guardas_fusion_v2()//
DROP PROCEDURE corregir_guardas_fusion_v2//
DELIMITER ;
