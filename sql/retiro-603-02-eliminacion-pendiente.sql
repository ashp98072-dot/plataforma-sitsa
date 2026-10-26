-- PENDIENTE DE AUDITORÍA. NO EJECUTADO. BLOQUEADO POR DEFECTO.
-- MariaDB 11.8: UN bloque enviado íntegro en una sesión dedicada, sin transacción previa.
-- Este archivo NO es para el importador SQL de Hostinger/phpMyAdmin que fragmente
-- por ';'. Cliente MariaDB con delimitador // configurado FUERA de este archivo.
-- No hay DDL ni creación de rutinas. BEGIN NOT ATOMIC no aporta atomicidad:
-- la aportan START TRANSACTION / handlers / COMMIT y todos los motores InnoDB.
BEGIN NOT ATOMIC
  DECLARE v_autorizado BOOLEAN DEFAULT FALSE;
  DECLARE v_sin_escrituras BOOLEAN DEFAULT FALSE;
  DECLARE v_archivos_revisados BOOLEAN DEFAULT FALSE;
  DECLARE v_inventario_completo BOOLEAN DEFAULT FALSE;
  DECLARE v_esquema VARCHAR(64) DEFAULT NULL;
  DECLARE v_operador VARCHAR(80) DEFAULT NULL;
  DECLARE v_huella_fk CHAR(64) DEFAULT NULL;
  DECLARE v_huella_actual CHAR(64);
  DECLARE v_tx BOOLEAN DEFAULT FALSE;
  DECLARE v_motivo VARCHAR(1000) DEFAULT 'Retiro específico del duplicado 603 de C-035BXR; conservar 1297 de KT, sin reasociar datos';
  DECLARE v_fin BOOLEAN DEFAULT FALSE;
  DECLARE v_tabla VARCHAR(64);
  DECLARE v_columna VARCHAR(64);
  DECLARE v_tipo VARCHAR(64);
  DECLARE v_n BIGINT DEFAULT 0;
  DECLARE v_id INT;
  DECLARE v_empresa INT;
  DECLARE v_placa VARCHAR(40);
  DECLARE v_columnas LONGTEXT;
  DECLARE v_fase INT DEFAULT 0;
  DECLARE v_i INT;
  DECLARE v_antes_veh LONGTEXT;
  DECLARE v_antes_fondos LONGTEXT;
  DECLARE v_antes_tms LONGTEXT;
  DECLARE v_antes_603 LONGTEXT;
  DECLARE v_auditoria_id BIGINT;
  DECLARE c_dependencias CURSOR FOR
    SELECT c.TABLE_NAME,c.COLUMN_NAME,c.DATA_TYPE
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
    WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
    AND (c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json','tinyblob','blob','mediumblob','longblob')
     OR (c.DATA_TYPE IN ('tinyint','smallint','mediumint','int','bigint','decimal','numeric')
      AND (LOWER(c.COLUMN_NAME) LIKE '%vehicul%' OR c.COLUMN_NAME='unidad_recurrente_id'
       OR EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'
        AND k.REFERENCED_COLUMN_NAME='id'))))
    ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_fin=TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN IF v_tx THEN ROLLBACK; END IF; RESIGNAL; END;
  DECLARE EXIT HANDLER FOR SQLWARNING
    BEGIN IF v_tx THEN ROLLBACK; END IF; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: advertencia SQL; no continuar'; END;

  IF NOT v_autorizado OR NOT v_sin_escrituras OR NOT v_archivos_revisados OR NOT v_inventario_completo
    OR v_esquema IS NULL OR NOT (DATABASE() <=> v_esquema)
    OR v_operador IS NULL OR CHAR_LENGTH(TRIM(v_operador))=0 OR v_huella_fk IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: falta autorización, ventana, revisión de archivos, esquema u operador';
  END IF;
  IF @@in_transaction<>0 OR @@foreign_key_checks<>1 OR @@check_constraint_checks<>1
    OR VERSION() NOT LIKE '11.8.%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: sesión/versión/configuración no aprobada';
  END IF;
  SELECT COUNT(*) INTO v_n FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND (ENGINE IS NULL OR ENGINE<>'InnoDB');
  IF v_n<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: motor no transaccional en esquema'; END IF;
  SELECT COUNT(*) INTO v_n FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_vehiculos','auditoria','tms_solicitud_fondo_lineas','tms_unidades','flota_vehiculo_acceso','flota_vehiculo_documentos','flota_vehiculo_filtros','flota_combustible_cargas','flota_cb2_consumos','flota_cb2_filas','flota_cb2_asignaciones');
  IF v_n<>11 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: inventario mínimo incompleto'; END IF;
  SELECT COUNT(*) INTO v_n FROM (
    SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='flota_vehiculos'
    GROUP BY TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME
  ) fks;
  IF v_n<>15 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: cambió inventario de 15 FK; volver a auditar'; END IF;
  SELECT SHA2(JSON_ARRAYAGG(JSON_ARRAY(k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,
    k.COLUMN_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE)
    ORDER BY k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION),256) INTO v_huella_actual
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS r
   ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
  WHERE k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos';
  IF NOT (v_huella_fk <=> v_huella_actual) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: cambió la huella de FK revisadas'; END IF;
  SELECT COUNT(*) INTO v_n FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'
  AND (k.TABLE_SCHEMA<>DATABASE() OR NOT EXISTS (
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE i
    WHERE i.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND i.TABLE_NAME=k.TABLE_NAME
    AND i.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND i.REFERENCED_COLUMN_NAME='id'));
  IF v_n<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: FK externa o sin identidad id; requiere otro diseño'; END IF;
  SELECT COUNT(*) INTO v_n FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('flota_vehiculos','auditoria');
  IF v_n<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: triggers sobre vehículo/auditoría'; END IF;
  SELECT COUNT(*) INTO v_n FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE() AND STATUS='ENABLED';
  IF v_n<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: hay eventos habilitados; falta ventana sin escritores'; END IF;

  START TRANSACTION;
  SET v_tx=TRUE;
  SET v_fin=FALSE;
  SELECT id,empresa_id,placa INTO v_id,v_empresa,v_placa FROM flota_vehiculos WHERE id=603 FOR UPDATE;
  IF v_fin OR v_id<>603 OR v_empresa<>4 OR BINARY v_placa<>BINARY 'C-035BXR' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: identidad 603/FRESCOFRESH/placa no coincide';
  END IF;
  SET v_fin=FALSE;
  SELECT id,empresa_id,placa INTO v_id,v_empresa,v_placa FROM flota_vehiculos WHERE id=1297 FOR UPDATE;
  IF v_fin OR v_id<>1297 OR v_empresa<>1 OR BINARY v_placa<>BINARY 'C-035BXR' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: identidad 1297/KT/placa no coincide';
  END IF;
  SELECT COUNT(*) INTO v_n FROM tms_solicitud_fondo_lineas WHERE vehiculo_id=1297;
  IF v_n<>13 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: no hay exactamente 13 referencias de fondos del 1297'; END IF;
  SELECT COUNT(*) INTO v_n FROM tms_solicitud_fondo_lineas WHERE vehiculo_id=1297 AND empresa_id<>1;
  IF v_n<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: fondos del 1297 fuera de KT'; END IF;
  SELECT COUNT(*) INTO v_n FROM tms_unidades WHERE flota_vehiculo_id=1297;
  IF v_n<>1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: no hay exactamente una unidad TMS del 1297'; END IF;
  SELECT COUNT(*) INTO v_n FROM tms_unidades WHERE flota_vehiculo_id=1297 AND empresa_id<>1;
  IF v_n<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: unidad TMS del 1297 fuera de KT'; END IF;

  -- Captura TODAS las columnas, incluidas nuevas de propiedad si están instaladas.
  -- Dos fases: snapshot antes, comparar después. Orden estable por PK id.
  WHILE v_fase<2 DO
    SET v_i=0;
    WHILE v_i<4 DO
      SET v_tabla=CASE v_i WHEN 0 THEN 'flota_vehiculos' WHEN 1 THEN 'tms_solicitud_fondo_lineas' WHEN 2 THEN 'tms_unidades' ELSE 'flota_vehiculos' END;
      SELECT GROUP_CONCAT(CONCAT(QUOTE(COLUMN_NAME),',`',REPLACE(COLUMN_NAME,'`','``'),'`') ORDER BY ORDINAL_POSITION SEPARATOR ',') INTO v_columnas
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=v_tabla;
      SET @ret603_sql=CONCAT('SELECT JSON_ARRAYAGG(JSON_OBJECT(',v_columnas,') ORDER BY id) INTO @ret603_snapshot FROM `',REPLACE(DATABASE(),'`','``'),'`.`',v_tabla,'` WHERE ',
        CASE v_i WHEN 0 THEN 'id=1297' WHEN 1 THEN 'vehiculo_id=1297' WHEN 2 THEN 'flota_vehiculo_id=1297' ELSE 'id=603' END);
      PREPARE ret603_stmt FROM @ret603_sql; EXECUTE ret603_stmt; DEALLOCATE PREPARE ret603_stmt;
      IF v_fase=0 THEN
        CASE v_i WHEN 0 THEN SET v_antes_veh=@ret603_snapshot; WHEN 1 THEN SET v_antes_fondos=@ret603_snapshot;
          WHEN 2 THEN SET v_antes_tms=@ret603_snapshot; ELSE SET v_antes_603=@ret603_snapshot; END CASE;
      ELSE
        IF v_i<3 AND NOT (SHA2(@ret603_snapshot,256) <=> SHA2(CASE v_i WHEN 0 THEN v_antes_veh WHEN 1 THEN v_antes_fondos ELSE v_antes_tms END,256)) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: cambió vehículo 1297, fondos o TMS; rollback';
        END IF;
        IF v_i=3 AND @ret603_snapshot IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: 603 sigue presente'; END IF;
      END IF;
      SET v_i=v_i+1;
    END WHILE;

    IF v_fase=0 THEN
      SET v_fin=FALSE;
      OPEN c_dependencias;
      barrido: LOOP
        FETCH c_dependencias INTO v_tabla,v_columna,v_tipo;
        IF v_fin THEN LEAVE barrido; END IF;
        SET @ret603_sql=CONCAT('SELECT COUNT(*) INTO @ret603_referencias FROM `',REPLACE(DATABASE(),'`','``'),'`.`',REPLACE(v_tabla,'`','``'),'` WHERE `',REPLACE(v_columna,'`','``'),'`',
          IF(v_tipo IN ('char','varchar','tinytext','text','mediumtext','longtext','json','tinyblob','blob','mediumblob','longblob'), ' REGEXP ''(^|[^[:alnum:]])603([^[:alnum:]]|$)|veh603-doc''', '=603'));
        SET @ret603_referencias=NULL;
        PREPARE ret603_stmt FROM @ret603_sql; EXECUTE ret603_stmt; DEALLOCATE PREPARE ret603_stmt;
        IF @ret603_referencias IS NULL OR @ret603_referencias<>0 THEN
          SELECT v_tabla AS tabla_bloqueante,v_columna AS columna_bloqueante,@ret603_referencias AS candidatos;
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: dependencia o evidencia candidata del 603; no eliminar';
        END IF;
      END LOOP;
      CLOSE c_dependencias;

      INSERT INTO auditoria (empresa_id,usuario,accion,modulo,detalle)
      VALUES (4,v_operador,'retiro_duplicado_603','flota_vehiculos',JSON_OBJECT('version',1,'retiradoId',603,'conservadoId',1297,'empresaRetirada',4,'empresaConservada',1,'placa','C-035BXR','motivo',v_motivo,'cuentaSQL',CURRENT_USER(),'antes603',JSON_EXTRACT(v_antes_603,'$'),'hash1297',SHA2(v_antes_veh,256),'hashFondos1297',SHA2(v_antes_fondos,256),'hashTms1297',SHA2(v_antes_tms,256)));
      SET v_auditoria_id=LAST_INSERT_ID();
      -- Las variables LOCALES también están en el DELETE: extraerlo del bloque
      -- produce error de resolución, no una eliminación sin las barreras previas.
      DELETE FROM flota_vehiculos WHERE id=603 AND empresa_id=4 AND BINARY placa=BINARY 'C-035BXR'
        AND v_autorizado AND v_tx AND v_sin_escrituras AND v_archivos_revisados AND v_inventario_completo
        AND EXISTS (SELECT 1 FROM auditoria a WHERE a.id=v_auditoria_id AND a.empresa_id=4
          AND a.accion='retiro_duplicado_603' AND a.modulo='flota_vehiculos');
      IF ROW_COUNT()<>1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STOP: no se eliminó exactamente la fila 603'; END IF;
    END IF;
    SET v_fase=v_fase+1;
  END WHILE;
  -- Único COMMIT: tras verificar snapshots completos, no solo los conteos.
  COMMIT;
  SET v_tx=FALSE;
  SELECT 'RETIRADO_603_CONSERVADO_1297' AS resultado,v_auditoria_id AS auditoria_id;
END
//
