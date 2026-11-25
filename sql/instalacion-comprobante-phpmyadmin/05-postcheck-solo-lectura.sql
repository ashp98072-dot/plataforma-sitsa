-- POSTCHECK del comprobante de venta - solo lectura
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE, DATABASE() ni de la base seleccionada en phpMyAdmin: sirve con information_schema, mysql o ninguna).
-- SOLO LECTURA: cada SELECT devuelve (verificacion, resultado). Cualquier DETENER indica que NO debe continuar.
-- No use las huellas estructurales de la simplificacion como postcheck de este cambio: canecas_ventas tiene ahora dos columnas mas.
--

SELECT 'quien_lleva y quien_recibe VARCHAR(160) NULL' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('quien_lleva','quien_recibe') AND COLUMN_TYPE='varchar(160)' AND IS_NULLABLE='YES')=2, 'OK', 'DETENER') AS resultado;
SELECT 'trg_can_venta_bu exacto (simplificacion + quien_lleva/quien_recibe)' AS verificacion, IF((SELECT BINARY TRIM(REGEXP_REPLACE(REPLACE(ACTION_STATEMENT, CHAR(13), ''), '[[:space:]]+', ' ')) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME='trg_can_venta_bu' AND EVENT_OBJECT_TABLE='canecas_ventas' AND ACTION_TIMING='BEFORE' AND EVENT_MANIPULATION='UPDATE')=BINARY TRIM(REGEXP_REPLACE(REPLACE('BEGIN
  IF NOT (NEW.id <=> OLD.id)
    OR NOT (NEW.empresa_id <=> OLD.empresa_id)
    OR NOT (NEW.cliente_id <=> OLD.cliente_id)
    OR NOT (NEW.producto_id <=> OLD.producto_id)
    OR NOT (NEW.ubicacion_id <=> OLD.ubicacion_id)
    OR NOT (NEW.direccion_entrega <=> OLD.direccion_entrega)
    OR NOT (NEW.quien_lleva <=> OLD.quien_lleva)
    OR NOT (NEW.quien_recibe <=> OLD.quien_recibe)
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
    SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''CANECAS_VENTA_INMUTABLE'';
  END IF;
  IF OLD.estado = ''ANULADA'' AND (NOT (NEW.estado <=> OLD.estado) OR NOT (NEW.anulada_por <=> OLD.anulada_por) OR NOT (NEW.anulada_en <=> OLD.anulada_en) OR NOT (NEW.motivo_anulacion <=> OLD.motivo_anulacion)) THEN
    SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''CANECAS_VENTA_ANULADA_INMUTABLE'';
  END IF;
END', CHAR(13), ''), '[[:space:]]+', ' ')), 'OK', 'DETENER') AS resultado;
SELECT 'trg_can_venta_bd (no eliminar) presente' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME='trg_can_venta_bd' AND EVENT_OBJECT_TABLE='canecas_ventas')=1, 'OK', 'DETENER') AS resultado;
SELECT 'ventas con quien_lleva o quien_recibe' AS verificacion, CAST((SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_ventas WHERE quien_lleva IS NOT NULL OR quien_recibe IS NOT NULL) AS CHAR) AS resultado;
SELECT 'recuento canecas_ventas (igual al del preflight)' AS verificacion, CAST((SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_ventas) AS CHAR) AS resultado;
