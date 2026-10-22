-- SOLO LABORATORIO AISLADO: datos y esquema sinteticos; no ejecutar en bases existentes.
START TRANSACTION;
INSERT INTO flota_cb2_importaciones
(id,empresa_id,proveedor_id,proveedor_nombre,perfil,version_contrato,version_parser,
 archivo_nombre,archivo_ruta,archivo_mime,archivo_tamano,archivo_sha256,estado,revision,
 resumen_actual,creado_por,creado_en,actualizado_por,actualizado_en)
VALUES (1,1,1,'SINTETICO_A','HALEL',2,1,'sintetico.xlsx','fixture/no-existe',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,REPEAT('a',64),
 'COMPLETA',1,'{}',1,NOW(6),1,NOW(6));
INSERT INTO flota_cb2_facturas
(id,empresa_id,proveedor_id,serie,numero,serie_norm,numero_norm,moneda,creado_por,creado_en)
VALUES (1,1,1,'LAB','0001','LAB','0001','GTQ',1,NOW(6)),
 (2,1,2,'LAB','0002','LAB','0002','GTQ',1,NOW(6)),
 (3,2,3,'LAB','0003','LAB','0003','GTQ',1,NOW(6));
INSERT INTO flota_cb2_consumos
(id,empresa_id,proveedor_id,importacion_origen_id,vehiculo_id,factura_id,fecha_consumo,
 numero_vale,vale_norm,placa_original,placa_normalizada,version_clave,clave_candidata,
 version_huella,huella_operacion,payload_operacion,galones,precio,monto,galones_calculados,
 moneda,creado_por,creado_en,factura_asociada_por,factura_asociada_en)
VALUES (1,1,1,1,2,NULL,'2026-01-01','LAB-01','LAB-01','LAB000','LAB000',1,REPEAT('b',64),
 1,REPEAT('c',64),'{}',10,30,300,0,'GTQ',1,NOW(6),NULL,NULL);
INSERT INTO flota_cb2_filas
(id,empresa_id,proveedor_id,importacion_id,revision,origen_fila_id,tipo,marca_origen,
 consumo_id,operacion_tipo,operacion_clave,solicitud_sha256,operacion_ordinal,operacion_total,
 hoja_indice,hoja_nombre,fila_excel,resultado,datos_origen,decision,motivo,usuario_id,creado_en)
VALUES (1,1,1,1,1,NULL,'ORIGEN',1,1,'CONFIRMAR','LAB_CONFIRMAR_0001',REPEAT('d',64),1,1,
 1,'LAB',2,'CREADA','{"sintetico":true}','{}','fixture',1,NOW(6));
COMMIT;
SELECT estado_factura FROM flota_cb2_consumos WHERE id=1;
