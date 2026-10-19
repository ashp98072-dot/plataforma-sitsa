-- PREFLIGHT CxC-1 (SOLO LECTURA). Ejecutar las sentencias una por una en la BD real ANTES de la migración.
SELECT DATABASE() AS bd, VERSION() AS version, @@foreign_key_checks AS fks, @@check_constraint_checks AS checks;
SHOW TABLES LIKE 'fact_cobros';
SHOW TABLES LIKE 'fact_cobro_aplicaciones';
SHOW COLUMNS FROM fact_pago_confirmaciones LIKE 'cobro_id';
SHOW CREATE TABLE fact_facturas;
SHOW CREATE TABLE fact_pagos;
SHOW CREATE TABLE fact_pago_confirmaciones;
SHOW CREATE TABLE cont_entidades;
SHOW CREATE TABLE clientes;
SHOW CREATE TABLE usuarios;
-- Datos que la nueva regla de saldo debe respetar (informativo):
SELECT COUNT(*) AS facturas_con_pagos_legados FROM (SELECT factura_id FROM fact_pagos GROUP BY factura_id) t;
SELECT COUNT(*) AS facturas_sin_entidad_emitidas FROM fact_facturas WHERE entidad_id IS NULL AND estado_admin = 'Emitida';
-- APLICAR: las dos tablas y la columna cobro_id NO existen; MariaDB 11.8.x; FK y CHECK activos; fact_facturas, clientes y usuarios con PK(id) INT
--          y cont_entidades con UNIQUE (empresa_id, id); fact_pago_confirmaciones existe (PR B aplicado).
-- NOOP:    las dos tablas y la columna ya existen con el DDL de la migración (comparar SHOW CREATE TABLE): no ejecutar nada.
-- DETENER: solo existe una parte (estado parcial), el DDL difiere, falta fact_pago_confirmaciones o algún padre es incompatible.
-- Las facturas históricas SIN entidad no podrán recibir cobros por este modelo (el cobro exige entidad); siguen con el flujo legado fact_pagos.
