-- SOLO LECTURA. Seleccione la base en phpMyAdmin antes de ejecutar.
-- Ejecute cada bloque en la misma conexión y compare el nombre exacto de base.
-- No incluye credenciales ni consulta filas de negocio.
SELECT DATABASE() AS base_actual, HEX(DATABASE()) AS base_hex,
       USER() AS identidad_conexion, CURRENT_USER() AS cuenta_efectiva,
       CURRENT_ROLE() AS rol_activo, VERSION() AS version_servidor,
       @@SESSION.sql_mode AS modo_sql_sesion,
       @@SESSION.innodb_strict_mode AS innodb_estricto_sesion,
       @@SESSION.foreign_key_checks AS fk_sesion,
       @@SESSION.check_constraint_checks AS check_sesion;

-- Cuenta sin filtrar nombres de tabla y muestra el esquema que MariaDB devuelve.
SELECT 'TABLES' AS fuente, TABLE_SCHEMA AS esquema, HEX(TABLE_SCHEMA) AS esquema_hex, COUNT(*) AS filas
FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA = BINARY DATABASE() GROUP BY TABLE_SCHEMA
UNION ALL SELECT 'COLUMNS',TABLE_SCHEMA,HEX(TABLE_SCHEMA),COUNT(*)
FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA = BINARY DATABASE() GROUP BY TABLE_SCHEMA
UNION ALL SELECT 'STATISTICS',TABLE_SCHEMA,HEX(TABLE_SCHEMA),COUNT(*)
FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA = BINARY DATABASE() GROUP BY TABLE_SCHEMA
UNION ALL SELECT 'KEY_COLUMN_USAGE',TABLE_SCHEMA,HEX(TABLE_SCHEMA),COUNT(*)
FROM information_schema.KEY_COLUMN_USAGE WHERE BINARY TABLE_SCHEMA = BINARY DATABASE() GROUP BY TABLE_SCHEMA;

-- Pruebas concretas sin consultas de datos: 0 columnas o índices para una tabla
-- existente requiere aclarar visibilidad, identidad, sesión o filtro antes de seguir.
SELECT 'COLUMNS' AS fuente,TABLE_NAME,COUNT(*) AS filas FROM information_schema.COLUMNS
WHERE BINARY TABLE_SCHEMA=BINARY DATABASE() AND BINARY TABLE_NAME=BINARY 'canecas_compras' GROUP BY TABLE_NAME
UNION ALL SELECT 'STATISTICS',TABLE_NAME,COUNT(*) FROM information_schema.STATISTICS
WHERE BINARY TABLE_SCHEMA=BINARY DATABASE() AND BINARY TABLE_NAME=BINARY 'canecas_compras' GROUP BY TABLE_NAME
UNION ALL SELECT 'KEY_COLUMN_USAGE',TABLE_NAME,COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
WHERE BINARY TABLE_SCHEMA=BINARY DATABASE() AND BINARY TABLE_NAME=BINARY 'canecas_compras' GROUP BY TABLE_NAME;

SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME
FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos')
ORDER BY TABLE_NAME,ORDINAL_POSITION;

SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE
FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos')
ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;

SELECT TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE WHERE BINARY TABLE_SCHEMA=BINARY DATABASE()
AND TABLE_NAME IN ('canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos')
AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;

-- Alternativa independiente de information_schema; cada bloque es de lectura.
-- SHOW CREATE expone tipos, índices y claves existentes sin mostrar registros.
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
SHOW CREATE TABLE canecas_productos;
SHOW CREATE TABLE canecas_ubicaciones;
SHOW CREATE TABLE canecas_saldos;
SHOW CREATE TABLE canecas_compras;
SHOW CREATE TABLE canecas_recepciones;
SHOW CREATE TABLE canecas_movimientos;

-- La salida puede revelar nombres de cuentas y hosts: redactarlos al compartir.
SHOW GRANTS FOR CURRENT_USER;
