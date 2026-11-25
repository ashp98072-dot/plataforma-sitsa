-- ETAPA 6: reemplazar trg_can_venta_bu (CREATE OR REPLACE: atomico, la tabla nunca queda sin trigger)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- Pegue y ejecute TODO el archivo en UNA sola peticion: fija y verifica en esa misma sesion SQL estricto e innodb_strict_mode y los restaura al final. No desactiva claves foraneas ni CHECK.
-- Si cualquier sentencia da error, DETENGASE: no continue con otra etapa y use 15-recuperacion-solo-lectura.sql. Nunca avance tras un error.
-- EN phpMyAdmin (pestana SQL) ponga el campo "Delimitador" en // antes de ejecutar. Cada sentencia de este archivo termina en //.
-- LIMITE CONOCIDO: MariaDB no admite CREATE TRIGGER dentro de PREPARE, por eso esta etapa NO tiene guarda intrinseca. Ejecutela SOLO despues de que 11-verificar-etapa5.sql muestre todo OK y, si 00-prueba-comportamiento-errores-solo-lectura.sql indico que phpMyAdmin continua tras un error, con especial cuidado.
--

SET @sql_mode_previo = @@SESSION.sql_mode, @innodb_strict_previo = @@SESSION.innodb_strict_mode//
SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0, @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES'))//
SET SESSION innodb_strict_mode = 1//
SELECT CASE WHEN @@SESSION.foreign_key_checks = 1 AND @@SESSION.check_constraint_checks = 1 AND @@SESSION.innodb_strict_mode = 1 AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0) AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=1 THEN 'GUARDA OK etapa 6' ELSE (SELECT 'DETENER: prerequisitos o modos de sesion de la etapa 6 incompletos' UNION ALL SELECT 'ejecute 11-verificar-etapa5.sql y revise cada fila') END AS guarda//
CREATE OR REPLACE TRIGGER `u611730801_Plataforma`.trg_can_venta_bu
BEFORE UPDATE ON `u611730801_Plataforma`.canecas_ventas FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
    OR NOT (NEW.empresa_id <=> OLD.empresa_id)
    OR NOT (NEW.cliente_id <=> OLD.cliente_id)
    OR NOT (NEW.producto_id <=> OLD.producto_id)
    OR NOT (NEW.ubicacion_id <=> OLD.ubicacion_id)
    OR NOT (NEW.direccion_entrega <=> OLD.direccion_entrega)
    OR NOT (NEW.fecha_venta <=> OLD.fecha_venta)
    OR NOT (NEW.documento <=> OLD.documento)
    OR NOT (NEW.cantidad <=> OLD.cantidad)
    OR NOT (NEW.precio_unitario_centavos <=> OLD.precio_unitario_centavos)
    OR NOT (NEW.total_centavos <=> OLD.total_centavos)
    OR NOT (NEW.costo_centavos <=> OLD.costo_centavos)
    OR NOT (NEW.moneda <=> OLD.moneda)
    OR NOT (NEW.salida_id <=> OLD.salida_id)
    OR NOT (NEW.clave_operacion <=> OLD.clave_operacion)
    OR NOT (NEW.creado_por <=> OLD.creado_por)
    OR NOT (NEW.creado_en <=> OLD.creado_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_INMUTABLE';
  END IF;
  IF OLD.estado = 'ANULADA' AND (NOT (NEW.estado <=> OLD.estado) OR NOT (NEW.anulada_por <=> OLD.anulada_por) OR NOT (NEW.anulada_en <=> OLD.anulada_en) OR NOT (NEW.motivo_anulacion <=> OLD.motivo_anulacion)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_ANULADA_INMUTABLE';
  END IF;
END//
SHOW WARNINGS//
SET SESSION sql_mode = @sql_mode_previo//
SET SESSION innodb_strict_mode = @innodb_strict_previo//
