-- SOLO LECTURA. Seleccionar y verificar la base en phpMyAdmin.
-- Capturar durante pausa de escrituras/DDL, junto al respaldo existente identificado por SHA256.
-- Exportar resultados COMPLETOS, sin truncar. Guardar fuera de Git junto al respaldo.
SELECT DATABASE() AS base, VERSION() AS version, @@sql_mode AS sql_mode,
       @@character_set_connection AS charset_conexion, @@collation_connection AS collation_conexion,
       @@character_set_database AS charset_base, @@collation_database AS collation_base,
       @@foreign_key_checks AS fk, @@check_constraint_checks AS ck;
SELECT TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE,
       OCTET_LENGTH(CHECK_CLAUSE) AS bytes_clausula, SHA2(CHECK_CLAUSE,256) AS sha256_clausula
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA=DATABASE()
ORDER BY TABLE_NAME,CONSTRAINT_NAME;
-- Inventario de control: contrastar cantidad con el archivo exportado, no solo con la pantalla.
SELECT COUNT(*) AS checks_esperados
FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE();
-- El resultado ES TEXTO: este SELECT no ejecuta ALTER ni consulta datos de negocio.
-- Guardar cada columna por separado como SQL plano, sin encabezados ni comillas CSV.
-- En recuperación: ejecutar primero TODOS los validar_datos y exigir cero infracciones.
-- NULL es válido en un CHECK MariaDB: se buscan únicamente expresiones falsas.
SELECT TABLE_NAME,CONSTRAINT_NAME,
 CONCAT('SELECT COUNT(*) AS infracciones FROM `',REPLACE(TABLE_NAME,'`','``'),
        '` WHERE (',CHECK_CLAUSE,') IS FALSE;') AS validar_datos,
 CONCAT('ALTER TABLE `',REPLACE(TABLE_NAME,'`','``'),'` ADD CONSTRAINT `',
        REPLACE(CONSTRAINT_NAME,'`','``'),'` CHECK (',CHECK_CLAUSE,');') AS restaurar_check
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA=DATABASE()
ORDER BY TABLE_NAME,CONSTRAINT_NAME;
