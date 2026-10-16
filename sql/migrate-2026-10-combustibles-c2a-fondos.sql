-- PROPUESTA NO EJECUTADA. MariaDB 11.8.9. Aprobar preflight antes de aplicar manualmente.
-- Solo DDL: sin DML, seeds ni backfill. NULL conserva históricos. No se invoca desde aplicación.
-- El procedimiento comprueba metadata ANTES del primer ALTER; falla cerrado ante estado parcial.
-- DDL no es transaccional: si la ejecución se interrumpe entre ALTERs, DETENER y revisar,
-- no reparar automáticamente. Reejecución completa sobre contrato final => NOOP.
DELIMITER $$
CREATE OR REPLACE PROCEDURE migrate_combustible_c2a_fondos()
BEGIN
  DECLARE col_ok INT DEFAULT 0;
  DECLARE col_total INT DEFAULT 0;
  DECLARE padre_ok INT DEFAULT 0;
  DECLARE hijo_ok INT DEFAULT 0;
  DECLARE fk_ok INT DEFAULT 0;
  DECLARE objetos INT DEFAULT 0;
  IF DATABASE() IS NULL OR VERSION() NOT LIKE '11.8.9-MariaDB%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: seleccionar BD y verificar MariaDB 11.8.9';
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN ('flota_combustible_cargas','tms_solicitud_fondo_lineas','tms_solicitudes_fondo') AND ENGINE='InnoDB')<>3 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: tablas/engines incompatibles';
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN ('flota_combustible_cargas','tms_solicitud_fondo_lineas','tms_solicitudes_fondo')
      AND COLUMN_NAME IN ('id','empresa_id') AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%'
      AND IS_NULLABLE='NO')<>6 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: IDs deben ser INT signed NOT NULL';
  END IF;
  IF (SELECT COUNT(*) FROM (SELECT TABLE_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_combustible_cargas','tms_solicitud_fondo_lineas') AND INDEX_NAME='PRIMARY'
      GROUP BY TABLE_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='id') p)<>2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: PK inesperada';
  END IF;
  IF EXISTS(SELECT 1 FROM tms_solicitud_fondo_lineas l LEFT JOIN tms_solicitudes_fondo s
      ON s.empresa_id=l.empresa_id AND s.id=l.solicitud_id WHERE s.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: lineas huerfanas';
  END IF;
  SELECT COUNT(*) INTO col_total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='flota_combustible_cargas' AND COLUMN_NAME='solicitud_fondo_linea_id';
  SELECT COUNT(*) INTO col_ok FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='flota_combustible_cargas' AND COLUMN_NAME='solicitud_fondo_linea_id'
    AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='YES'
    AND (COLUMN_DEFAULT IS NULL OR COLUMN_DEFAULT='NULL') AND EXTRA='';
  SELECT COUNT(*) INTO padre_ok FROM (SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tms_solicitud_fondo_lineas' AND INDEX_NAME='uq_fondolin_c2a_empresa_id'
    GROUP BY INDEX_NAME HAVING MAX(NON_UNIQUE)=0 AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,id'
      AND SUM(SUB_PART IS NOT NULL)=0) p;
  SELECT COUNT(*) INTO hijo_ok FROM (SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_cargas' AND INDEX_NAME='idx_fcc_fondo_linea'
    GROUP BY INDEX_NAME HAVING MAX(NON_UNIQUE)=1 AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,solicitud_fondo_linea_id'
      AND SUM(SUB_PART IS NOT NULL)=0) h;
  SELECT COUNT(*) INTO fk_ok FROM (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='flota_combustible_cargas' AND k.CONSTRAINT_NAME='fk_fcc_fondo_linea'
      AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='tms_solicitud_fondo_lineas'
      AND r.UPDATE_RULE='RESTRICT' AND r.DELETE_RULE='RESTRICT'
    GROUP BY k.CONSTRAINT_NAME HAVING GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION)='empresa_id,solicitud_fondo_linea_id'
      AND GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION)='empresa_id,id') f;
  SELECT (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      AND ((TABLE_NAME='tms_solicitud_fondo_lineas' AND INDEX_NAME='uq_fondolin_c2a_empresa_id')
        OR (TABLE_NAME='flota_combustible_cargas' AND INDEX_NAME='idx_fcc_fondo_linea')))
    + (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='fk_fcc_fondo_linea') INTO objetos;
  IF col_ok=1 AND padre_ok=1 AND hijo_ok=1 AND fk_ok=1 AND objetos=5 THEN
    SET @c2a_huerfanos=NULL;
    SET @c2a_sql='SELECT COUNT(*) INTO @c2a_huerfanos FROM flota_combustible_cargas c LEFT JOIN tms_solicitud_fondo_lineas l ON l.empresa_id=c.empresa_id AND l.id=c.solicitud_fondo_linea_id WHERE c.solicitud_fondo_linea_id IS NOT NULL AND l.id IS NULL';
    PREPARE c2a_stmt FROM @c2a_sql;
    EXECUTE c2a_stmt;
    DEALLOCATE PREPARE c2a_stmt;
    IF @c2a_huerfanos<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: vinculos huerfanos'; END IF;
    SELECT 'NOOP' AS resultado;
  ELSEIF col_total=0 AND objetos=0 THEN
    ALTER TABLE tms_solicitud_fondo_lineas ADD UNIQUE KEY uq_fondolin_c2a_empresa_id (empresa_id,id);
    ALTER TABLE flota_combustible_cargas
      ADD COLUMN solicitud_fondo_linea_id INT NULL,
      ADD INDEX idx_fcc_fondo_linea (empresa_id,solicitud_fondo_linea_id),
      ADD CONSTRAINT fk_fcc_fondo_linea FOREIGN KEY (empresa_id,solicitud_fondo_linea_id)
        REFERENCES tms_solicitud_fondo_lineas(empresa_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT;
    SELECT 'APLICADO' AS resultado;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: contrato C2A divergente o parcial';
  END IF;
END$$
CALL migrate_combustible_c2a_fondos()$$
DROP PROCEDURE migrate_combustible_c2a_fondos$$
DELIMITER ;
