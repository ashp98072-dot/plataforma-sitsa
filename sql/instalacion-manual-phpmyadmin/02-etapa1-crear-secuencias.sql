-- ETAPA 1: crear la tabla canecas_secuencias (vacia)
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
@@SESSION.foreign_key_checks = 1 AND @@SESSION.check_constraint_checks = 1 AND @@SESSION.innodb_strict_mode = 1 AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0) AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='empresas')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_secuencias')=0 AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd'))=2,
'CREATE TABLE `u611730801_Plataforma`.canecas_secuencias (
  empresa_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  ultimo BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id,tipo),
  CONSTRAINT chk_can_secuencia CHECK (ultimo >= 0),
  CONSTRAINT fk_can_secuencia_empresa FOREIGN KEY (empresa_id) REFERENCES `u611730801_Plataforma`.empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
'SELECT (SELECT ''DETENER: prerequisitos o modos de sesion de la etapa 1 incompletos'' UNION ALL SELECT ''ejecute 01-verificar-previo.sql y revise cada fila'')');
PREPARE etapa_stmt FROM @etapa_sql;
EXECUTE etapa_stmt;
SHOW WARNINGS;
DEALLOCATE PREPARE etapa_stmt;
SET SESSION sql_mode = @sql_mode_previo;
SET SESSION innodb_strict_mode = @innodb_strict_previo;
