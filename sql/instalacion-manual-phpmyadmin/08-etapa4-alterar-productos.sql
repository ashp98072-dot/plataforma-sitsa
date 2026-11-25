-- ETAPA 4: canecas_productos: activo_unico (virtual) y UNIQUE (una caneca activa por empresa)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- Pegue y ejecute TODO el archivo en UNA sola peticion: fija y verifica en esa misma sesion SQL estricto e innodb_strict_mode y los restaura al final. No desactiva claves foraneas ni CHECK.
-- Si cualquier sentencia da error, DETENGASE: no continue con otra etapa y use 15-recuperacion-solo-lectura.sql. Nunca avance tras un error.
-- GUARDA INTRINSECA: la DDL va dentro de un PREPARE condicionado; si no se cumplen los prerequisitos o los modos, se ejecuta una subconsulta que falla (1242) y la DDL NO se ejecuta, aunque el cliente siguiera tras el error.
-- Falla (clave duplicada) si alguna empresa tiene mas de una caneca activa: el preflight lo detecta antes.
--

SET @sql_mode_previo = @@SESSION.sql_mode, @innodb_strict_previo = @@SESSION.innodb_strict_mode;
SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0, @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES'));
SET SESSION innodb_strict_mode = 1;
SET @etapa_sql = IF(
@@SESSION.foreign_key_checks = 1 AND @@SESSION.check_constraint_checks = 1 AND @@SESSION.innodb_strict_mode = 1 AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0) AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=0,
'ALTER TABLE `u611730801_Plataforma`.canecas_productos
  ADD COLUMN activo_unico TINYINT(1) GENERATED ALWAYS AS (IF(activo = 1, 1, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_producto_activo_unico (empresa_id,activo_unico)',
'SELECT (SELECT ''DETENER: prerequisitos o modos de sesion de la etapa 4 incompletos'' UNION ALL SELECT ''ejecute 07-verificar-etapa3.sql y revise cada fila'')');
PREPARE etapa_stmt FROM @etapa_sql;
EXECUTE etapa_stmt;
SHOW WARNINGS;
DEALLOCATE PREPARE etapa_stmt;
SET SESSION sql_mode = @sql_mode_previo;
SET SESSION innodb_strict_mode = @innodb_strict_previo;
