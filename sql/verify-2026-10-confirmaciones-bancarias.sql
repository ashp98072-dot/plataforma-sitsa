-- SOLO LECTURA, después de migrar. Sin confirmaciones históricas falsas.
SHOW CREATE TABLE fact_pago_confirmaciones;
SHOW INDEX FROM fact_pago_confirmaciones;
SELECT COUNT(*) AS confirmaciones, SUM(estado='CONFIRMADA') AS activas, SUM(estado='ANULADA') AS anuladas FROM fact_pago_confirmaciones;
SELECT COUNT(*) AS huerfanos_ambito FROM fact_pago_confirmaciones p
 LEFT JOIN fact_facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id AND f.entidad_id=p.entidad_id
 LEFT JOIN fact_pagos a ON a.id=p.pago_id AND a.empresa_id=p.empresa_id AND a.factura_id=p.factura_id
 WHERE f.id IS NULL OR (p.pago_id IS NOT NULL AND a.id IS NULL);
SELECT CONSTRAINT_NAME,TABLE_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE
 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='fact_pago_confirmaciones';
