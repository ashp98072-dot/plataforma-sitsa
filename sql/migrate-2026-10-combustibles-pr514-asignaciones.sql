-- PR514: PREPARADA, NO EJECUTADA. Requiere aprobación, backup y ventana de DDL.
-- Precheck: confirmar main posterior a PR513, motor InnoDB y tipos INT compatibles.
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_consumos','empleados','auditoria');
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_consumos','empleados') AND COLUMN_NAME IN ('id','empresa_id','estado','empleado_id','producto_clasificado','revision_asignacion');
-- Debe haber 0 columnas nuevas; abortar ante instalación parcial. No reejecutar a ciegas.
ALTER TABLE flota_cb2_consumos
 ADD COLUMN empleado_id INT NULL,
 ADD COLUMN producto_clasificado VARCHAR(32) NULL,
 ADD COLUMN revision_asignacion INT NOT NULL DEFAULT 0,
 ADD INDEX ix_cb2_empleado (empresa_id,empleado_id),
 ADD CONSTRAINT fk_cb2_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id),
 ADD CONSTRAINT ck_cb2_producto CHECK (producto_clasificado IS NULL OR producto_clasificado IN ('DIESEL','GASOLINA_REGULAR','GASOLINA_SUPERIOR','VPOWER_DIESEL','VPOWER_GASOLINA','VPOWER_NO_DETERMINADO','NO_DETERMINADO'));
CREATE TABLE flota_cb2_asignaciones (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 empresa_id INT NOT NULL, proveedor_id INT NOT NULL, consumo_id INT NOT NULL,
 clave VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 anterior LONGTEXT NOT NULL, nuevo LONGTEXT NOT NULL, motivo VARCHAR(1000) NOT NULL,
 usuario_id INT NOT NULL, creado_en DATETIME(6) NOT NULL,
 UNIQUE KEY uq_cb2_asignacion_clave (empresa_id,proveedor_id,clave),
 INDEX ix_cb2_asignacion_consumo (empresa_id,consumo_id),
 CONSTRAINT fk_cb2_asignacion_consumo FOREIGN KEY (empresa_id,proveedor_id,consumo_id) REFERENCES flota_cb2_consumos(empresa_id,proveedor_id,id),
 CONSTRAINT ck_cb2_asignacion_json CHECK (JSON_VALID(anterior) AND JSON_VALID(nuevo))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- Postcheck: revisar SHOW CREATE de ambas tablas; comprobar 0 vínculos fuera de empresa.
SELECT COUNT(*) AS empleados_fuera_empresa FROM flota_cb2_consumos c JOIN empleados e ON e.id=c.empleado_id WHERE e.empresa_id<>c.empresa_id;
SELECT COUNT(*) AS asignaciones_fuera_empresa FROM flota_cb2_asignaciones a JOIN flota_cb2_consumos c ON c.id=a.consumo_id WHERE a.empresa_id<>c.empresa_id OR a.proveedor_id<>c.proveedor_id;
-- Reversión MANUAL tras retirar aplicación y exportar asignaciones: DROP TABLE flota_cb2_asignaciones;
-- ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2_empleado, DROP CONSTRAINT ck_cb2_producto, DROP INDEX ix_cb2_empleado, DROP COLUMN empleado_id, DROP COLUMN producto_clasificado, DROP COLUMN revision_asignacion;
-- La reversión pierde los vínculos/clasificaciones nuevos. No revierte ni cambia evidencia original.
