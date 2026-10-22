-- PROPUESTA PR 2. NO EJECUTADA. MariaDB 11.8.x; pendiente de auditoria y autorizacion.
-- Requiere SET @cb2_schema = nombre explicito del esquema objetivo en esta misma sesion.
-- Sin fallback a DATABASE(); metadata completamente visible y sin escrituras/DDL concurrentes.
-- Cualquier error deja el resultado SIN CERTIFICAR. No cambiar variables para forzar compatibilidad.
-- Sin escrituras persistentes: SELECT y PREPARE/EXECUTE de un SELECT constante.
-- METADATA FINAL no certifica los datos; RESULTADO FINAL exige todas las incidencias en cero.
SELECT NULL, NULL INTO @cb2_base_ok, @cb2_estado;
-- BEGIN CB2_METADATA_CANONICO
-- Cruces textuales: convertir ambos operandos; no heredar cotejamientos de information_schema.
-- utf8mb4_bin conserva diferencias de mayusculas y acentos del contrato.
WITH
columnas_esperadas AS (
SELECT j.* FROM JSON_TABLE('[
  ["BASE","empresas","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","usuarios","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","compras_proveedores","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","flota_vehiculos","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","flota_combustible_cargas","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","flota_combustible_conciliaciones","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","flota_combustible_conciliacion_filas","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","auditoria","id","bigint",null,null,null,null,"NO","auto_increment",null,null,null],
  ["BASE","compras_proveedores","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_vehiculos","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_vehiculo_acceso","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_combustible_cargas","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_combustible_conciliaciones","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_combustible_conciliacion_filas","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_vehiculo_acceso","vehiculo_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_combustible_conciliacion_filas","conciliacion_id","int",null,null,null,null,"NO","",null,null,null],
  ["BASE","flota_combustible_conciliaciones","proveedor_id","int",null,null,null,null,"YES","",null,null,null],
  ["BASE","flota_combustible_conciliaciones","perfil_parser","varchar",40,null,null,null,"YES","",null,null,null],
  ["BASE","flota_combustible_conciliacion_filas","clave_operacion","char",64,null,null,null,"YES","",null,null,null],
  ["BASE","compras_proveedores","nombre_comercial","varchar",200,null,null,null,"NO","",null,null,null],
  ["BASE","compras_proveedores","activo","tinyint",null,null,null,null,"NO","",null,null,null],
  ["BASE","empresas","activa","tinyint",null,null,null,null,"NO","",null,null,null],
  ["BASE","usuarios","activo","tinyint",null,null,null,null,"NO","",null,null,null],
  ["BASE","auditoria","empresa_id","int",null,null,null,null,"YES","",null,null,null],
  ["BASE","auditoria","usuario","varchar",100,null,null,null,"YES","",null,null,null],
  ["BASE","auditoria","accion","varchar",80,null,null,null,"NO","",null,null,null],
  ["BASE","auditoria","modulo","varchar",40,null,null,null,"YES","",null,null,null],
  ["BASE","auditoria","detalle","text",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["NUEVO","flota_cb2_importaciones","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","proveedor_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","proveedor_nombre","varchar",200,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","perfil","varchar",10,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","version_contrato","smallint",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","version_parser","smallint",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","archivo_nombre","varchar",255,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","archivo_ruta","varchar",400,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","archivo_mime","varchar",100,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","archivo_tamano","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","archivo_sha256","char",64,null,null,null,"NO","","ascii","ascii_bin",null],
  ["NUEVO","flota_cb2_importaciones","estado","varchar",20,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","revision","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","resumen_actual","longtext",null,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_importaciones","creado_por","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","creado_en","datetime",null,null,null,6,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","actualizado_por","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_importaciones","actualizado_en","datetime",null,null,null,6,"NO","",null,null,null],
  ["NUEVO","flota_cb2_facturas","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["NUEVO","flota_cb2_facturas","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_facturas","proveedor_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_facturas","serie","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_facturas","numero","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_facturas","serie_norm","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_facturas","numero_norm","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_facturas","fecha_factura","date",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_facturas","moneda","char",3,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_facturas","total_documental","decimal",null,18,6,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_facturas","creado_por","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_facturas","creado_en","datetime",null,null,null,6,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["NUEVO","flota_cb2_consumos","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","proveedor_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","importacion_origen_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","vehiculo_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","factura_id","int",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_consumos","estado_factura","varchar",20,null,null,null,"YES","STORED GENERATED","utf8mb4","utf8mb4_bin","case when factura_id is null then ''PENDIENTE_FACTURA'' else ''FACTURADO'' end"],
  ["NUEVO","flota_cb2_consumos","fecha_consumo","date",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","numero_vale","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","vale_norm","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","placa_original","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","placa_normalizada","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","version_clave","smallint",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","clave_candidata","char",64,null,null,null,"NO","","ascii","ascii_bin",null],
  ["NUEVO","flota_cb2_consumos","version_huella","smallint",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","huella_operacion","char",64,null,null,null,"NO","","ascii","ascii_bin",null],
  ["NUEVO","flota_cb2_consumos","payload_operacion","longtext",null,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","piloto_informado","varchar",255,null,null,null,"YES","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","producto","varchar",100,null,null,null,"YES","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","galones","decimal",null,18,6,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","precio","decimal",null,18,6,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","monto","decimal",null,18,6,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","kilometraje","decimal",null,15,3,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_consumos","kilometraje_texto","varchar",128,null,null,null,"YES","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","galones_calculados","tinyint",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","moneda","char",3,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_consumos","creado_por","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","creado_en","datetime",null,null,null,6,"NO","",null,null,null],
  ["NUEVO","flota_cb2_consumos","factura_asociada_por","int",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_consumos","factura_asociada_en","datetime",null,null,null,6,"YES","",null,null,null],
  ["NUEVO","flota_cb2_filas","id","int",null,null,null,null,"NO","auto_increment",null,null,null],
  ["NUEVO","flota_cb2_filas","empresa_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","proveedor_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","importacion_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","revision","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","origen_fila_id","int",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_filas","tipo","varchar",24,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","marca_origen","tinyint",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_filas","consumo_id","int",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_filas","factura_anterior_id","int",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_filas","factura_nueva_id","int",null,null,null,null,"YES","",null,null,null],
  ["NUEVO","flota_cb2_filas","operacion_tipo","varchar",24,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","operacion_clave","varchar",64,null,null,null,"NO","","ascii","ascii_bin",null],
  ["NUEVO","flota_cb2_filas","solicitud_sha256","char",64,null,null,null,"NO","","ascii","ascii_bin",null],
  ["NUEVO","flota_cb2_filas","operacion_ordinal","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","operacion_total","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","hoja_indice","smallint",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","hoja_nombre","varchar",128,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","fila_excel","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","resultado","varchar",24,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","datos_origen","longtext",null,null,null,null,"YES","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","decision","longtext",null,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","motivo","varchar",1000,null,null,null,"NO","","utf8mb4","utf8mb4_bin",null],
  ["NUEVO","flota_cb2_filas","usuario_id","int",null,null,null,null,"NO","",null,null,null],
  ["NUEVO","flota_cb2_filas","creado_en","datetime",null,null,null,6,"NO","",null,null,null]
]', '$[*]' COLUMNS(
 ambito VARCHAR(8) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 tipo VARCHAR(20) PATH '$[3]', longitud INT PATH '$[4]', precision_n INT PATH '$[5]',
 escala INT PATH '$[6]', precision_t INT PATH '$[7]', nulo VARCHAR(3) PATH '$[8]',
 extra VARCHAR(40) PATH '$[9]', charset_n VARCHAR(32) PATH '$[10]',
 collation_n VARCHAR(64) PATH '$[11]', generacion TEXT PATH '$[12]')) AS j
),
indices_esperados AS (
SELECT j.* FROM JSON_TABLE('[
  ["BASE","empresas","PRIMARY","id",0],
  ["BASE","usuarios","PRIMARY","id",0],
  ["BASE","compras_proveedores","PRIMARY","id",0],
  ["BASE","flota_vehiculos","PRIMARY","id",0],
  ["BASE","flota_combustible_cargas","PRIMARY","id",0],
  ["BASE","flota_combustible_conciliaciones","PRIMARY","id",0],
  ["BASE","flota_combustible_conciliacion_filas","PRIMARY","id",0],
  ["BASE","auditoria","PRIMARY","id",0],
  ["BASE","compras_proveedores","uq_compras_proveedor_empresa","empresa_id,id",0],
  ["BASE","flota_vehiculos","uq_multas_vehiculo_empresa_id","empresa_id,id",0],
  ["BASE","flota_vehiculo_acceso","PRIMARY","vehiculo_id,empresa_id",0],
  ["BASE","flota_combustible_conciliaciones","uq_fcci_archivo","empresa_id,proveedor_id,archivo_sha256",0],
  ["BASE","flota_combustible_conciliaciones","uq_fcci_empresa_id","empresa_id,id",0],
  ["BASE","flota_combustible_conciliacion_filas","uq_fccif_empresa_import_id","empresa_id,conciliacion_id,id",0],
  ["BASE","flota_combustible_conciliacion_filas","idx_fccif_clave","empresa_id,clave_operacion",1],
  ["NUEVO","flota_cb2_importaciones","PRIMARY","id",0],
  ["NUEVO","flota_cb2_importaciones","uq_cb2i_ambito","empresa_id,proveedor_id,id",0],
  ["NUEVO","flota_cb2_importaciones","uq_cb2i_archivo","empresa_id,proveedor_id,archivo_sha256",0],
  ["NUEVO","flota_cb2_importaciones","idx_cb2i_historial","empresa_id,creado_en,id",1],
  ["NUEVO","flota_cb2_importaciones","ix_fk_cb2i_creador","creado_por",1],
  ["NUEVO","flota_cb2_importaciones","ix_fk_cb2i_editor","actualizado_por",1],
  ["NUEVO","flota_cb2_facturas","PRIMARY","id",0],
  ["NUEVO","flota_cb2_facturas","uq_cb2f_ambito","empresa_id,proveedor_id,id",0],
  ["NUEVO","flota_cb2_facturas","uq_cb2f_documento","empresa_id,proveedor_id,serie_norm,numero_norm",0],
  ["NUEVO","flota_cb2_facturas","idx_cb2f_fecha","empresa_id,proveedor_id,fecha_factura",1],
  ["NUEVO","flota_cb2_facturas","ix_fk_cb2f_creador","creado_por",1],
  ["NUEVO","flota_cb2_consumos","PRIMARY","id",0],
  ["NUEVO","flota_cb2_consumos","uq_cb2c_ambito","empresa_id,proveedor_id,id",0],
  ["NUEVO","flota_cb2_consumos","uq_cb2c_huella","empresa_id,proveedor_id,huella_operacion",0],
  ["NUEVO","flota_cb2_consumos","idx_cb2c_candidato","empresa_id,proveedor_id,clave_candidata",1],
  ["NUEVO","flota_cb2_consumos","idx_cb2c_proveedor_fecha","empresa_id,proveedor_id,fecha_consumo",1],
  ["NUEVO","flota_cb2_consumos","idx_cb2c_vehiculo_fecha","empresa_id,vehiculo_id,fecha_consumo",1],
  ["NUEVO","flota_cb2_consumos","idx_cb2c_factura","empresa_id,proveedor_id,factura_id",1],
  ["NUEVO","flota_cb2_consumos","idx_cb2c_estado","empresa_id,estado_factura,fecha_consumo",1],
  ["NUEVO","flota_cb2_consumos","ix_fk_cb2c_importacion","empresa_id,proveedor_id,importacion_origen_id",1],
  ["NUEVO","flota_cb2_consumos","ix_fk_cb2c_vehiculo","vehiculo_id",1],
  ["NUEVO","flota_cb2_consumos","ix_fk_cb2c_creador","creado_por",1],
  ["NUEVO","flota_cb2_consumos","ix_fk_cb2c_asociador","factura_asociada_por",1],
  ["NUEVO","flota_cb2_filas","PRIMARY","id",0],
  ["NUEVO","flota_cb2_filas","uq_cb2l_ambito","empresa_id,proveedor_id,id",0],
  ["NUEVO","flota_cb2_filas","uq_cb2l_origen_fk","empresa_id,proveedor_id,importacion_id,id",0],
  ["NUEVO","flota_cb2_filas","uq_cb2l_operacion","empresa_id,proveedor_id,operacion_tipo,operacion_clave,operacion_ordinal",0],
  ["NUEVO","flota_cb2_filas","idx_cb2l_consumo","empresa_id,proveedor_id,consumo_id",1],
  ["NUEVO","flota_cb2_filas","idx_cb2l_origen","empresa_id,proveedor_id,importacion_id,origen_fila_id",1],
  ["NUEVO","flota_cb2_filas","ix_fk_cb2l_factura_anterior","empresa_id,proveedor_id,factura_anterior_id",1],
  ["NUEVO","flota_cb2_filas","ix_fk_cb2l_factura_nueva","empresa_id,proveedor_id,factura_nueva_id",1],
  ["NUEVO","flota_cb2_filas","ix_fk_cb2l_usuario","usuario_id",1],
  ["NUEVO","flota_cb2_filas","idx_cb2l_hoja_revision","empresa_id,proveedor_id,importacion_id,revision,hoja_indice,fila_excel,id",1],
  ["NUEVO","flota_cb2_filas","uq_cb2l_original_posicion","empresa_id,proveedor_id,importacion_id,marca_origen,hoja_indice,fila_excel",0]
]', '$[*]' COLUMNS(
 ambito VARCHAR(8) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 columnas VARCHAR(600) PATH '$[3]', no_unico INT PATH '$[4]')) AS j
),
fks_esperadas AS (
SELECT j.* FROM JSON_TABLE('[
  ["BASE","flota_combustible_conciliaciones","fk_fcci_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],
  ["BASE","flota_combustible_conciliacion_filas","fk_fccif_importacion","empresa_id,conciliacion_id","flota_combustible_conciliaciones","empresa_id,id"],
  ["BASE","compras_proveedores","fk_cb_proveedores_empresa","empresa_id","empresas","id"],
  ["NUEVO","flota_cb2_importaciones","fk_cb2i_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],
  ["NUEVO","flota_cb2_importaciones","fk_cb2i_creador","creado_por","usuarios","id"],
  ["NUEVO","flota_cb2_importaciones","fk_cb2i_editor","actualizado_por","usuarios","id"],
  ["NUEVO","flota_cb2_facturas","fk_cb2f_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],
  ["NUEVO","flota_cb2_facturas","fk_cb2f_creador","creado_por","usuarios","id"],
  ["NUEVO","flota_cb2_consumos","fk_cb2c_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],
  ["NUEVO","flota_cb2_consumos","fk_cb2c_importacion","empresa_id,proveedor_id,importacion_origen_id","flota_cb2_importaciones","empresa_id,proveedor_id,id"],
  ["NUEVO","flota_cb2_consumos","fk_cb2c_factura","empresa_id,proveedor_id,factura_id","flota_cb2_facturas","empresa_id,proveedor_id,id"],
  ["NUEVO","flota_cb2_consumos","fk_cb2c_vehiculo","vehiculo_id","flota_vehiculos","id"],
  ["NUEVO","flota_cb2_consumos","fk_cb2c_creador","creado_por","usuarios","id"],
  ["NUEVO","flota_cb2_consumos","fk_cb2c_asociador","factura_asociada_por","usuarios","id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_importacion","empresa_id,proveedor_id,importacion_id","flota_cb2_importaciones","empresa_id,proveedor_id,id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_consumo","empresa_id,proveedor_id,consumo_id","flota_cb2_consumos","empresa_id,proveedor_id,id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_original","empresa_id,proveedor_id,importacion_id,origen_fila_id","flota_cb2_filas","empresa_id,proveedor_id,importacion_id,id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_factura_anterior","empresa_id,proveedor_id,factura_anterior_id","flota_cb2_facturas","empresa_id,proveedor_id,id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_factura_nueva","empresa_id,proveedor_id,factura_nueva_id","flota_cb2_facturas","empresa_id,proveedor_id,id"],
  ["NUEVO","flota_cb2_filas","fk_cb2l_usuario","usuario_id","usuarios","id"]
]', '$[*]' COLUMNS(
 ambito VARCHAR(8) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 columnas VARCHAR(600) PATH '$[3]', padre VARCHAR(64) PATH '$[4]', destino VARCHAR(600) PATH '$[5]')) AS j
),
checks_esperados AS (
SELECT j.* FROM JSON_TABLE('[
  ["flota_cb2_importaciones","ck_importaciones_resumen_actual","json_valid(resumen_actual)"],
  ["flota_cb2_importaciones","ck_cb2i_perfil","perfil in (''HALEL'',''SHELL'')"],
  ["flota_cb2_importaciones","ck_cb2i_version","version_contrato = 2 and version_parser >= 1"],
  ["flota_cb2_importaciones","ck_cb2i_estado","estado in (''COMPLETA'',''PARCIAL'',''SOLO_EVIDENCIA'')"],
  ["flota_cb2_importaciones","ck_cb2i_revision","revision >= 1"],
  ["flota_cb2_importaciones","ck_cb2i_tamano","archivo_tamano > 0 and archivo_tamano <= 52428800"],
  ["flota_cb2_facturas","ck_cb2f_identidad","char_length(trim(serie_norm)) > 0 and char_length(trim(numero_norm)) > 0"],
  ["flota_cb2_facturas","ck_cb2f_total","total_documental is null or total_documental >= 0"],
  ["flota_cb2_consumos","ck_consumos_payload_operacion","json_valid(payload_operacion)"],
  ["flota_cb2_consumos","ck_cb2c_vale","char_length(trim(vale_norm)) > 0"],
  ["flota_cb2_consumos","ck_cb2c_version","version_clave = 1 and version_huella = 1"],
  ["flota_cb2_consumos","ck_cb2c_importes","galones > 0 and precio > 0 and monto > 0"],
  ["flota_cb2_consumos","ck_cb2c_km","kilometraje is null or kilometraje >= 0"],
  ["flota_cb2_consumos","ck_cb2c_calculados","galones_calculados in (0,1)"],
  ["flota_cb2_consumos","ck_cb2c_asociacion","factura_id is null and factura_asociada_por is null and factura_asociada_en is null or factura_id is not null and factura_asociada_por is not null and factura_asociada_en is not null"],
  ["flota_cb2_filas","ck_filas_datos_origen","datos_origen is null or json_valid(datos_origen)"],
  ["flota_cb2_filas","ck_filas_decision","json_valid(decision)"],
  ["flota_cb2_filas","ck_cb2l_tipo","tipo in (''ORIGEN'',''RESOLUCION'',''ASOCIACION_FACTURA'')"],
  ["flota_cb2_filas","ck_cb2l_operacion","operacion_tipo in (''CONFIRMAR'',''REANUDAR'',''ASOCIAR_FACTURA'')"],
  ["flota_cb2_filas","ck_cb2l_posicion","revision >= 1 and operacion_ordinal >= 1 and hoja_indice between 1 and 20 and fila_excel between 1 and 5000"],
  ["flota_cb2_filas","ck_cb2l_payload","tipo = ''ORIGEN'' and origen_fila_id is null and datos_origen is not null and revision = 1 and operacion_tipo = ''CONFIRMAR'' or tipo = ''RESOLUCION'' and origen_fila_id is not null and datos_origen is null and revision > 1 and operacion_tipo = ''REANUDAR'' or tipo = ''ASOCIACION_FACTURA'' and origen_fila_id is not null and datos_origen is null and revision > 1 and operacion_tipo in (''REANUDAR'',''ASOCIAR_FACTURA'')"],
  ["flota_cb2_filas","ck_cb2l_resultado","resultado in (''CREADA'',''REUTILIZADA'',''BLOQUEADA'',''INVALIDA'',''IGNORADA'',''OMITIDA'',''FACTURA_ASOCIADA'',''SIN_CAMBIO'')"],
  ["flota_cb2_filas","ck_cb2l_consumo","resultado in (''CREADA'',''REUTILIZADA'',''FACTURA_ASOCIADA'',''SIN_CAMBIO'') and consumo_id is not null or resultado in (''BLOQUEADA'',''INVALIDA'',''IGNORADA'',''OMITIDA'') and consumo_id is null"],
  ["flota_cb2_filas","ck_cb2l_documento","tipo = ''ASOCIACION_FACTURA'' and factura_nueva_id is not null and (resultado = ''FACTURA_ASOCIADA'' and factura_anterior_id is null or resultado = ''SIN_CAMBIO'' and factura_anterior_id is not null and factura_anterior_id = factura_nueva_id) or tipo <> ''ASOCIACION_FACTURA'' and resultado in (''CREADA'',''REUTILIZADA'',''BLOQUEADA'',''INVALIDA'',''IGNORADA'',''OMITIDA'') and factura_anterior_id is null and factura_nueva_id is null"],
  ["flota_cb2_filas","ck_cb2l_marca_origen","tipo = ''ORIGEN'' and marca_origen is not null and marca_origen = 1 or tipo <> ''ORIGEN'' and marca_origen is null"],
  ["flota_cb2_filas","ck_cb2l_idempotencia","operacion_clave regexp ''^[A-Za-z0-9_-]{16,64}$'' and solicitud_sha256 regexp ''^[0-9a-f]{64}$'' and operacion_total between 1 and 10000 and operacion_ordinal between 1 and operacion_total"]
]', '$[*]' COLUMNS(
 tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', expresion TEXT PATH '$[2]')) AS j
),
indices_reales AS (
SELECT TABLE_NAME AS tabla, INDEX_NAME AS nombre,
 GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas,
 MAX(NON_UNIQUE) AS no_unico, COUNT(*) AS numero_columnas,
 SUM(SUB_PART IS NOT NULL OR INDEX_TYPE <> 'BTREE'
     OR COALESCE(COLLATION, '') <> 'A' OR IGNORED <> 'NO') AS incompatibles
FROM information_schema.STATISTICS
WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin
GROUP BY TABLE_NAME, INDEX_NAME
),
fks_reales AS (
SELECT k.TABLE_NAME AS tabla, k.CONSTRAINT_NAME AS nombre,
 GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS columnas,
 COUNT(*) AS numero_columnas, MAX(k.REFERENCED_TABLE_NAME) AS padre,
 MAX(k.REFERENCED_TABLE_SCHEMA) AS esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS destino,
 MAX(r.DELETE_RULE) AS borrar, MAX(r.UPDATE_RULE) AS actualizar
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
 ON CONVERT(r.CONSTRAINT_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(k.CONSTRAINT_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.TABLE_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(k.TABLE_NAME USING utf8mb4) COLLATE utf8mb4_bin
 AND CONVERT(r.CONSTRAINT_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(k.CONSTRAINT_NAME USING utf8mb4) COLLATE utf8mb4_bin
WHERE CONVERT(k.CONSTRAINT_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin
GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME
),
verificaciones AS (
SELECT e.ambito, CONCAT('columna:', e.tabla, '.', e.nombre) AS objeto,
 COALESCE(
  CONVERT(c.DATA_TYPE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.tipo USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(c.IS_NULLABLE USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.nulo USING utf8mb4) COLLATE utf8mb4_bin
  AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND CONVERT(c.EXTRA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.extra USING utf8mb4) COLLATE utf8mb4_bin
  AND (e.longitud IS NULL OR c.CHARACTER_MAXIMUM_LENGTH = e.longitud)
  AND (e.precision_n IS NULL OR c.NUMERIC_PRECISION = e.precision_n)
  AND (e.escala IS NULL OR c.NUMERIC_SCALE = e.escala)
  AND (e.precision_t IS NULL OR c.DATETIME_PRECISION = e.precision_t)
  AND (e.charset_n IS NULL OR CONVERT(c.CHARACTER_SET_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.charset_n USING utf8mb4) COLLATE utf8mb4_bin)
  AND (e.collation_n IS NULL OR CONVERT(c.COLLATION_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.collation_n USING utf8mb4) COLLATE utf8mb4_bin)
  AND (e.ambito = 'BASE' OR c.COLUMN_DEFAULT IS NULL OR c.COLUMN_DEFAULT = 'NULL')
  AND (e.generacion IS NULL OR REGEXP_REPLACE(CONVERT(c.GENERATION_EXPRESSION USING utf8mb4), CONVERT(UNHEX('27283f3a27277c5c5c2e7c5b5e275c5c5d292a27282a534b495029282a46297c5b5b3a73706163653a5d605d2b') USING utf8mb4), '') COLLATE utf8mb4_bin = REGEXP_REPLACE(CONVERT(e.generacion USING utf8mb4), CONVERT(UNHEX('27283f3a27277c5c5c2e7c5b5e275c5c5d292a27282a534b495029282a46297c5b5b3a73706163653a5d605d2b') USING utf8mb4), '') COLLATE utf8mb4_bin),
  0
 ) AS ok
FROM columnas_esperadas AS e
LEFT JOIN information_schema.COLUMNS AS c
 ON CONVERT(c.TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(c.TABLE_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.tabla USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(c.COLUMN_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.nombre USING utf8mb4) COLLATE utf8mb4_bin
UNION ALL
SELECT e.ambito, CONCAT('indice:', e.tabla, '.', e.nombre),
 COALESCE(CONVERT(r.columnas USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.columnas USING utf8mb4) COLLATE utf8mb4_bin AND r.numero_columnas = 1 + CHAR_LENGTH(e.columnas) - CHAR_LENGTH(REPLACE(e.columnas, ',', ''))
  AND r.no_unico = e.no_unico AND r.incompatibles = 0, 0)
FROM indices_esperados AS e
LEFT JOIN indices_reales AS r ON CONVERT(r.tabla USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.tabla USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.nombre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.nombre USING utf8mb4) COLLATE utf8mb4_bin
UNION ALL
SELECT e.ambito, CONCAT('fk:', e.tabla, '.', e.nombre),
 COALESCE(CONVERT(r.columnas USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.columnas USING utf8mb4) COLLATE utf8mb4_bin AND r.numero_columnas = 1 + CHAR_LENGTH(e.columnas) - CHAR_LENGTH(REPLACE(e.columnas, ',', ''))
  AND CONVERT(r.padre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.padre USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.destino USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.destino USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.esquema_padre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin
  AND r.borrar = 'RESTRICT' AND r.actualizar = 'RESTRICT', 0)
FROM fks_esperadas AS e
LEFT JOIN fks_reales AS r ON CONVERT(r.tabla USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.tabla USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.nombre USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.nombre USING utf8mb4) COLLATE utf8mb4_bin
UNION ALL
SELECT 'NUEVO', CONCAT('check:', e.tabla, '.', e.nombre),
 COALESCE(REGEXP_REPLACE(CONVERT(r.CHECK_CLAUSE USING utf8mb4), CONVERT(UNHEX('27283f3a27277c5c5c2e7c5b5e275c5c5d292a27282a534b495029282a46297c5b5b3a73706163653a5d605d2b') USING utf8mb4), '') COLLATE utf8mb4_bin = REGEXP_REPLACE(CONVERT(e.expresion USING utf8mb4), CONVERT(UNHEX('27283f3a27277c5c5c2e7c5b5e275c5c5d292a27282a534b495029282a46297c5b5b3a73706163653a5d605d2b') USING utf8mb4), '') COLLATE utf8mb4_bin, 0)
FROM checks_esperados AS e
LEFT JOIN information_schema.CHECK_CONSTRAINTS AS r
 ON CONVERT(r.CONSTRAINT_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.TABLE_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.tabla USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.CONSTRAINT_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.nombre USING utf8mb4) COLLATE utf8mb4_bin
UNION ALL
SELECT 'BASE', 'entorno',
 (@cb2_schema IS NOT NULL AND CHAR_LENGTH(@cb2_schema) BETWEEN 1 AND 64
  AND CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin NOT IN
      (_utf8mb4'information_schema', _utf8mb4'mysql', _utf8mb4'performance_schema', _utf8mb4'sys')
  AND VERSION() LIKE '11.8.%MariaDB%'
  AND @@foreign_key_checks = 1 AND @@check_constraint_checks = 1
  AND (FIND_IN_SET('STRICT_ALL_TABLES', @@sql_mode) > 0
       OR FIND_IN_SET('STRICT_TRANS_TABLES', @@sql_mode) > 0)
  AND @@innodb_strict_mode = 1 AND @@innodb_page_size >= 8192
  AND @@group_concat_max_len >= 8192 AND @@sql_mode NOT LIKE '%NO_BACKSLASH_ESCAPES%'
  AND (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('empresas','usuarios','compras_proveedores','flota_vehiculos','flota_combustible_cargas','flota_combustible_conciliaciones','flota_combustible_conciliacion_filas','auditoria','flota_vehiculo_acceso')
       AND ENGINE = 'InnoDB' AND TABLE_TYPE = 'BASE TABLE') = 9)
UNION ALL
SELECT 'BASE', 'triggers_auditoria',
 (SELECT COUNT(*) FROM information_schema.TRIGGERS
  WHERE CONVERT(TRIGGER_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND EVENT_OBJECT_TABLE = 'auditoria') = 0
UNION ALL
SELECT 'BASE', 'nombres_fk_sin_colisiones',
 (SELECT COUNT(*) FROM fks_esperadas AS e
  JOIN information_schema.TABLE_CONSTRAINTS AS r
   ON CONVERT(r.CONSTRAINT_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND CONVERT(r.CONSTRAINT_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(e.nombre USING utf8mb4) COLLATE utf8mb4_bin
   AND r.CONSTRAINT_TYPE = 'FOREIGN KEY'
  WHERE e.ambito = 'NUEVO' AND CONVERT(r.TABLE_NAME USING utf8mb4) COLLATE utf8mb4_bin <> CONVERT(e.tabla USING utf8mb4) COLLATE utf8mb4_bin) = 0
UNION ALL
SELECT 'BASE', 'tablas_base_sin_particiones',
 (SELECT COUNT(*) FROM information_schema.PARTITIONS
  WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('empresas','usuarios','compras_proveedores','flota_vehiculos','auditoria')
  AND PARTITION_NAME IS NOT NULL) = 0
UNION ALL
SELECT 'NUEVO', 'tablas_y_objetos_exactos',
 ((SELECT COUNT(*) FROM information_schema.TABLES
   WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')
   AND ENGINE = 'InnoDB' AND TABLE_TYPE = 'BASE TABLE'
   AND ROW_FORMAT = 'Dynamic' AND TABLE_COLLATION = 'utf8mb4_bin') = 4
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')) = 86
  AND (SELECT COUNT(*) FROM indices_reales WHERE tabla IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')) = 34
  AND (SELECT COUNT(*) FROM fks_reales WHERE tabla IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')) = 18
  AND (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
       WHERE CONVERT(CONSTRAINT_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')) = 26
  AND (SELECT COUNT(*) FROM information_schema.PARTITIONS
       WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')
       AND PARTITION_NAME IS NOT NULL) = 0
  AND (SELECT COUNT(*) FROM information_schema.TRIGGERS
       WHERE CONVERT(TRIGGER_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND EVENT_OBJECT_TABLE IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')) = 0)
),
resumen AS (
SELECT
 COALESCE(MIN(CASE WHEN ambito = 'BASE' THEN COALESCE(ok, 0) ELSE 1 END), 0) AS base_ok,
 COALESCE(MIN(CASE WHEN ambito = 'NUEVO' THEN COALESCE(ok, 0) ELSE 1 END), 0) AS nuevas_ok,
 (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')) AS tablas_nuevas
FROM verificaciones
)
-- END CB2_METADATA_CANONICO
SELECT base_ok, CASE
 WHEN COALESCE(base_ok, 0) <> 1 THEN 'DIVERGENTE'
 WHEN tablas_nuevas = 0 THEN 'CLEAN'
 WHEN tablas_nuevas = 4 AND nuevas_ok = 1 THEN 'FINAL'
 ELSE 'DIVERGENTE'
END
INTO @cb2_base_ok, @cb2_estado FROM resumen;
SELECT 'METADATA' AS ambito, 'estado_esquema_cb2' AS objeto,
 COALESCE(@cb2_estado, 'DIVERGENTE') AS valor;

DELIMITER $$
BEGIN NOT ATOMIC
 IF @cb2_estado = 'FINAL' AND @cb2_base_ok = 1
    AND COALESCE(CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin =
        CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin, 0) = 1 THEN
  -- BEGIN CB2_DATOS_CANONICO (literal SQL; no ejecutar durante esta tarea)
  SELECT 'WITH incidencias AS (
SELECT ''consumo_sin_padres_del_ambito'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_consumos AS c
LEFT JOIN compras_proveedores AS p ON p.empresa_id = c.empresa_id AND p.id = c.proveedor_id
LEFT JOIN flota_cb2_importaciones AS i
 ON i.empresa_id = c.empresa_id AND i.proveedor_id = c.proveedor_id AND i.id = c.importacion_origen_id
LEFT JOIN flota_vehiculos AS v ON v.id = c.vehiculo_id
LEFT JOIN flota_cb2_facturas AS f
 ON f.empresa_id = c.empresa_id AND f.proveedor_id = c.proveedor_id AND f.id = c.factura_id
WHERE p.id IS NULL OR i.id IS NULL OR v.id IS NULL OR (c.factura_id IS NOT NULL AND f.id IS NULL)
) AS incidencias
UNION ALL
SELECT ''estado_factura_inconsistente'' AS comprobacion, (
SELECT COUNT(*) FROM flota_cb2_consumos
WHERE estado_factura IS NULL OR NOT (
 (factura_id IS NULL AND estado_factura = ''PENDIENTE_FACTURA''
  AND factura_asociada_por IS NULL AND factura_asociada_en IS NULL)
 OR (factura_id IS NOT NULL AND estado_factura = ''FACTURADO''
     AND factura_asociada_por IS NOT NULL AND factura_asociada_en IS NOT NULL))
) AS incidencias
UNION ALL
SELECT ''huellas_duplicadas'' AS comprobacion, (
SELECT COUNT(*) FROM (
 SELECT empresa_id, proveedor_id, huella_operacion FROM flota_cb2_consumos
 GROUP BY empresa_id, proveedor_id, huella_operacion HAVING COUNT(*) > 1
) AS d
) AS incidencias
UNION ALL
SELECT ''fila_sin_importacion_del_ambito'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_filas AS l
LEFT JOIN flota_cb2_importaciones AS i
 ON i.empresa_id = l.empresa_id AND i.proveedor_id = l.proveedor_id AND i.id = l.importacion_id
WHERE i.id IS NULL
) AS incidencias
UNION ALL
SELECT ''fila_sin_consumo_del_ambito'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_filas AS l
LEFT JOIN flota_cb2_consumos AS c
 ON c.empresa_id = l.empresa_id AND c.proveedor_id = l.proveedor_id AND c.id = l.consumo_id
WHERE l.consumo_id IS NOT NULL AND c.id IS NULL
) AS incidencias
UNION ALL
SELECT ''evento_sin_original_inmutable'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_filas AS l
LEFT JOIN flota_cb2_filas AS o
 ON o.empresa_id = l.empresa_id AND o.proveedor_id = l.proveedor_id
 AND o.importacion_id = l.importacion_id AND o.id = l.origen_fila_id
WHERE l.tipo <> ''ORIGEN'' AND (
 o.id IS NULL OR o.tipo <> ''ORIGEN'' OR o.id >= l.id OR o.hoja_indice <> l.hoja_indice
 OR BINARY o.hoja_nombre <> BINARY l.hoja_nombre OR o.fila_excel <> l.fila_excel)
) AS incidencias
UNION ALL
SELECT ''revision_posterior_a_cabecera'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_filas AS l
JOIN flota_cb2_importaciones AS i
 ON i.empresa_id = l.empresa_id AND i.proveedor_id = l.proveedor_id AND i.id = l.importacion_id
WHERE l.revision > i.revision
) AS incidencias
UNION ALL
SELECT ''operacion_con_payload_o_actor_discordante'' AS comprobacion, (
SELECT COUNT(*) FROM (
 SELECT empresa_id, proveedor_id, operacion_tipo, operacion_clave FROM flota_cb2_filas
 GROUP BY empresa_id, proveedor_id, operacion_tipo, operacion_clave
 HAVING COUNT(DISTINCT solicitud_sha256) > 1 OR COUNT(DISTINCT usuario_id) > 1
 OR MIN(operacion_total) <> MAX(operacion_total) OR COUNT(*) <> MIN(operacion_total)
 OR MIN(operacion_ordinal) <> 1 OR MAX(operacion_ordinal) <> MIN(operacion_total)
) AS d
) AS incidencias
UNION ALL
SELECT ''consumo_sin_evidencia_de_creacion'' AS comprobacion, (
SELECT COUNT(*) FROM flota_cb2_consumos AS c
WHERE NOT EXISTS (
 SELECT 1 FROM flota_cb2_filas AS l
 WHERE l.empresa_id = c.empresa_id AND l.proveedor_id = c.proveedor_id
 AND l.importacion_id = c.importacion_origen_id AND l.consumo_id = c.id AND l.resultado = ''CREADA'')
) AS incidencias
UNION ALL
SELECT ''cabecera_sin_evidencia_original'' AS comprobacion, (
SELECT COUNT(*) FROM flota_cb2_importaciones AS i
WHERE NOT EXISTS (
 SELECT 1 FROM flota_cb2_filas AS l
 WHERE l.empresa_id = i.empresa_id AND l.proveedor_id = i.proveedor_id
 AND l.importacion_id = i.id AND l.tipo = ''ORIGEN'')
) AS incidencias
UNION ALL
SELECT ''originales_repetidos'' AS comprobacion, (
SELECT COUNT(*) FROM (
 SELECT empresa_id, proveedor_id, importacion_id, hoja_indice, fila_excel FROM flota_cb2_filas
 WHERE tipo = ''ORIGEN''
 GROUP BY empresa_id, proveedor_id, importacion_id, hoja_indice, fila_excel HAVING COUNT(*) > 1
) AS d
) AS incidencias
UNION ALL
SELECT ''revision_con_mas_de_una_operacion'' AS comprobacion, (
SELECT COUNT(*) FROM (
 SELECT empresa_id, proveedor_id, importacion_id, revision FROM flota_cb2_filas
 GROUP BY empresa_id, proveedor_id, importacion_id, revision
 HAVING COUNT(DISTINCT operacion_tipo, operacion_clave) > 1
) AS d
) AS incidencias
UNION ALL
SELECT ''original_con_consumos_distintos'' AS comprobacion, (
SELECT COUNT(*) FROM (
 SELECT empresa_id, proveedor_id, importacion_id, COALESCE(origen_fila_id, id) AS original_id
 FROM flota_cb2_filas
 GROUP BY empresa_id, proveedor_id, importacion_id, COALESCE(origen_fila_id, id)
 HAVING COUNT(DISTINCT consumo_id) > 1
) AS d
) AS incidencias
UNION ALL
SELECT ''asociacion_documental_incompatible'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_filas AS l
LEFT JOIN flota_cb2_consumos AS c
 ON c.empresa_id = l.empresa_id AND c.proveedor_id = l.proveedor_id AND c.id = l.consumo_id
LEFT JOIN flota_cb2_facturas AS f
 ON f.empresa_id = l.empresa_id AND f.proveedor_id = l.proveedor_id AND f.id = l.factura_nueva_id
WHERE l.tipo = ''ASOCIACION_FACTURA'' AND (
 c.id IS NULL OR f.id IS NULL OR NOT (c.factura_id <=> l.factura_nueva_id) OR c.moneda <> f.moneda
 OR (l.resultado = ''FACTURA_ASOCIADA'' AND l.factura_anterior_id IS NOT NULL)
 OR (l.resultado = ''SIN_CAMBIO'' AND NOT (l.factura_anterior_id <=> l.factura_nueva_id)))
) AS incidencias
UNION ALL
SELECT ''consumo_con_factura_de_moneda_distinta'' AS comprobacion, (
SELECT COUNT(*)
FROM flota_cb2_consumos AS c
JOIN flota_cb2_facturas AS f
 ON f.empresa_id = c.empresa_id AND f.proveedor_id = c.proveedor_id AND f.id = c.factura_id
WHERE c.moneda <> f.moneda
) AS incidencias
)
SELECT ''DATO'' AS ambito, comprobacion AS objeto, CAST(incidencias AS CHAR) AS valor FROM incidencias
UNION ALL
SELECT ''RESULTADO'', ''estado_postcheck'',
 CASE WHEN COALESCE(SUM(incidencias), 1) = 0 THEN ''FINAL'' ELSE ''DIVERGENTE'' END FROM incidencias
UNION ALL
SELECT ''DIAGNOSTICO'', ''grupos_candidatos_con_multiples_consumos'', CAST((
SELECT COUNT(*) FROM (
 SELECT empresa_id, proveedor_id, clave_candidata FROM flota_cb2_consumos
 GROUP BY empresa_id, proveedor_id, clave_candidata HAVING COUNT(*) > 1
) AS d
) AS CHAR)' INTO @cb2_postcheck_select;
  -- END CB2_DATOS_CANONICO
  PREPARE cb2_postcheck FROM @cb2_postcheck_select;
  EXECUTE cb2_postcheck;
  DEALLOCATE PREPARE cb2_postcheck;
 ELSE
  SELECT 'RESULTADO' AS ambito, 'estado_postcheck' AS objeto, 'DIVERGENTE' AS valor;
  SELECT 'NOTA' AS ambito, 'certificacion' AS objeto,
   'SIN CERTIFICAR: metadata no FINAL o contexto distinto del objetivo; no se consultaron datos' AS valor;
 END IF;
END$$
DELIMITER ;
-- El diagnostico de vales repetidos no bloquea por si solo ni revela datos personales.
-- Comparticion actual no invalida historia; contrastar inventario historico con preflight conservado.
