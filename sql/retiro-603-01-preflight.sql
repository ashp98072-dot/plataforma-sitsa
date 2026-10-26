-- RETIRO BLOQUEADO: solo preparación de consultas de lectura, no autorización.
-- Solo se excluye la propia fila flota_vehiculos.id=603 del barrido externo.
-- Sus contenidos completos se conservan en la exportación inicial; ninguna otra fila se excluye.
-- SOLO LECTURA. PREPARADO, NO EJECUTADO. No constituye autorización de borrado.
-- DBA: seleccionar explícitamente la base correcta y conservar todos los resultados.
SELECT DATABASE() AS esquema, VERSION() AS version_servidor, CURRENT_USER() AS cuenta,
       @@in_transaction AS transaccion_activa, @@foreign_key_checks AS fk_activas,
       @@check_constraint_checks AS checks_activos, @@group_concat_max_len AS limite_json;

SELECT * FROM flota_vehiculos WHERE id IN (603,1297) ORDER BY id;
SELECT * FROM empresas WHERE id IN (1,4) ORDER BY id;
SELECT * FROM tms_solicitud_fondo_lineas WHERE vehiculo_id IN (603,1297) ORDER BY id;
SELECT * FROM tms_unidades WHERE flota_vehiculo_id IN (603,1297) ORDER BY id;

-- Las 15 filas anteriores son columnas FK, NO necesariamente 15 restricciones.
SELECT COUNT(*) AS cantidad_columnas_fk
FROM information_schema.KEY_COLUMN_USAGE
WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='flota_vehiculos';
SELECT COUNT(*) AS cantidad_restricciones_fk FROM (
 SELECT CONSTRAINT_SCHEMA,TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME
 FROM information_schema.KEY_COLUMN_USAGE
 WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='flota_vehiculos'
 GROUP BY CONSTRAINT_SCHEMA,TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME
) restricciones;

-- Exportar TODAS las filas como JSON sin truncar; no agregar con JSON_ARRAYAGG.
-- La huella v2 se calcula offline con scripts/retiro-603-inventario.ts.
-- Deben coincidir inventario crudo y JOIN: una fila sin regla visible es bloqueo.
SELECT k.CONSTRAINT_SCHEMA AS constraint_schema,k.TABLE_SCHEMA AS table_schema,
 k.TABLE_NAME AS table_name,k.CONSTRAINT_NAME AS constraint_name,
 k.COLUMN_NAME AS column_name,k.ORDINAL_POSITION AS ordinal_position,
 k.POSITION_IN_UNIQUE_CONSTRAINT AS position_in_unique_constraint,
 k.REFERENCED_TABLE_SCHEMA AS referenced_table_schema,k.REFERENCED_TABLE_NAME AS referenced_table_name,
 k.REFERENCED_COLUMN_NAME AS referenced_column_name,r.UNIQUE_CONSTRAINT_SCHEMA AS unique_constraint_schema,
 r.UNIQUE_CONSTRAINT_NAME AS unique_constraint_name,r.MATCH_OPTION AS match_option,
 r.UPDATE_RULE AS update_rule,r.DELETE_RULE AS delete_rule
FROM information_schema.KEY_COLUMN_USAGE k
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME
 AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
WHERE k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'
ORDER BY k.CONSTRAINT_SCHEMA,k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION;

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
 '`.`',REPLACE(c.TABLE_NAME,'`','``'),'` WHERE `',REPLACE(c.COLUMN_NAME,'`','``'),'`=603',IF(c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='flota_vehiculos',' AND `id`<>603',''),';') AS sql_lectura
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE t.TABLE_TYPE='BASE TABLE'
AND c.DATA_TYPE IN ('tinyint','smallint','mediumint','int','bigint','decimal','numeric')
AND ((c.TABLE_SCHEMA=DATABASE() AND (LOWER(c.COLUMN_NAME) LIKE '%vehicul%' OR c.COLUMN_NAME='unidad_recurrente_id'))
 OR EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
 WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME
 AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'
 AND k.REFERENCED_COLUMN_NAME='id'))
ORDER BY sql_lectura;

-- Barrido conservador de texto/JSON: candidatos, no prueba automática de identidad.
-- Una coincidencia puede ser una mención histórica legítima, otro ID o un importe; aun así BLOQUEA este procedimiento.
-- Revisar cualquier positivo sin editar/eliminar evidencia para hacerlo pasar.
SELECT CONCAT('SELECT ',QUOTE(CONCAT(c.TABLE_NAME,'.',c.COLUMN_NAME)),
 ' AS evidencia, COUNT(*) AS candidatos_603 FROM `',REPLACE(c.TABLE_SCHEMA,'`','``'),
 '`.`',REPLACE(c.TABLE_NAME,'`','``'),'` WHERE CAST(`',REPLACE(c.COLUMN_NAME,'`','``'),
 '` AS CHAR) REGEXP ''(^|[^[:alnum:]])603([^[:alnum:]]|$)|veh603-doc''',IF(c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='flota_vehiculos',' AND `id`<>603',''),';') AS sql_lectura
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE t.TABLE_TYPE='BASE TABLE' AND (c.TABLE_SCHEMA=DATABASE() OR EXISTS (
 SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
 WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME
 AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='flota_vehiculos'))
AND c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json','tinyblob','blob','mediumblob','longblob')
ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION;

SELECT * FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE();
SELECT * FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE();
SELECT TABLE_NAME,VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE();
SELECT ROUTINE_NAME,ROUTINE_TYPE,ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE();
-- STOP: inventario incompleto, definición oculta, error o cualquier dependencia nueva
-- requieren revisión. Conservar exportaciones completas del 603, 1297, fondos y TMS.
