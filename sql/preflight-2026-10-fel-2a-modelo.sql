-- SOLO LECTURA. Ejecutar sentencias individualmente en la BD objetivo real.
-- No DELIMITER/BEGIN/result sets anidados: compatible phpMyAdmin/mysqli.
SELECT DATABASE() AS bd, VERSION() AS version, @@foreign_key_checks AS fks, @@check_constraint_checks AS checks, @@collation_database AS collation_bd;
SHOW TABLES LIKE 'fel\_%';
SHOW CREATE TABLE fact_facturas;
SHOW INDEX FROM fact_facturas;
SHOW CREATE TABLE cont_entidades;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
-- Columnas de fact_facturas que usa el modelo: entidad_id debe existir (FACT-4) y ser INT NULL.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fact_facturas' AND COLUMN_NAME IN ('id','empresa_id','entidad_id');
-- Motor y padres InnoDB.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('fact_facturas','cont_entidades','empresas','usuarios');
-- El nombre del índice nuevo no debe existir con otra definición.
SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fact_facturas' AND INDEX_NAME='uq_factura_ambito' ORDER BY SEQ_IN_INDEX;
-- Constraints FEL previas (deben estar ausentes, o presentes solo si la tabla ya existe íntegra = NOOP).
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'fel\_%' ORDER BY TABLE_NAME, CONSTRAINT_NAME;
-- Nombre de constraint en conflicto en OTRA tabla (los nombres FK/CHECK deben ser únicos por esquema para CHECK).
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME NOT LIKE 'fel\_%' AND CONSTRAINT_NAME LIKE '%fel\_%';
-- Garantía de que el UNIQUE aditivo se cumple (debe devolver 0 filas; id es PK).
SELECT empresa_id, entidad_id, id, COUNT(*) AS n FROM fact_facturas GROUP BY empresa_id, entidad_id, id HAVING n > 1;
-- APLICAR: MariaDB 11.8.9, FK/CHECK ON, ninguna tabla fel_* existe, uq_factura_ambito ausente,
-- entidad_id INT NULL en fact_facturas, padres InnoDB con PK(id) y UNIQUE cont_entidades(empresa_id,id).
-- NOOP: las 4 tablas fel_* existen y SHOW CREATE coincide íntegramente con migrate-2026-10-fel-2a-modelo.sql
--       (columnas, defaults, índices, FKs RESTRICT/RESTRICT, CHECKs, columna generada factura_viva y collation).
-- DETENER: tabla parcial, constraint en conflicto, padre no InnoDB, índice uq_factura_ambito con otra definición o drift.
-- No automatizar un resultado APTO cuando falta evidencia física. NO hay seeds ni backfill.
