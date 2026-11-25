-- ETAPA 6: reemplazar trg_can_venta_bu (CREATE OR REPLACE: atomico, la tabla nunca queda sin trigger)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.
-- EN phpMyAdmin (pestana SQL) ponga el campo "Delimitador" en // antes de ejecutar. Cada sentencia de este archivo termina en //.
--

-- GUARDA: si falla, MariaDB responde error 1242 (o 1146 si falta una tabla requerida) en esta sentencia y NO se ejecuta nada de la etapa 6. Significa: ejecute 11-verificar-etapa5.sql
SELECT CASE WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=1 THEN 'GUARDA OK etapa 6' ELSE (SELECT 'DETENER: prerequisitos de la etapa 6 incompletos' UNION ALL SELECT 'ver ejecute 11-verificar-etapa5.sql') END AS guarda//

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
