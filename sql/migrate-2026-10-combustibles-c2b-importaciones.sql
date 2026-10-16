-- PROPUESTA NO EJECUTADA. MariaDB 11.8.9. SOLO tras preflight físico aprobado.
-- DDL aditivo; sin DML, seeds ni backfill. No se ejecuta desde requests/build/deploy.
-- IF NOT EXISTS permite repetición SOLO sobre contrato idéntico; NO valida/repara divergencias.
-- Ante cualquier diferencia/estado parcial DETENER y revisar antes de ejecutar este archivo.
-- DDL no transaccional: interrupción entre ALTERs requiere diagnóstico manual.
ALTER TABLE flota_combustible_conciliaciones
 ADD COLUMN IF NOT EXISTS proveedor_id INT NULL,
 ADD COLUMN IF NOT EXISTS proveedor_nombre VARCHAR(200) NULL,
 ADD COLUMN IF NOT EXISTS archivo_sha256 CHAR(64) NULL,
 ADD COLUMN IF NOT EXISTS perfil_parser VARCHAR(40) NULL,
 ADD COLUMN IF NOT EXISTS version_parser SMALLINT NULL,
 ADD COLUMN IF NOT EXISTS estado_importacion VARCHAR(20) NULL,
 ADD COLUMN IF NOT EXISTS resumen_importacion JSON NULL,
 ADD COLUMN IF NOT EXISTS subido_por_usuario_id INT NULL,
 ADD UNIQUE KEY IF NOT EXISTS uq_fcci_empresa_id (empresa_id,id),
 ADD UNIQUE KEY IF NOT EXISTS uq_fcci_archivo (empresa_id,proveedor_id,archivo_sha256),
 ADD INDEX IF NOT EXISTS idx_fcci_perfil (empresa_id,perfil_parser,id),
 ADD FOREIGN KEY IF NOT EXISTS fk_fcci_empresa (empresa_id) REFERENCES empresas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 ADD FOREIGN KEY IF NOT EXISTS fk_fcci_proveedor (empresa_id,proveedor_id) REFERENCES compras_proveedores(empresa_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 ADD FOREIGN KEY IF NOT EXISTS fk_fcci_usuario (subido_por_usuario_id) REFERENCES usuarios(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE flota_combustible_conciliacion_filas
 ADD COLUMN IF NOT EXISTS hoja_origen VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
 ADD COLUMN IF NOT EXISTS estado_parseo VARCHAR(20) NULL,
 ADD COLUMN IF NOT EXISTS datos_importacion JSON NULL,
 ADD COLUMN IF NOT EXISTS origen_celdas JSON NULL,
 ADD COLUMN IF NOT EXISTS fingerprint CHAR(64) NULL,
 ADD COLUMN IF NOT EXISTS clave_operacion CHAR(64) NULL,
 ADD COLUMN IF NOT EXISTS duplicado_tipo VARCHAR(30) NULL,
 ADD COLUMN IF NOT EXISTS duplicado_previo TINYINT(1) NULL,
 ADD COLUMN IF NOT EXISTS duplicado_de_linea_id INT NULL,
 ADD UNIQUE KEY IF NOT EXISTS uq_fccif_empresa_import_id (empresa_id,conciliacion_id,id),
 ADD UNIQUE KEY IF NOT EXISTS uq_fccif_origen (empresa_id,conciliacion_id,hoja_origen,fila_excel),
 ADD INDEX IF NOT EXISTS idx_fccif_fingerprint (empresa_id,fingerprint),
 ADD INDEX IF NOT EXISTS idx_fccif_clave (empresa_id,clave_operacion),
 ADD INDEX IF NOT EXISTS idx_fccif_canonica (empresa_id,conciliacion_id,duplicado_de_linea_id),
 ADD FOREIGN KEY IF NOT EXISTS fk_fccif_importacion (empresa_id,conciliacion_id) REFERENCES flota_combustible_conciliaciones(empresa_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 ADD FOREIGN KEY IF NOT EXISTS fk_fccif_canonica (empresa_id,conciliacion_id,duplicado_de_linea_id) REFERENCES flota_combustible_conciliacion_filas(empresa_id,conciliacion_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- Históricos conservan todos los campos nuevos NULL y todos los snapshots/estados previos intactos.
-- No modificar schema/bootstrap: este contrato incremental debe estar aplicado antes de desplegar.
