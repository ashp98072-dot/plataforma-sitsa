-- ETAPA 3: canecas_ventas: direccion_entrega, CHECK, doc_auto y UNIQUE (una sola sentencia ALTER)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- Pegue y ejecute TODO el archivo en UNA sola peticion: fija y verifica en esa misma sesion SQL estricto e innodb_strict_mode y los restaura al final. No desactiva claves foraneas ni CHECK.
-- Si cualquier sentencia da error, DETENGASE: no continue con otra etapa y use 15-recuperacion-solo-lectura.sql. Nunca avance tras un error.
-- GUARDA INTRINSECA: la DDL va dentro de un PREPARE condicionado; si no se cumplen los prerequisitos o los modos, se ejecuta una subconsulta que falla (1242) y la DDL NO se ejecuta, aunque el cliente siguiera tras el error.
--

SET @sql_mode_previo = @@SESSION.sql_mode, @innodb_strict_previo = @@SESSION.innodb_strict_mode;
SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0, @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES'));
SET SESSION innodb_strict_mode = 1;
SET @etapa_sql = IF(
@@SESSION.foreign_key_checks = 1 AND @@SESSION.check_constraint_checks = 1 AND @@SESSION.innodb_strict_mode = 1 AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0) AND (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_secuencias)=(SELECT COUNT(*)*3 FROM `u611730801_Plataforma`.empresas) AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega')=0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=0,
'ALTER TABLE `u611730801_Plataforma`.canecas_ventas
  ADD COLUMN direccion_entrega VARCHAR(500) NULL AFTER ubicacion_id,
  ADD CONSTRAINT chk_can_venta_direccion CHECK (direccion_entrega IS NULL OR CHAR_LENGTH(TRIM(direccion_entrega)) > 0),
  ADD COLUMN doc_auto VARCHAR(250) GENERATED ALWAYS AS (IF(documento REGEXP ''^VTA-[0-9]{6,15}$'', documento, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_venta_doc_auto (empresa_id,doc_auto)',
'SELECT (SELECT ''DETENER: prerequisitos o modos de sesion de la etapa 3 incompletos'' UNION ALL SELECT ''ejecute 05-verificar-etapa2.sql y revise cada fila'')');
PREPARE etapa_stmt FROM @etapa_sql;
EXECUTE etapa_stmt;
SHOW WARNINGS;
DEALLOCATE PREPARE etapa_stmt;
SET SESSION sql_mode = @sql_mode_previo;
SET SESSION innodb_strict_mode = @innodb_strict_previo;
