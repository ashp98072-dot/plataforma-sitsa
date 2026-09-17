-- SOLO LECTURA. No ejecutado por este PR. Seleccionar la base de destino primero.
-- MariaDB: JSON no interviene en estas tablas. No asumir FKs declaradas físicamente.
-- APLICAR = ausente y dependencias compatibles; NOOP = contrato existente compatible.
-- DETENER = divergencia/dependencia incompatible. Ante cualquier DETENER NO aplicar nada.
-- Los IDs de usuarios son globales: acceso usuario/empresa se validará en aplicación.
SELECT VERSION() AS version_servidor, DATABASE() AS base_destino;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','flota_vehiculos',
'compras_proveedores','compras_requerimientos','compras_requerimiento_lineas','compras_linea_documentos');
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','flota_vehiculos')
AND COLUMN_NAME IN ('id','empresa_id');
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','flota_vehiculos')
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE;
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN
('empresas','usuarios','cont_entidades','flota_vehiculos',
'compras_proveedores','compras_requerimientos','compras_requerimiento_lineas','compras_linea_documentos');

WITH
esperadas AS (
SELECT 'compras_proveedores' tabla, 'id' columna, 1 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, 'auto_increment' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'empresa_id' columna, 2 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'nombre_comercial' columna, 3 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'razon_social' columna, 4 posicion, 'varchar' tipo, 250 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'nit' columna, 5 posicion, 'varchar' tipo, 30 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'direccion' columna, 6 posicion, 'varchar' tipo, 500 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'telefono' columna, 7 posicion, 'varchar' tipo, 50 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'correo' columna, 8 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'contacto_nombre' columna, 9 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'contacto_telefono' columna, 10 posicion, 'varchar' tipo, 50 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'contacto_correo' columna, 11 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'metodo_pago_habitual' columna, 12 posicion, 'varchar' tipo, 80 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'banco' columna, 13 posicion, 'varchar' tipo, 150 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'numero_cuenta' columna, 14 posicion, 'varchar' tipo, 100 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'tipo_cuenta' columna, 15 posicion, 'varchar' tipo, 80 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'titular_cuenta' columna, 16 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'dias_credito' columna, 17 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'observaciones' columna, 18 posicion, 'text' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'activo' columna, 19 posicion, 'tinyint' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, '1' defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'creado_por' columna, 20 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'actualizado_por' columna, 21 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'creado_en' columna, 22 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, 'current_timestamp' defecto, '' extra
UNION ALL
SELECT 'compras_proveedores' tabla, 'actualizado_en' columna, 23 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, 'current_timestamp' defecto, 'on update current_timestamp' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'id' columna, 1 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, 'auto_increment' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'empresa_id' columna, 2 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'codigo' columna, 3 posicion, 'varchar' tipo, 40 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fecha_requerimiento' columna, 4 posicion, 'date' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'entidad_requirente_id' columna, 5 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'entidad_requirente_nombre' columna, 6 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'requirente_usuario_id' columna, 7 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'requirente_nombre' columna, 8 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'solicitante_usuario_id' columna, 9 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'solicitante_nombre' columna, 10 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'estado' columna, 11 posicion, 'varchar' tipo, 20 longitud, NULL precision_num, NULL escala, 'NO' nullable, 'Pendiente' defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'total' columna, 12 posicion, 'decimal' tipo, NULL longitud, 12 precision_num, 2 escala, 'NO' nullable, '0' defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'observaciones' columna, 13 posicion, 'text' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'autorizante_usuario_id' columna, 14 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'autorizante_nombre' columna, 15 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'autorizado_en' columna, 16 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'rechazado_en' columna, 17 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'motivo_rechazo' columna, 18 posicion, 'varchar' tipo, 1000 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'version' columna, 19 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, '1' defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'creado_por' columna, 20 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'creado_en' columna, 21 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, 'current_timestamp' defecto, '' extra
UNION ALL
SELECT 'compras_requerimientos' tabla, 'actualizado_en' columna, 22 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, 'current_timestamp' defecto, 'on update current_timestamp' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'id' columna, 1 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, 'auto_increment' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'empresa_id' columna, 2 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'requerimiento_id' columna, 3 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'orden' columna, 4 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'vehiculo_id' columna, 5 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'unidad_descripcion' columna, 6 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'fecha' columna, 7 posicion, 'date' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'serie_factura' columna, 8 posicion, 'varchar' tipo, 100 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'numero_factura' columna, 9 posicion, 'varchar' tipo, 100 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'proveedor_id' columna, 10 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'proveedor_nombre_snapshot' columna, 11 posicion, 'varchar' tipo, 200 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'proveedor_razon_social_snapshot' columna, 12 posicion, 'varchar' tipo, 250 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'proveedor_nit_snapshot' columna, 13 posicion, 'varchar' tipo, 30 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'repuesto_descripcion' columna, 14 posicion, 'varchar' tipo, 1000 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'metodo_pago' columna, 15 posicion, 'varchar' tipo, 80 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'condicion_pago' columna, 16 posicion, 'varchar' tipo, 30 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'banco_snapshot' columna, 17 posicion, 'varchar' tipo, 150 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'numero_cuenta_snapshot' columna, 18 posicion, 'varchar' tipo, 100 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'dias_credito_snapshot' columna, 19 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'total' columna, 20 posicion, 'decimal' tipo, NULL longitud, 12 precision_num, 2 escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'observaciones' columna, 21 posicion, 'text' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'id' columna, 1 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, 'auto_increment' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'empresa_id' columna, 2 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'requerimiento_id' columna, 3 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'linea_id' columna, 4 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'tipo' columna, 5 posicion, 'varchar' tipo, 20 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'ruta_relativa' columna, 6 posicion, 'varchar' tipo, 1000 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'nombre_original' columna, 7 posicion, 'varchar' tipo, 500 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'mime' columna, 8 posicion, 'varchar' tipo, 100 longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'tamano' columna, 9 posicion, 'bigint' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'sha256' columna, 10 posicion, 'char' tipo, 64 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'subido_por_usuario_id' columna, 11 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'subido_en' columna, 12 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, 'current_timestamp' defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'retirado' columna, 13 posicion, 'tinyint' tipo, NULL longitud, NULL precision_num, NULL escala, 'NO' nullable, '0' defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'retirado_por_usuario_id' columna, 14 posicion, 'int' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'retirado_en' columna, 15 posicion, 'datetime' tipo, NULL longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'motivo_retiro' columna, 16 posicion, 'varchar' tipo, 1000 longitud, NULL precision_num, NULL escala, 'YES' nullable, NULL defecto, '' extra
),
indices_esperados AS (
SELECT 'compras_proveedores' tabla, 'PRIMARY' nombre, 'id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_proveedores' tabla, 'uq_compras_proveedor_empresa' nombre, 'empresa_id,id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_proveedores' tabla, 'idx_compras_proveedor_nombre' nombre, 'empresa_id,activo,nombre_comercial' columnas, 1 no_unico
UNION ALL
SELECT 'compras_proveedores' tabla, 'idx_compras_proveedor_nit' nombre, 'empresa_id,nit' columnas, 1 no_unico
UNION ALL
SELECT 'compras_requerimientos' tabla, 'PRIMARY' nombre, 'id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_requerimientos' tabla, 'uq_compras_req_empresa' nombre, 'empresa_id,id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_requerimientos' tabla, 'uq_compras_req_codigo' nombre, 'empresa_id,codigo' columnas, 0 no_unico
UNION ALL
SELECT 'compras_requerimientos' tabla, 'idx_compras_req_fecha' nombre, 'empresa_id,estado,fecha_requerimiento' columnas, 1 no_unico
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'PRIMARY' nombre, 'id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'uq_compras_linea_identidad' nombre, 'empresa_id,requerimiento_id,id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'idx_compras_linea_orden' nombre, 'empresa_id,requerimiento_id,orden,id' columnas, 1 no_unico
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'idx_compras_linea_proveedor' nombre, 'empresa_id,proveedor_id' columnas, 1 no_unico
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'PRIMARY' nombre, 'id' columnas, 0 no_unico
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'idx_compras_documento_linea' nombre, 'empresa_id,requerimiento_id,linea_id,retirado' columnas, 1 no_unico
),
fks_esperadas AS (
SELECT 'compras_proveedores' tabla, 'fk_cb_proveedores_empresa' nombre, 'empresa_id' columnas, 'empresas' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_proveedores' tabla, 'fk_cb_proveedores_creador' nombre, 'creado_por' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_proveedores' tabla, 'fk_cb_proveedores_editor' nombre, 'actualizado_por' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fk_cb_requerimientos_empresa' nombre, 'empresa_id' columnas, 'empresas' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fk_cb_requerimientos_entidad' nombre, 'empresa_id,entidad_requirente_id' columnas, 'cont_entidades' destino, 'empresa_id,id' columnas_destino
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fk_cb_requerimientos_requirente' nombre, 'requirente_usuario_id' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fk_cb_requerimientos_solicitante' nombre, 'solicitante_usuario_id' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fk_cb_requerimientos_autorizante' nombre, 'autorizante_usuario_id' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_requerimientos' tabla, 'fk_cb_requerimientos_creador' nombre, 'creado_por' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'fk_cb_requerimiento_lineas_requerimiento' nombre, 'empresa_id,requerimiento_id' columnas, 'compras_requerimientos' destino, 'empresa_id,id' columnas_destino
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'fk_cb_requerimiento_lineas_proveedor' nombre, 'empresa_id,proveedor_id' columnas, 'compras_proveedores' destino, 'empresa_id,id' columnas_destino
UNION ALL
SELECT 'compras_requerimiento_lineas' tabla, 'fk_cb_requerimiento_lineas_vehiculo' nombre, 'empresa_id,vehiculo_id' columnas, 'flota_vehiculos' destino, 'empresa_id,id' columnas_destino
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'fk_cb_linea_documentos_linea' nombre, 'empresa_id,requerimiento_id,linea_id' columnas, 'compras_requerimiento_lineas' destino, 'empresa_id,requerimiento_id,id' columnas_destino
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'fk_cb_linea_documentos_subido' nombre, 'subido_por_usuario_id' columnas, 'usuarios' destino, 'id' columnas_destino
UNION ALL
SELECT 'compras_linea_documentos' tabla, 'fk_cb_linea_documentos_retirado' nombre, 'retirado_por_usuario_id' columnas, 'usuarios' destino, 'id' columnas_destino
),
indices_reales AS (
SELECT TABLE_NAME tabla, INDEX_NAME nombre, NON_UNIQUE no_unico,
GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
),
fks_reales AS (
SELECT k.TABLE_NAME tabla, k.CONSTRAINT_NAME nombre,
GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
MAX(k.REFERENCED_TABLE_NAME) destino,
MAX(k.REFERENCED_TABLE_SCHEMA) esquema_destino,
GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_destino,
MAX(r.DELETE_RULE) regla_delete, MAX(r.UPDATE_RULE) regla_update
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME
),
padres AS (
SELECT 'empresas' tabla UNION ALL SELECT 'usuarios' UNION ALL SELECT 'cont_entidades' UNION ALL SELECT 'flota_vehiculos'
),
compatibilidad AS (
SELECT CASE WHEN DATABASE() IS NULL OR VERSION() NOT LIKE '11.8.%MariaDB%'
OR EXISTS (
SELECT 1 FROM padres p LEFT JOIN information_schema.TABLES t
ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = p.tabla
LEFT JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = p.tabla AND c.COLUMN_NAME = 'id'
WHERE t.ENGINE IS NULL OR t.ENGINE <> 'InnoDB' OR t.TABLE_COLLATION NOT LIKE 'utf8mb4%'
OR c.DATA_TYPE IS NULL OR c.DATA_TYPE <> 'int' OR c.COLUMN_TYPE LIKE '%unsigned%' OR c.IS_NULLABLE <> 'NO'
OR NOT EXISTS (SELECT 1 FROM indices_reales i WHERE i.tabla = p.tabla AND i.columnas = 'id' AND i.no_unico = 0)
)
OR EXISTS (
SELECT 1 FROM padres p LEFT JOIN information_schema.COLUMNS c
ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = p.tabla AND c.COLUMN_NAME = 'empresa_id'
WHERE p.tabla IN ('cont_entidades','flota_vehiculos')
AND (c.DATA_TYPE IS NULL OR c.DATA_TYPE <> 'int' OR c.COLUMN_TYPE LIKE '%unsigned%' OR c.IS_NULLABLE <> 'NO'
OR NOT EXISTS (SELECT 1 FROM indices_reales i WHERE i.tabla = p.tabla AND i.columnas = 'empresa_id,id' AND i.no_unico = 0))
)
THEN 0 ELSE 1 END ok
),
nuevas AS (SELECT DISTINCT tabla FROM esperadas),
checks_esperados AS (
SELECT 'compras_requerimientos' tabla, 'chk_compras_estado' nombre,
  'estadoin(''pendiente'',''autorizada'',''rechazada'')' clausula
UNION ALL SELECT 'compras_linea_documentos', 'chk_compras_documento_tipo',
  'tipoin(''factura'',''comprobante'')'
)
SELECT n.tabla,
CASE WHEN compatibilidad.ok = 0 THEN 'DETENER'
WHEN t.TABLE_NAME IS NULL THEN 'APLICAR'
WHEN t.ENGINE <> 'InnoDB' OR t.TABLE_COLLATION <> 'utf8mb4_unicode_ci'
OR (SELECT COUNT(*) FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = n.tabla)
<> (SELECT COUNT(*) FROM esperadas e WHERE e.tabla = n.tabla)
OR EXISTS (
SELECT 1 FROM esperadas e LEFT JOIN information_schema.COLUMNS c
ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = e.tabla AND c.COLUMN_NAME = e.columna
WHERE e.tabla = n.tabla AND (
c.COLUMN_NAME IS NULL OR c.ORDINAL_POSITION <> e.posicion OR c.DATA_TYPE <> e.tipo
OR (e.tipo IN ('int','bigint','tinyint','decimal') AND c.COLUMN_TYPE LIKE '%unsigned%')
OR (e.tipo IN ('varchar','char') AND NOT (c.CHARACTER_MAXIMUM_LENGTH <=> e.longitud))
OR (e.tipo = 'decimal' AND (c.NUMERIC_PRECISION <> e.precision_num OR c.NUMERIC_SCALE <> e.escala))
OR c.IS_NULLABLE <> e.nullable
OR NOT (NULLIF(LOWER(REPLACE(REPLACE(c.COLUMN_DEFAULT, CHAR(39), ''), '()', '')), 'null') <=> LOWER(e.defecto))
OR LOWER(REPLACE(c.EXTRA, '()', '')) <> e.extra
OR (e.tipo IN ('varchar','char','text') AND c.COLLATION_NAME <> 'utf8mb4_unicode_ci')
))
OR EXISTS (
SELECT 1 FROM indices_esperados e LEFT JOIN indices_reales i ON i.tabla = e.tabla AND i.nombre = e.nombre
WHERE e.tabla = n.tabla AND (i.nombre IS NULL OR i.columnas <> e.columnas OR i.no_unico <> e.no_unico)
)
OR EXISTS (SELECT 1 FROM indices_reales i WHERE i.tabla = n.tabla AND i.no_unico = 0
AND NOT EXISTS (SELECT 1 FROM indices_esperados e WHERE e.tabla = i.tabla AND e.nombre = i.nombre))
OR EXISTS (
SELECT 1 FROM fks_esperadas e LEFT JOIN fks_reales f ON f.tabla = e.tabla AND f.nombre = e.nombre
WHERE e.tabla = n.tabla AND (f.nombre IS NULL OR f.columnas <> e.columnas OR f.destino <> e.destino
OR f.esquema_destino <> DATABASE() OR f.columnas_destino <> e.columnas_destino OR f.regla_delete <> 'RESTRICT' OR f.regla_update <> 'RESTRICT')
)
OR (SELECT COUNT(*) FROM fks_reales f WHERE f.tabla = n.tabla) <> (SELECT COUNT(*) FROM fks_esperadas e WHERE e.tabla = n.tabla)
OR EXISTS (SELECT 1 FROM checks_esperados e WHERE e.tabla = n.tabla AND NOT EXISTS (
SELECT 1 FROM information_schema.CHECK_CONSTRAINTS c WHERE c.CONSTRAINT_SCHEMA = DATABASE() AND c.TABLE_NAME = e.tabla AND c.CONSTRAINT_NAME = e.nombre
AND LOWER(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '`', ''), ' ', ''), CHAR(10), '')) = e.clausula
))
OR (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS c WHERE c.CONSTRAINT_SCHEMA = DATABASE() AND c.TABLE_NAME = n.tabla)
<> (SELECT COUNT(*) FROM checks_esperados e WHERE e.tabla = n.tabla)
THEN 'DETENER' ELSE 'NOOP' END decision,
CASE WHEN compatibilidad.ok = 0 THEN 'Validar versión, padres, INT signed, InnoDB/utf8mb4 e índices únicos físicos.'
WHEN t.TABLE_NAME IS NULL THEN 'Crear con la migración completa, en orden.'
ELSE 'Contrato contrastado: columnas/defaults/índices/FKs/checks. No corregir divergencias automáticamente.' END detalle
FROM nuevas n CROSS JOIN compatibilidad
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = n.tabla
ORDER BY n.tabla;
-- Revisar además SHOW CREATE TABLE de cualquier tabla ya existente antes de aplicar.
