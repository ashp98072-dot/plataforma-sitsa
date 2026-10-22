-- SOLO LABORATORIO AISLADO: datos y esquema sinteticos; no ejecutar en bases existentes.
START TRANSACTION;
SELECT datos_origen INTO @original FROM flota_cb2_filas WHERE id=1;
UPDATE flota_cb2_importaciones SET revision=2,actualizado_en=NOW(6) WHERE id=1;
UPDATE flota_cb2_consumos SET factura_id=1,factura_asociada_por=1,factura_asociada_en=NOW(6) WHERE id=1;
INSERT INTO flota_cb2_filas
(id,empresa_id,proveedor_id,importacion_id,revision,origen_fila_id,tipo,marca_origen,
 consumo_id,operacion_tipo,operacion_clave,solicitud_sha256,operacion_ordinal,operacion_total,
 hoja_indice,hoja_nombre,fila_excel,resultado,datos_origen,decision,motivo,usuario_id,creado_en)
VALUES (2,1,1,1,2,1,'RESOLUCION',NULL,1,'REANUDAR','LAB_REANUDAR_0001',REPEAT('e',64),1,2,
 1,'LAB',2,'REUTILIZADA',NULL,'{}','fixture',1,NOW(6));
INSERT INTO flota_cb2_filas
(id,empresa_id,proveedor_id,importacion_id,revision,origen_fila_id,tipo,marca_origen,
 consumo_id,factura_anterior_id,factura_nueva_id,operacion_tipo,operacion_clave,solicitud_sha256,
 operacion_ordinal,operacion_total,hoja_indice,hoja_nombre,fila_excel,resultado,datos_origen,
 decision,motivo,usuario_id,creado_en)
VALUES (3,1,1,1,2,1,'ASOCIACION_FACTURA',NULL,1,NULL,1,'REANUDAR','LAB_REANUDAR_0001',
 REPEAT('e',64),2,2,1,'LAB',2,'FACTURA_ASOCIADA',NULL,'{}','fixture',1,NOW(6));
COMMIT;
SELECT estado_factura, factura_id FROM flota_cb2_consumos WHERE id=1;
SELECT COUNT(*) FROM flota_cb2_filas WHERE importacion_id=1 AND revision=2 AND hoja_indice=1 AND fila_excel=2;
SELECT BINARY datos_origen = BINARY @original FROM flota_cb2_filas WHERE id=1;
SELECT COUNT(*),COUNT(DISTINCT consumo_id) FROM flota_cb2_filas;
