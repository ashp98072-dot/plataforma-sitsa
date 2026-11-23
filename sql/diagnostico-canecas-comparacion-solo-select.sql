-- SOLO SELECT. Ejecutar en phpMyAdmin y, por separado, en la conexión prevista
-- para el instalador. No pegar credenciales ni filas de negocio. Redactar
-- cuentas, hosts y nombre de base antes de compartir; conservar HEX y resultados.
SELECT DATABASE() AS base_seleccionada, HEX(DATABASE()) AS base_hex,
       VERSION() AS version_servidor, USER() AS usuario_conexion,
       CURRENT_USER() AS cuenta_efectiva, CURRENT_ROLE() AS rol_activo,
       @@character_set_connection AS charset_conexion, @@collation_connection AS collation_conexion,
       @@character_set_database AS charset_base, @@collation_database AS collation_base,
       @@lower_case_table_names AS nombres_en_minuscula;

-- Sin filtros de nombres: verifica qué devuelve cada vista para la base actual.
-- Un cero puede significar visibilidad insuficiente, no ausencia.
SELECT 'TABLES' fuente, COUNT(*) total, SUM(TABLE_SCHEMA=DATABASE()) igualdad,
       SUM(BINARY TABLE_SCHEMA=BINARY DATABASE()) binario
FROM information_schema.TABLES
UNION ALL SELECT 'COLUMNS',COUNT(*),SUM(TABLE_SCHEMA=DATABASE()),SUM(BINARY TABLE_SCHEMA=BINARY DATABASE()) FROM information_schema.COLUMNS
UNION ALL SELECT 'STATISTICS',COUNT(*),SUM(TABLE_SCHEMA=DATABASE()),SUM(BINARY TABLE_SCHEMA=BINARY DATABASE()) FROM information_schema.STATISTICS
UNION ALL SELECT 'KEY_COLUMN_USAGE',COUNT(*),SUM(TABLE_SCHEMA=DATABASE()),SUM(BINARY TABLE_SCHEMA=BINARY DATABASE()) FROM information_schema.KEY_COLUMN_USAGE
UNION ALL SELECT 'TABLE_CONSTRAINTS',COUNT(*),SUM(CONSTRAINT_SCHEMA=DATABASE()),SUM(BINARY CONSTRAINT_SCHEMA=BINARY DATABASE()) FROM information_schema.TABLE_CONSTRAINTS
UNION ALL SELECT 'CHECK_CONSTRAINTS',COUNT(*),SUM(CONSTRAINT_SCHEMA=DATABASE()),SUM(BINARY CONSTRAINT_SCHEMA=BINARY DATABASE()) FROM information_schema.CHECK_CONSTRAINTS;

-- Conteos por tabla esperada, sin BINARY en el predicado de esquema o nombre.
-- Las columnas muestran cómo evalúa cada comparación y sus bytes reales.
SELECT e.nombre, t.TABLE_SCHEMA esquema_visible, HEX(t.TABLE_SCHEMA) esquema_hex,
       t.TABLE_NAME tabla_visible, HEX(t.TABLE_NAME) tabla_hex,
       COLLATION(t.TABLE_SCHEMA) collation_esquema, COLLATION(t.TABLE_NAME) collation_tabla,
       t.TABLE_SCHEMA=DATABASE() esquema_igual, BINARY t.TABLE_SCHEMA=BINARY DATABASE() esquema_binario,
       t.TABLE_NAME=e.nombre nombre_igual, BINARY t.TABLE_NAME=BINARY e.nombre nombre_binario,
       t.TABLE_TYPE, t.ENGINE, t.TABLE_COLLATION
FROM (SELECT 'empresas' nombre UNION ALL SELECT 'usuarios' UNION ALL SELECT 'canecas_productos'
 UNION ALL SELECT 'canecas_ubicaciones' UNION ALL SELECT 'canecas_saldos' UNION ALL SELECT 'canecas_compras'
 UNION ALL SELECT 'canecas_recepciones' UNION ALL SELECT 'canecas_movimientos') e
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=e.nombre ORDER BY e.nombre;

-- Contrastar las fuentes sin interpretar ausencias como definitivas.
SELECT 'TABLES' fuente,TABLE_NAME,COUNT(*) filas FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME
UNION ALL SELECT 'COLUMNS',TABLE_NAME,COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME
UNION ALL SELECT 'STATISTICS',TABLE_NAME,COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME
UNION ALL SELECT 'FK',TABLE_NAME,COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL GROUP BY TABLE_NAME
UNION ALL SELECT 'CHECK',TABLE_NAME,COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' GROUP BY TABLE_NAME
ORDER BY fuente,TABLE_NAME;

