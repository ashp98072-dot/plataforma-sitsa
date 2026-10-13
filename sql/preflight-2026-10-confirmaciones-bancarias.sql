-- SOLO LECTURA. Ejecutar sentencias individualmente en la BD objetivo real.
-- No DELIMITER/BEGIN/result sets anidados: compatible phpMyAdmin/mysqli.
SELECT DATABASE() AS bd, VERSION() AS version, @@foreign_key_checks AS fks, @@check_constraint_checks AS checks;
SHOW TABLES LIKE 'fact_pago_confirmaciones';
SHOW CREATE TABLE fact_facturas;
SHOW CREATE TABLE fact_pagos;
SHOW CREATE TABLE cont_entidades;
SHOW CREATE TABLE cont_cuentas_bancarias;
SHOW CREATE TABLE cont_cuentas;
SHOW CREATE TABLE usuarios;
-- APLICAR: tabla nueva ausente, MariaDB 11.8.9, FK/CHECK ON, padres InnoDB,
-- IDs INT signed; UNIQUE cont_entidades(empresa_id,id) y
-- cont_cuentas_bancarias(empresa_id,entidad_id,id); los demás padres tienen PK(id).
-- NOOP: tabla presente y SHOW CREATE coincide íntegramente con migrate (columnas,
-- defaults, índices, 6 FKs RESTRICT, 4 CHECKs y collation). Ejecutar SHOW solo si existe:
-- SHOW CREATE TABLE fact_pago_confirmaciones;
-- DETENER: permisos insuficientes, padre incompatible, constraint en conflicto o drift.
-- No automatizar un resultado APTO cuando falta evidencia física.
SELECT CONSTRAINT_NAME,TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN
 ('fk_fpc_entidad','fk_fpc_banco','fk_fpc_factura','fk_fpc_pago','fk_fpc_actor','fk_fpc_anulador','ck_fpc_monto','ck_fpc_referencia','ck_fpc_estado','ck_fpc_evidencia');
