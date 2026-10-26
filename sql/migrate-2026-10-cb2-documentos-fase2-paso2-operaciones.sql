-- PENDIENTE DE AUDITORIA. NO EJECUTADO. REQUIERE AUTORIZACION DDL SEPARADA.
-- PASO 2: una sola sentencia; ejecutar solo tras aprobar comprobacion del paso 1.
-- Base objetivo seleccionada; flag apagado. NO usar IF NOT EXISTS ni OR REPLACE.
-- PARAR tras cualquier resultado. Postcheck completo antes de activar.
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
