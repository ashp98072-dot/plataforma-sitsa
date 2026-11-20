-- =====================================================================
-- ROLLBACK de sql/migrate-2026-11-flota-fusiones-guardas-v2.sql — PROPUESTA, NO EJECUTADO EN NINGÚN ENTORNO REAL.
-- Recrea EXACTAMENTE las guardas ffi_/ffu_ eliminadas, desde la definición guardada en flota_fusion_guardas_v2_respaldo, y luego elimina esa tabla.
-- Restaura también el falso positivo (vehiculo_solicitado_perfil_id vuelve a ser comparado con los IDs fusionados): úsalo solo si hace falta volver al estado anterior.
-- IDEMPOTENTE: DROP TRIGGER IF EXISTS antes de cada CREATE. Si la tabla de respaldo no existe, falla sin cambiar nada (nada que revertir).
-- Opera sobre DATABASE(). Requiere el usuario de instalación. No ejecuta fusiones ni toca datos.
-- =====================================================================

DELIMITER //
CREATE PROCEDURE revertir_guardas_fusion_v2()
BEGIN
 DECLARE fin INT DEFAULT 0;
 DECLARE v_tabla VARCHAR(64); DECLARE v_nombre VARCHAR(64); DECLARE v_momento VARCHAR(10); DECLARE v_evento VARCHAR(10); DECLARE v_accion LONGTEXT;
 DECLARE cur CURSOR FOR SELECT tabla,trigger_nombre,momento,evento,accion FROM flota_fusion_guardas_v2_respaldo ORDER BY id;
 DECLARE CONTINUE HANDLER FOR NOT FOUND SET fin=1;
 OPEN cur;
 lectura: LOOP
  FETCH cur INTO v_tabla,v_nombre,v_momento,v_evento,v_accion;
  IF fin=1 THEN LEAVE lectura; END IF;
  IF v_tabla NOT REGEXP '^[a-zA-Z0-9_]+$' OR v_nombre NOT REGEXP '^ff[iu]_[0-9a-f]{32}$' OR v_momento<>'BEFORE' OR v_evento NOT IN ('INSERT','UPDATE') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Respaldo de guarda no verificable'; END IF;
  SET @ddl=CONCAT('DROP TRIGGER IF EXISTS `',v_nombre,'`'); PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
  SET @ddl=CONCAT('CREATE TRIGGER `',v_nombre,'` ',v_momento,' ',v_evento,' ON `',v_tabla,'` FOR EACH ROW ',v_accion);
  PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
 END LOOP;
 CLOSE cur;
END//
CALL revertir_guardas_fusion_v2()//
DROP PROCEDURE revertir_guardas_fusion_v2//
DELIMITER ;
DROP TABLE flota_fusion_guardas_v2_respaldo;
