-- ETAPA 2: trg_can_venta_bu tambien protege quien_lleva y quien_recibe (CREATE OR REPLACE, atomico)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE, DATABASE() ni de la base seleccionada en phpMyAdmin: sirve con information_schema, mysql o ninguna).
-- ETAPA DE ESCRITURA. Requisitos: respaldo restaurable verificado y autorizacion expresa del responsable.
-- Pegue y ejecute TODO el archivo en UNA sola peticion. Si hay un error, DETENGASE y no avance a otra etapa.
-- EN phpMyAdmin (pestana SQL) ponga el campo "Delimitador" en // antes de ejecutar. Cada sentencia termina en //.
-- GUARDA INTRINSECA: el trigger va dentro de un PREPARE condicionado; si faltan las columnas o el trigger de la simplificacion, se ejecuta una subconsulta que falla (1242) y NO se reemplaza nada.
-- Es el trigger de la simplificacion (#689) mas dos comparaciones NEW/OLD; no se cambia ninguna otra restriccion ni la politica de inmutabilidad existente.
--

SET @etapa_sql = IF(
(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('quien_lleva','quien_recibe'))=2 AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME='trg_can_venta_bu' AND EVENT_OBJECT_TABLE='canecas_ventas' AND ACTION_STATEMENT LIKE '%CANECAS_VENTA_ANULADA_INMUTABLE%' AND ACTION_STATEMENT LIKE '%NEW.direccion_entrega%')=1 AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME='trg_can_venta_bd' AND EVENT_OBJECT_TABLE='canecas_ventas')=1,
'CREATE OR REPLACE TRIGGER `u611730801_Plataforma`.trg_can_venta_bu
BEFORE UPDATE ON `u611730801_Plataforma`.canecas_ventas
FOR EACH ROW
BEGIN
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
END',
'SELECT (SELECT ''DETENER: faltan las columnas del comprobante o el trigger de la simplificacion'' UNION ALL SELECT ''ejecute 03-verificar-etapa1-solo-lectura.sql y revise cada fila'')')//
PREPARE etapa_stmt FROM @etapa_sql//
EXECUTE etapa_stmt//
SHOW WARNINGS//
DEALLOCATE PREPARE etapa_stmt//
--
-- Reversion (solo con autorizacion): restaurar el trigger de la simplificacion con el CREATE OR REPLACE TRIGGER de
-- sql/migrate-2026-11-canecas-simplificacion-wip.sql calificando `u611730801_Plataforma`. Las columnas solo se eliminan
-- (ALTER TABLE `u611730801_Plataforma`.canecas_ventas DROP COLUMN quien_lleva, DROP COLUMN quien_recibe) si no hay datos que conservar.
