-- ETAPA 2: sembrar los contadores con el maximo historico por empresa y tipo (INSERT solo en la tabla nueva)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- Pegue y ejecute TODO el archivo en UNA sola peticion: fija y verifica en esa misma sesion SQL estricto e innodb_strict_mode y los restaura al final. No desactiva claves foraneas ni CHECK.
-- Si cualquier sentencia da error, DETENGASE: no continue con otra etapa y use 15-recuperacion-solo-lectura.sql. Nunca avance tras un error.
-- GUARDA INTRINSECA: la DDL va dentro de un PREPARE condicionado; si no se cumplen los prerequisitos o los modos, se ejecuta una subconsulta que falla (1242) y la DDL NO se ejecuta, aunque el cliente siguiera tras el error.
-- No renumera ni modifica ningun documento existente; no rellena huecos.
--

SET @sql_mode_previo = @@SESSION.sql_mode, @innodb_strict_previo = @@SESSION.innodb_strict_mode;
SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0, @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES'));
SET SESSION innodb_strict_mode = 1;
SET @etapa_sql = IF(
@@SESSION.foreign_key_checks = 1 AND @@SESSION.check_constraint_checks = 1 AND @@SESSION.innodb_strict_mode = 1 AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0) AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_secuencias')=1 AND (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_secuencias)=0,
'INSERT INTO `u611730801_Plataforma`.canecas_secuencias (empresa_id,tipo,ultimo)
SELECT e.id, t.tipo, COALESCE(h.maximo, 0)
FROM `u611730801_Plataforma`.empresas e
CROSS JOIN (SELECT ''COMPRA'' AS tipo UNION ALL SELECT ''PRODUCTO'' UNION ALL SELECT ''VENTA'') t
LEFT JOIN (
  SELECT empresa_id, ''COMPRA'' AS tipo, MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(referencia)), ''^COMP[ _-]?'', '''') AS UNSIGNED)) AS maximo FROM `u611730801_Plataforma`.canecas_compras WHERE UPPER(TRIM(referencia)) REGEXP ''^COMP[ _-]?[0-9]{1,15}$'' GROUP BY empresa_id
  UNION ALL SELECT empresa_id, ''VENTA'', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(documento)), ''^VTA[ _-]?'', '''') AS UNSIGNED)) FROM `u611730801_Plataforma`.canecas_ventas WHERE UPPER(TRIM(documento)) REGEXP ''^VTA[ _-]?[0-9]{1,15}$'' GROUP BY empresa_id
  UNION ALL SELECT empresa_id, ''PRODUCTO'', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(codigo)), ''^CAN[ _-]?'', '''') AS UNSIGNED)) FROM `u611730801_Plataforma`.canecas_productos WHERE UPPER(TRIM(codigo)) REGEXP ''^CAN[ _-]?[0-9]{1,15}$'' GROUP BY empresa_id
) h ON h.empresa_id = e.id AND h.tipo = t.tipo',
'SELECT (SELECT ''DETENER: prerequisitos o modos de sesion de la etapa 2 incompletos'' UNION ALL SELECT ''ejecute 03-verificar-etapa1.sql y revise cada fila'')');
PREPARE etapa_stmt FROM @etapa_sql;
EXECUTE etapa_stmt;
SHOW WARNINGS;
DEALLOCATE PREPARE etapa_stmt;
SET SESSION sql_mode = @sql_mode_previo;
SET SESSION innodb_strict_mode = @innodb_strict_previo;
