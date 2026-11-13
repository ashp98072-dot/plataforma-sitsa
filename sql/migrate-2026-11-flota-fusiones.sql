-- Auditoría y aplicación manual. Solo vehículos propios; no modifica referencias históricas.
-- FLOTA_FUSIONES_APROBADAS=1 solo después de aplicar y verificar esta migración.
CREATE TABLE flota_vehiculos_fusiones (
 origen_id INT NOT NULL PRIMARY KEY, destino_id INT NOT NULL, empresa_id INT NOT NULL,
 administrador_id INT NOT NULL, motivo VARCHAR(1000) NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 origen_snapshot LONGTEXT NOT NULL CHECK(JSON_VALID(origen_snapshot)), destino_snapshot LONGTEXT NOT NULL CHECK(JSON_VALID(destino_snapshot)),
 CHECK(origen_id<>destino_id),
 FOREIGN KEY(origen_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT,
 FOREIGN KEY(destino_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT,
 FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
 FOREIGN KEY(administrador_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
 KEY ix_fusion_destino(empresa_id,destino_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
DELIMITER //
CREATE TRIGGER flota_fusion_identidad BEFORE INSERT ON flota_vehiculos_fusiones FOR EACH ROW
BEGIN
 DECLARE e1 INT; DECLARE e2 INT;
 SELECT empresa_id INTO e1 FROM flota_vehiculos WHERE id=NEW.origen_id LOCK IN SHARE MODE;
 SELECT empresa_id INTO e2 FROM flota_vehiculos WHERE id=NEW.destino_id LOCK IN SHARE MODE;
 IF e1<>NEW.empresa_id OR e2<>NEW.empresa_id OR EXISTS(SELECT 1 FROM flota_vehiculos_fusiones WHERE origen_id=NEW.destino_id OR destino_id=NEW.origen_id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fusion empresarial incompatible o cadena de alias';
 END IF;
END//
CREATE TRIGGER flota_fusion_inmutable BEFORE UPDATE ON flota_vehiculos_fusiones FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La fusion auditada es inmutable'; END//
CREATE TRIGGER flota_fusion_no_borrar BEFORE DELETE ON flota_vehiculos_fusiones FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La fusion auditada no puede eliminarse'; END//
CREATE TRIGGER flota_fusion_no_reactivar BEFORE UPDATE ON flota_vehiculos FOR EACH ROW
BEGIN
 IF (NOT(NEW.empresa_id <=> OLD.empresa_id) OR NOT(NEW.chasis <=> OLD.chasis) OR NOT(NEW.tipo_unidad <=> OLD.tipo_unidad) OR NOT(NEW.placa <=> OLD.placa)) AND EXISTS(SELECT 1 FROM flota_vehiculos_fusiones WHERE origen_id=OLD.id OR destino_id=OLD.id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Identidad de fusion auditada: requiere revision independiente';
 END IF;
 IF NEW.activo<>0 AND EXISTS(SELECT 1 FROM flota_vehiculos_fusiones WHERE origen_id=OLD.id) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Una unidad fusionada no puede reactivarse';
 END IF;
END//
-- Guardas en referencias propias reales del esquema instalado. Lecturas históricas y
-- UPDATE que conserva el mismo ID siguen permitidos. LOCK IN SHARE MODE serializa con la fusión.
CREATE PROCEDURE instalar_guardas_fusion()
BEGIN
 DECLARE fin INT DEFAULT 0;
 DECLARE tabla VARCHAR(64); DECLARE campo VARCHAR(64); DECLARE motor VARCHAR(64);
 DECLARE cur CURSOR FOR
 SELECT DISTINCT c.TABLE_NAME,c.COLUMN_NAME,t.ENGINE FROM information_schema.COLUMNS c
 JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
 WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE' AND c.TABLE_NAME NOT IN ('flota_vehiculos','flota_vehiculos_fusiones')
 AND (c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR c.COLUMN_NAME IN ('vehiculo_id','unidad_recurrente_id') OR EXISTS(
 SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos' AND k.REFERENCED_COLUMN_NAME='id'));
 DECLARE CONTINUE HANDLER FOR NOT FOUND SET fin=1;
 OPEN cur;
 lectura: LOOP
  FETCH cur INTO tabla,campo,motor;
  IF fin=1 THEN LEAVE lectura; END IF;
  IF motor<>'InnoDB' OR tabla NOT REGEXP '^[a-zA-Z0-9_]+$' OR campo NOT REGEXP '^[a-zA-Z0-9_]+$' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Referencia de vehiculo no verificable'; END IF;
  SET @guarda=CONCAT('DECLARE fusionado INT DEFAULT NULL; DECLARE CONTINUE HANDLER FOR NOT FOUND SET fusionado=NULL; SELECT f.origen_id INTO fusionado FROM flota_vehiculos v LEFT JOIN flota_vehiculos_fusiones f ON f.origen_id=v.id WHERE v.id=NEW.`',campo,'` LOCK IN SHARE MODE; IF fusionado IS NOT NULL THEN SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT=''Seleccione la unidad principal: ID fusionado''; END IF;');
  SET @ddl=CONCAT('CREATE TRIGGER `ffi_',LEFT(SHA2(CONCAT(tabla,':',campo),256),32),'` BEFORE INSERT ON `',tabla,'` FOR EACH ROW BEGIN ',@guarda,' END');
  PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
  SET @ddl=CONCAT('CREATE TRIGGER `ffu_',LEFT(SHA2(CONCAT(tabla,':',campo),256),32),'` BEFORE UPDATE ON `',tabla,'` FOR EACH ROW BEGIN IF NOT (NEW.`',campo,'` <=> OLD.`',campo,'`) THEN BEGIN ',@guarda,' END; END IF; END');
  PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
 END LOOP;
 CLOSE cur;
END//
CALL instalar_guardas_fusion()//
DROP PROCEDURE instalar_guardas_fusion//
DELIMITER ;
