-- SOLO LECTURA. Ejecutar sentencias individualmente en la BD objetivo real.
-- No DELIMITER/BEGIN/result sets anidados: compatible phpMyAdmin/mysqli.
SELECT DATABASE() AS bd, VERSION() AS version, @@foreign_key_checks AS fks, @@check_constraint_checks AS checks, @@collation_database AS collation_bd;
SHOW TABLES LIKE 'tms\_liquidacion\_config';
SHOW TABLES LIKE 'tms\_viaje\_liquidaci%';
SHOW CREATE TABLE tms_planes_viaje;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
-- El padre del plan debe exponer UNIQUE (empresa_id, id) = uq_tmsplanes_empresa_id (destino de la FK compuesta).
SHOW INDEX FROM tms_planes_viaje;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_planes_viaje','empresas','usuarios') AND COLUMN_NAME IN ('id','empresa_id');
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_planes_viaje','empresas','usuarios');
-- Constraints en conflicto (deben estar ausentes, o presentes solo si las tres tablas ya existen integras = NOOP).
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN
 ('fk_tlc_empresa','fk_tlc_actor','fk_tvl_empresa','fk_tvl_plan','fk_tvl_reporte_por','fk_tvl_liquidado_por','fk_tvl_reabierto_por',
  'ck_tvl_estado','ck_tvl_version','ck_tvl_pares','ck_tvl_estado_marcas','uq_tvl_empresa_plan',
  'fk_tvle_liquidacion','fk_tvle_actor','ck_tvle_version','ck_tvle_snapshot','ck_tvle_transicion','uq_tvle_version');
-- APLICAR: MariaDB 11.8.9, FK/CHECK ON, las 3 tablas ausentes, padres InnoDB con id INT signed,
--          UNIQUE (empresa_id, id) presente en tms_planes_viaje.
-- NOOP: las 3 tablas existen y SHOW CREATE coincide integramente con migrate-2026-10-tms-liquidacion-viajes-fase1.sql.
-- DETENER: tabla parcial, constraint en conflicto, padre no InnoDB, falta uq_tmsplanes_empresa_id o drift.
-- No automatizar un resultado APTO cuando falta evidencia fisica. NO hay seeds ni backfill.
