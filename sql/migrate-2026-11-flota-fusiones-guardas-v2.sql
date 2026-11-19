-- =====================================================================
-- REVISIÓN 2 (corrige el error #1267 de cotejos) — PROPUESTA PARA REVISIÓN, NO EJECUTAR HASTA LA APROBACIÓN INDEPENDIENTE.
-- Migración NUEVA y SEPARADA: corrige el falso positivo de las guardas de fusión sin tocar sql/migrate-2026-11-flota-fusiones.sql.
--
-- INCIDENTE QUE CORRIGE (revisión 1, commit fc276a9a): en Hostinger/phpMyAdmin falló `CALL corregir_guardas_fusion_v2()` con
--   «#1267 Mezcla ilegal de cotejos utf8mb4_uca1400_ai_ci (IMPLICIT) y utf8mb4_unicode_ci (IMPLICIT) para la operación '='».
--   Causa: `CREATE TABLE … DEFAULT CHARSET=utf8mb4` (sin COLLATE) usa el cotejo POR DEFECTO DEL JUEGO DE CARACTERES (utf8mb4_uca1400_ai_ci), mientras que los
--   parámetros y variables de los procedimientos usan el cotejo de la BASE (utf8mb4_unicode_ci). Comparar las columnas de la tabla de respaldo con esos
--   parámetros mezclaba dos cotejos IMPLICIT. El fallo ocurre ANTES de respaldar o eliminar nada: no se pierde ninguna guarda. NO volver a ejecutar la revisión 1.
--   Corrección: TODA comparación de texto entre columnas de la tabla de respaldo, parámetros/variables y information_schema convierte AMBOS lados a
--   `CONVERT(x USING utf8mb4) COLLATE utf8mb4_bin` (binaria y exacta para identificadores). No cambia el cotejo de la base, de las tablas existentes ni del servidor.
--   La tabla de respaldo nueva se crea con COLLATE utf8mb4_bin; si ya existe (creada por la revisión 1) se REUTILIZA tal cual: las conversiones explícitas funcionan con cualquier cotejo.
--
-- Problema original: sql/migrate-2026-11-flota-fusiones.sql instala triggers BEFORE INSERT/UPDATE `ffi_*`/`ffu_*` en toda columna que cumpla
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
-- RESPALDO VERIFICADO ANTES DE CADA DROP (sin INSERT IGNORE):
--   1) La definición exacta del trigger (tabla, momento, evento y ACTION_STATEMENT) se copia con un INSERT normal a
--      flota_fusion_guardas_v2_respaldo: cualquier error del INSERT aborta la migración.
--   2) Inmediatamente antes de CADA `DROP TRIGGER` se comprueba EXPRESAMENTE, byte a byte, que existe EXACTAMENTE una fila de respaldo con
--      la misma tabla, campo, momento, evento y definición que el trigger vigente. Si falta o difiere, la migración ABORTA con un error y ese
--      trigger NO se elimina.
--   3) Si ya existía un respaldo previo con una definición DISTINTA para el mismo nombre de trigger, NO se sobrescribe ni se descarta: la migración
--      aborta sin eliminar ese trigger; hay que revisarlo a mano.
--   4) Se respaldan y verifican las dos guardas (ffi y ffu) de una columna ANTES de eliminar cualquiera de ellas.
--
-- REVERSIBLE: sql/rollback-2026-11-flota-fusiones-guardas-v2.sql recrea las guardas desde el respaldo y elimina esa tabla.
--
-- IDEMPOTENTE Y SEGURA ANTE INTERRUPCIÓN PARCIAL (el DDL de MariaDB confirma implícitamente; el script puede cortarse en cualquier punto, p. ej. con #1267):
--   - Cortada ANTES de respaldar (caso del incidente): tabla de respaldo vacía + procedimientos residuales + guardas intactas -> al reejecutar la
--     revisión 2 se recrean los procedimientos (DROP PROCEDURE IF EXISTS), se reutiliza la tabla y se completa normalmente.
--   - Cortada tras el respaldo y antes del DROP: al reejecutar, el respaldo existente coincide con el trigger vigente y se continúa.
--   - Cortada entre el DROP de ffi y el de ffu: al reejecutar, ffi ya no existe (su respaldo permanece) y se respalda y retira ffu.
--   - Nunca se retira un trigger sin respaldo validado, ni se pierde un respaldo existente.
--   Antes de reanudar tras un fallo, ejecutar sql/diagnostico-2026-11-flota-fusiones-guardas-v2-parcial.sql (solo lectura).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

DELIMITER //
DROP PROCEDURE IF EXISTS respaldar_guarda_v2//
DROP PROCEDURE IF EXISTS retirar_guarda_v2//
DROP PROCEDURE IF EXISTS corregir_guardas_fusion_v2//

-- Copia la definición vigente (si no hay respaldo previo) y VERIFICA que el respaldo es idéntico. No elimina nada.
-- Todas las comparaciones de texto usan CONVERT(x USING utf8mb4) COLLATE utf8mb4_bin en AMBOS lados (ver INCIDENTE arriba).
CREATE PROCEDURE respaldar_guarda_v2(IN p_tabla VARCHAR(64), IN p_campo VARCHAR(64), IN p_nombre VARCHAR(64))
BEGIN
 DECLARE v_existe INT DEFAULT 0; DECLARE v_resp INT DEFAULT 0; DECLARE v_igual INT DEFAULT 0;
 SELECT COUNT(*) INTO v_existe FROM information_schema.TRIGGERS
  WHERE TRIGGER_SCHEMA=DATABASE()
   AND CONVERT(EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
   AND CONVERT(TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_nombre USING utf8mb4) COLLATE utf8mb4_bin;
 IF v_existe=1 THEN
  SELECT COUNT(*) INTO v_resp FROM flota_fusion_guardas_v2_respaldo
   WHERE CONVERT(trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_nombre USING utf8mb4) COLLATE utf8mb4_bin;
  IF v_resp=0 THEN
   INSERT INTO flota_fusion_guardas_v2_respaldo (tabla,campo,trigger_nombre,momento,evento,accion)
    SELECT EVENT_OBJECT_TABLE,p_campo,TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA=DATABASE()
     AND CONVERT(EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
     AND CONVERT(TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_nombre USING utf8mb4) COLLATE utf8mb4_bin;
  END IF;
  SELECT COUNT(*) INTO v_igual FROM flota_fusion_guardas_v2_respaldo r
   JOIN information_schema.TRIGGERS t ON t.TRIGGER_SCHEMA=DATABASE()
    AND CONVERT(t.TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin
   WHERE CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_nombre USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.tabla USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.campo USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_campo USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(t.EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.momento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.ACTION_TIMING USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.evento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.EVENT_MANIPULATION USING utf8mb4) COLLATE utf8mb4_bin
    AND CHAR_LENGTH(r.accion)=CHAR_LENGTH(t.ACTION_STATEMENT) AND BINARY r.accion=BINARY t.ACTION_STATEMENT;
  IF v_igual<>1 THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Respaldo de guarda ausente o distinto de la definicion vigente: no se elimina ningun trigger';
  END IF;
 END IF;
END//

-- Elimina UN trigger, y solo después de comprobar de nuevo, justo antes del DROP, que su definición exacta está respaldada y es recuperable.
CREATE PROCEDURE retirar_guarda_v2(IN p_tabla VARCHAR(64), IN p_campo VARCHAR(64), IN p_nombre VARCHAR(64))
BEGIN
 DECLARE v_existe INT DEFAULT 0; DECLARE v_igual INT DEFAULT 0;
 SELECT COUNT(*) INTO v_existe FROM information_schema.TRIGGERS
  WHERE TRIGGER_SCHEMA=DATABASE()
   AND CONVERT(EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
   AND CONVERT(TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_nombre USING utf8mb4) COLLATE utf8mb4_bin;
 IF v_existe=1 THEN
  SELECT COUNT(*) INTO v_igual FROM flota_fusion_guardas_v2_respaldo r
   JOIN information_schema.TRIGGERS t ON t.TRIGGER_SCHEMA=DATABASE()
    AND CONVERT(t.TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin
   WHERE CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_nombre USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.tabla USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.campo USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_campo USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(t.EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(p_tabla USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.momento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.ACTION_TIMING USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.evento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.EVENT_MANIPULATION USING utf8mb4) COLLATE utf8mb4_bin
    AND CHAR_LENGTH(r.accion)=CHAR_LENGTH(t.ACTION_STATEMENT) AND BINARY r.accion=BINARY t.ACTION_STATEMENT;
  IF v_igual<>1 THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Respaldo de guarda ausente o distinto de la definicion vigente: no se elimina ningun trigger';
  END IF;
  SET @ddl=CONCAT('DROP TRIGGER `',p_nombre,'`'); PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
 END IF;
END//

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
  -- 1) Respaldar y verificar AMBAS guardas antes de eliminar cualquiera.
  CALL respaldar_guarda_v2(v_tabla,v_campo,@ffi);
  CALL respaldar_guarda_v2(v_tabla,v_campo,@ffu);
  -- 2) Eliminar (cada DROP vuelve a comprobar su respaldo exacto).
  CALL retirar_guarda_v2(v_tabla,v_campo,@ffi);
  CALL retirar_guarda_v2(v_tabla,v_campo,@ffu);
 END LOOP;
 CLOSE cur;
END//
CALL corregir_guardas_fusion_v2()//
DROP PROCEDURE corregir_guardas_fusion_v2//
DROP PROCEDURE retirar_guarda_v2//
DROP PROCEDURE respaldar_guarda_v2//
DELIMITER ;
