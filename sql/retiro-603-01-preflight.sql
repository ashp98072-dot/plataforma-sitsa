-- SOLO LECTURA. PREPARADO, NO EJECUTADO. No constituye autorización de borrado.
-- DBA: seleccionar explícitamente la base correcta y conservar todos los resultados.
SELECT DATABASE() AS esquema, VERSION() AS version_servidor, CURRENT_USER() AS cuenta,
       @@in_transaction AS transaccion_activa, @@foreign_key_checks AS fk_activas,
       @@check_constraint_checks AS checks_activos, @@group_concat_max_len AS limite_json;

SELECT * FROM flota_vehiculos WHERE id IN (603,1297) ORDER BY id;
SELECT * FROM empresas WHERE id IN (1,4) ORDER BY id;
SELECT * FROM tms_solicitud_fondo_lineas WHERE vehiculo_id IN (603,1297) ORDER BY id;
SELECT * FROM tms_unidades WHERE flota_vehiculo_id IN (603,1297) ORDER BY id;

-- Inventario físico: NO asumir que las 15 FK comunicadas son todo el esquema.
SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_COLUMN_NAME,
       r.DELETE_RULE,r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME
 AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'
ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION;

-- Copiar esta huella SOLO tras revisar el inventario completo y SHOW WARNINGS.
SELECT SHA2(JSON_ARRAYAGG(JSON_ARRAY(k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,
 k.COLUMN_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE)
 ORDER BY k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION),256) AS huella_fk_revisada
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos';
SHOW WARNINGS;

-- Incluye nombres no respaldados por FK; revisar nombres nuevos antes de proceder.
SELECT c.TABLE_NAME,c.COLUMN_NAME,c.COLUMN_TYPE,t.ENGINE
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE c.TABLE_SCHEMA=DATABASE()
AND (LOWER(c.COLUMN_NAME) LIKE '%vehicul%' OR c.COLUMN_NAME='unidad_recurrente_id')
ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION;

-- Genera SELECT de conteo: revisar/exportar y ejecutar MANUALMENTE cada sentencia.
-- No PREPARE/EXECUTE ni escrituras en este preflight. No filtrar por empresa:
-- una referencia al 603 desde otro tenant también bloquea.
SELECT DISTINCT CONCAT('SELECT ',QUOTE(CONCAT(c.TABLE_NAME,'.',c.COLUMN_NAME)),
 ' AS dependencia, COUNT(*) AS referencias_603 FROM `',REPLACE(c.TABLE_SCHEMA,'`','``'),
 '`.`',REPLACE(c.TABLE_NAME,'`','``'),'` WHERE `',REPLACE(c.COLUMN_NAME,'`','``'),'`=603;') AS sql_lectura
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
AND c.DATA_TYPE IN ('tinyint','smallint','mediumint','int','bigint','decimal','numeric')
AND (LOWER(c.COLUMN_NAME) LIKE '%vehicul%' OR c.COLUMN_NAME='unidad_recurrente_id'
 OR EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
 WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME
 AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'
 AND k.REFERENCED_COLUMN_NAME='id'))
ORDER BY sql_lectura;

-- Barrido conservador de texto/JSON: candidatos, no prueba automática de identidad.
-- Una coincidencia puede ser otro ID o un importe; aun así BLOQUEA este procedimiento.
-- Revisar cualquier positivo sin editar/eliminar evidencia para hacerlo pasar.
SELECT CONCAT('SELECT ',QUOTE(CONCAT(c.TABLE_NAME,'.',c.COLUMN_NAME)),
 ' AS evidencia, COUNT(*) AS candidatos_603 FROM `',REPLACE(c.TABLE_SCHEMA,'`','``'),
 '`.`',REPLACE(c.TABLE_NAME,'`','``'),'` WHERE CAST(`',REPLACE(c.COLUMN_NAME,'`','``'),
 '` AS CHAR) REGEXP ''(^|[^[:alnum:]])603([^[:alnum:]]|$)|veh603-doc'';') AS sql_lectura
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
AND c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json','tinyblob','blob','mediumblob','longblob')
ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION;

SELECT * FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE();
SELECT * FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE();
SELECT TABLE_NAME,VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE();
SELECT ROUTINE_NAME,ROUTINE_TYPE,ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE();
-- STOP: inventario incompleto, definición oculta, error o cualquier dependencia nueva
-- requieren revisión. Conservar exportaciones completas del 603, 1297, fondos y TMS.
