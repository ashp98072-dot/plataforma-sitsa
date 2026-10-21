-- SOLO LECTURA. Ejecutar sentencias individualmente en la BD objetivo real.
-- No DELIMITER/BEGIN/result sets anidados: compatible phpMyAdmin/mysqli.
SELECT DATABASE() AS bd, VERSION() AS version, @@foreign_key_checks AS fks, @@check_constraint_checks AS checks, @@collation_database AS collation_bd;
SHOW TABLES LIKE 'tms\_viaje\_carg%';
SHOW CREATE TABLE tms_planes_viaje;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
-- El padre del plan debe exponer UNIQUE (empresa_id, id) = uq_tmsplanes_empresa_id (destino de la FK compuesta).
SHOW INDEX FROM tms_planes_viaje;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_planes_viaje','empresas','usuarios') AND COLUMN_NAME IN ('id','empresa_id');
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_planes_viaje','empresas','usuarios');
-- Constraints en conflicto (deben estar ausentes, o presentes solo si las dos tablas ya existen integras = NOOP).
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN
 ('uq_tvca_empresa_id','uq_tvca_clave','fk_tvca_empresa','fk_tvca_plan','fk_tvca_creador','fk_tvca_actualizador','fk_tvca_anulador',
  'ck_tvca_monto','ck_tvca_concepto','ck_tvca_version','ck_tvca_activo','ck_tvca_anulacion',
  'uq_tvce_version','fk_tvce_cargo','fk_tvce_actor','ck_tvce_version','ck_tvce_tipo','ck_tvce_json','ck_tvce_motivo');
-- APLICAR: MariaDB 11.8.9, FK/CHECK ON, las 2 tablas ausentes, padres InnoDB con id INT signed, uq_tmsplanes_empresa_id presente.
-- NOOP: las 2 tablas existen y SHOW CREATE coincide integramente con migrate-2026-10-tms-liquidacion-cargos-fase4.sql.
-- DETENER: tabla parcial, constraint en conflicto, padre no InnoDB, falta uq_tmsplanes_empresa_id o drift.
-- No automatizar un resultado APTO cuando falta evidencia fisica. NO hay seeds ni backfill.
