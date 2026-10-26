-- PROPUESTA PENDIENTE DE AUDITORIA. NO EJECUTADA. NO AUTORIZA PRODUCCION.
-- Migración NUEVA, independiente: NO reutilizar la migración CB2 original.
-- Requiere preflight revisado, backup y autorización independiente de DDL.
-- CB2_DOCUMENTOS_FASE2 debe permanecer distinto de '1' en TODOS los nodos.
-- MariaDB 11.8. DDL hace COMMIT implícito: NO es atómico ni se reintenta a ciegas.
DELIMITER $$
BEGIN NOT ATOMIC
 IF DATABASE() IS NULL OR VERSION() NOT LIKE '11.8.%MariaDB%' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: esquema o motor no aprobado';
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_facturas' AND COLUMN_NAME='revision_documental')
 OR EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_documento_operaciones') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: objetos existentes; detener y auditar estado parcial/final';
 END IF;
 IF @@foreign_key_checks<>1 OR @@check_constraint_checks<>1 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: FK/CHECK deben estar activos';
 END IF;
 IF @@innodb_strict_mode<>1 OR (FIND_IN_SET('STRICT_ALL_TABLES',@@sql_mode)=0 AND FIND_IN_SET('STRICT_TRANS_TABLES',@@sql_mode)=0) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: requiere modo estricto';
 END IF;
 IF (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
  AND TABLE_NAME IN ('flota_cb2_facturas','compras_proveedores','usuarios','auditoria') AND ENGINE='InnoDB')<>4 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: tablas base InnoDB incompletas';
 END IF;
 IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
  AND ((TABLE_NAME='flota_cb2_facturas' AND COLUMN_NAME IN ('id','empresa_id','proveedor_id')) OR (TABLE_NAME='usuarios' AND COLUMN_NAME='id'))
  AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO')<>4 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: tipos FK incompatibles';
 END IF;
 IF NOT EXISTS (SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_facturas'
  GROUP BY INDEX_NAME HAVING MAX(NON_UNIQUE)=0 AND GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,proveedor_id,id') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CB2 documentos: falta UNIQUE compuesto de factura';
 END IF;
 ALTER TABLE flota_cb2_facturas
  ADD COLUMN revision_documental INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_cb2f_revision_documental CHECK (revision_documental>=0);
 CREATE TABLE flota_cb2_documento_operaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  factura_id INT NOT NULL,
  clave VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id INT NOT NULL,
  tipo VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_esperada INT NOT NULL,
  revision_resultante INT NOT NULL,
  resultado LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  creado_en DATETIME(6) NOT NULL,
  UNIQUE KEY uq_cb2do_clave (empresa_id,proveedor_id,clave),
  KEY ix_cb2do_factura (empresa_id,proveedor_id,factura_id,id),
  KEY ix_cb2do_usuario (usuario_id),
  CONSTRAINT fk_cb2do_factura FOREIGN KEY (empresa_id,proveedor_id,factura_id)
   REFERENCES flota_cb2_facturas(empresa_id,proveedor_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cb2do_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cb2do_clave CHECK (clave REGEXP '^[A-Za-z0-9_-]{16,64}$'),
  CONSTRAINT ck_cb2do_digest CHECK (digest REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_cb2do_tipo CHECK (tipo IN ('COMPLETAR','CORREGIR','SIN_CAMBIO')),
  CONSTRAINT ck_cb2do_ambito CHECK (empresa_id>0 AND proveedor_id>0 AND factura_id>0 AND usuario_id>0),
  CONSTRAINT ck_cb2do_revision CHECK (revision_esperada>=0 AND revision_esperada<=2147483646 AND
   ((tipo='SIN_CAMBIO' AND revision_resultante=revision_esperada) OR
    (tipo IN ('COMPLETAR','CORREGIR') AND revision_resultante=revision_esperada+1))),
  CONSTRAINT ck_cb2do_resultado CHECK (JSON_VALID(resultado)),
  CONSTRAINT ck_cb2do_respuesta CHECK (
   COALESCE(JSON_VALUE(resultado,'$.facturaId')=factura_id,0) AND
   COALESCE(JSON_VALUE(resultado,'$.revision')=revision_resultante,0) AND
   COALESCE(JSON_VALUE(resultado,'$.tipo')=tipo,0) AND
   COALESCE(JSON_VALUE(resultado,'$.moneda') IN ('GTQ','USD'),0))
 ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
END$$
DELIMITER ;
-- No activa funciones ni concede permisos. Ejecutar postcheck por separado
-- solo tras autorización. No elimina, rellena ni corrige datos documentales.
