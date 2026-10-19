-- POSTCHECK CxC-1 (SOLO LECTURA), después de migrar y también periódicamente. Todo resultado de "problemas" debe devolver 0 filas.
SHOW CREATE TABLE fact_cobros;
SHOW CREATE TABLE fact_cobro_aplicaciones;
SHOW COLUMNS FROM fact_pago_confirmaciones LIKE 'cobro_id';
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN ('fk_fcobro_entidad','fk_fcobro_cliente','fk_fcobro_actor','fk_fcobro_anulador','fk_fcapl_cobro','fk_fcapl_factura','fk_fpc_cobro');
-- 1) Aplicaciones cuya factura no coincide en empresa/entidad/cliente con el cobro (debe ser 0 filas):
SELECT a.id AS aplicacion_id, a.cobro_id, a.factura_id FROM fact_cobro_aplicaciones a
  JOIN fact_cobros c ON c.id = a.cobro_id
  JOIN fact_facturas f ON f.id = a.factura_id
 WHERE f.empresa_id <> c.empresa_id OR f.entidad_id IS NULL OR f.entidad_id <> c.entidad_id OR f.cliente_id <> c.cliente_id;
-- 2) Cobros cuyo monto_total no es la suma de sus aplicaciones, o sin aplicaciones (debe ser 0 filas):
SELECT c.id AS cobro_id, c.monto_total, COALESCE(SUM(a.monto), 0) AS suma_aplicaciones FROM fact_cobros c
  LEFT JOIN fact_cobro_aplicaciones a ON a.cobro_id = c.id GROUP BY c.id, c.monto_total HAVING COALESCE(SUM(a.monto), 0) <> c.monto_total;
-- 3) Facturas sobreaplicadas: pagos legados + aplicaciones VIGENTES > monto_total (debe ser 0 filas):
SELECT f.id AS factura_id, f.monto_total, COALESCE(p.total, 0) + COALESCE(ap.total, 0) AS aplicado
  FROM fact_facturas f
  LEFT JOIN (SELECT factura_id, SUM(monto) AS total FROM fact_pagos GROUP BY factura_id) p ON p.factura_id = f.id
  LEFT JOIN (SELECT a.factura_id, SUM(a.monto) AS total FROM fact_cobro_aplicaciones a JOIN fact_cobros c ON c.id = a.cobro_id AND c.estado = 'VIGENTE' GROUP BY a.factura_id) ap ON ap.factura_id = f.id
 WHERE f.estado_admin = 'Emitida' AND COALESCE(p.total, 0) + COALESCE(ap.total, 0) > f.monto_total;
-- 4) Confirmaciones bancarias ACTIVAS vinculadas a un cobro ANULADO (debe ser 0 filas):
SELECT p.id AS confirmacion_id, p.cobro_id FROM fact_pago_confirmaciones p JOIN fact_cobros c ON c.id = p.cobro_id WHERE c.estado = 'ANULADO' AND p.estado = 'CONFIRMADA';
-- 5) Resumen informativo:
SELECT COUNT(*) AS cobros, SUM(estado = 'VIGENTE') AS vigentes, SUM(estado = 'ANULADO') AS anulados FROM fact_cobros;
