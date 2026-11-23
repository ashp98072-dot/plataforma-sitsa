-- SOLO SELECT. Sustituya todas las apariciones de ESQUEMA_OBJETIVO por
-- el nombre exacto del esquema como literal SQL; nunca incluya credenciales.
-- Compare DATABASE() e id_conexion en cada bloque. El contexto observado en
-- phpMyAdmin puede diferir entre consultas; no se ha probado que phpMyAdmin
-- lo haya cambiado. La conexi?n del instalador es independiente. Un cero o
-- un marcador sin sustituir no demuestra ausencia.
-- SOLO SELECT. Ejecutar en phpMyAdmin y, por separado, en la conexión prevista
-- para el instalador. No pegar credenciales ni filas de negocio. Redactar
-- cuentas, hosts y nombre de base antes de compartir; conservar HEX y resultados.
SELECT 'ESQUEMA_OBJETIVO' AS esquema_objetivo, DATABASE() AS base_seleccionada,
       CASE WHEN 'ESQUEMA_OBJETIVO' = CONCAT('ESQUEMA_', 'OBJETIVO') THEN 'DETENER: sustituya el marcador' WHEN DATABASE() IS NULL THEN 'SIN BASE SELECCIONADA' WHEN BINARY DATABASE() = BINARY 'ESQUEMA_OBJETIVO' THEN 'COINCIDEN' ELSE 'DISTINTOS: no usar DATABASE() como objetivo' END AS comparacion_contexto,
       CONNECTION_ID() AS id_conexion, HEX(DATABASE()) AS base_hex,
       VERSION() AS version_servidor, USER() AS usuario_conexion,
       CURRENT_USER() AS cuenta_efectiva, CURRENT_ROLE() AS rol_activo,
       @@character_set_connection AS charset_conexion, @@collation_connection AS collation_conexion,
       @@character_set_database AS charset_base, @@collation_database AS collation_base,
       @@lower_case_table_names AS nombres_en_minuscula;

-- Sin filtros de nombres: verifica qué devuelve cada vista para el esquema objetivo.
-- Un cero puede significar visibilidad insuficiente, no ausencia.
SELECT DATABASE() base_sesion, CONNECTION_ID() id_conexion, 'ESQUEMA_OBJETIVO' esquema_objetivo, 'TABLES' fuente, COUNT(*) total, SUM(TABLE_SCHEMA='ESQUEMA_OBJETIVO') igualdad,
       SUM(BINARY TABLE_SCHEMA=BINARY 'ESQUEMA_OBJETIVO') binario
FROM information_schema.TABLES
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','COLUMNS',COUNT(*),SUM(TABLE_SCHEMA='ESQUEMA_OBJETIVO'),SUM(BINARY TABLE_SCHEMA=BINARY 'ESQUEMA_OBJETIVO') FROM information_schema.COLUMNS
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','STATISTICS',COUNT(*),SUM(TABLE_SCHEMA='ESQUEMA_OBJETIVO'),SUM(BINARY TABLE_SCHEMA=BINARY 'ESQUEMA_OBJETIVO') FROM information_schema.STATISTICS
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','KEY_COLUMN_USAGE',COUNT(*),SUM(TABLE_SCHEMA='ESQUEMA_OBJETIVO'),SUM(BINARY TABLE_SCHEMA=BINARY 'ESQUEMA_OBJETIVO') FROM information_schema.KEY_COLUMN_USAGE
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','TABLE_CONSTRAINTS',COUNT(*),SUM(CONSTRAINT_SCHEMA='ESQUEMA_OBJETIVO'),SUM(BINARY CONSTRAINT_SCHEMA=BINARY 'ESQUEMA_OBJETIVO') FROM information_schema.TABLE_CONSTRAINTS
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','CHECK_CONSTRAINTS',COUNT(*),SUM(CONSTRAINT_SCHEMA='ESQUEMA_OBJETIVO'),SUM(BINARY CONSTRAINT_SCHEMA=BINARY 'ESQUEMA_OBJETIVO') FROM information_schema.CHECK_CONSTRAINTS;

-- Conteos por tabla esperada, sin BINARY en el predicado de esquema o nombre.
-- Las columnas muestran cómo evalúa cada comparación y sus bytes reales.
SELECT e.nombre, CONNECTION_ID() AS id_conexion, DATABASE() AS base_sesion, 'ESQUEMA_OBJETIVO' AS esquema_objetivo, t.TABLE_SCHEMA esquema_visible, HEX(t.TABLE_SCHEMA) esquema_hex,
       t.TABLE_NAME tabla_visible, HEX(t.TABLE_NAME) tabla_hex,
       COLLATION(t.TABLE_SCHEMA) collation_esquema, COLLATION(t.TABLE_NAME) collation_tabla,
       t.TABLE_SCHEMA='ESQUEMA_OBJETIVO' esquema_igual, BINARY t.TABLE_SCHEMA=BINARY 'ESQUEMA_OBJETIVO' esquema_binario,
       t.TABLE_NAME=e.nombre nombre_igual, BINARY t.TABLE_NAME=BINARY e.nombre nombre_binario,
       t.TABLE_TYPE, t.ENGINE, t.TABLE_COLLATION
FROM (SELECT 'empresas' nombre UNION ALL SELECT 'usuarios' UNION ALL SELECT 'canecas_productos'
 UNION ALL SELECT 'canecas_ubicaciones' UNION ALL SELECT 'canecas_saldos' UNION ALL SELECT 'canecas_compras'
 UNION ALL SELECT 'canecas_recepciones' UNION ALL SELECT 'canecas_movimientos') e
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA='ESQUEMA_OBJETIVO' AND t.TABLE_NAME=e.nombre ORDER BY e.nombre;

-- Contrastar las fuentes sin interpretar ausencias como definitivas.
SELECT DATABASE() base_sesion, CONNECTION_ID() id_conexion, 'ESQUEMA_OBJETIVO' esquema_objetivo, 'TABLES' fuente,TABLE_NAME,COUNT(*) filas FROM information_schema.TABLES WHERE TABLE_SCHEMA='ESQUEMA_OBJETIVO' GROUP BY TABLE_NAME
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','COLUMNS',TABLE_NAME,COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='ESQUEMA_OBJETIVO' GROUP BY TABLE_NAME
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','STATISTICS',TABLE_NAME,COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='ESQUEMA_OBJETIVO' GROUP BY TABLE_NAME
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','FK',TABLE_NAME,COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='ESQUEMA_OBJETIVO' AND REFERENCED_TABLE_NAME IS NOT NULL GROUP BY TABLE_NAME
UNION ALL SELECT DATABASE(),CONNECTION_ID(),'ESQUEMA_OBJETIVO','CHECK',TABLE_NAME,COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='ESQUEMA_OBJETIVO' AND CONSTRAINT_TYPE='CHECK' GROUP BY TABLE_NAME
ORDER BY fuente,TABLE_NAME;

