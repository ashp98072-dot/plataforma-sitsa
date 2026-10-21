-- SOLO LECTURA. Preflight de sql/migrate-2026-10-fact-3-anuladas-historico.sql. No modifica nada.
-- Revisar cada resultado ANTES de aplicar la migración. NO ejecutado en Hostinger/producción.

-- 1) Las tablas base existen, son InnoDB y sus `id` son INT (la nueva tabla enlaza a ellas con FK del mismo tipo).
SHOW COLUMNS FROM fact_facturas WHERE Field = 'id';
SHOW COLUMNS FROM tms_planes_viaje WHERE Field = 'id';
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('fact_facturas', 'fact_factura_viajes', 'tms_planes_viaje');

-- 2) ANTES de migrar, la tabla nueva NO debe existir (0 filas). Si existe, la migración ya se aplicó: es idempotente.
SHOW TABLES LIKE 'fact_factura_viajes_anuladas';

-- 3) La garantía anti doble facturación sigue vigente y NO se toca: debe existir UNIQUE uq_factviaje_plan sobre plan_id.
SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan';

-- 4) Las columnas de fotografía de FACT-2 que la copia lee deben existir (12 filas).
SHOW COLUMNS FROM fact_factura_viajes WHERE Field IN
  ('codigo_viaje_snapshot','fecha_viaje_snapshot','ruta_codigo_snapshot','origen_snapshot','destino_snapshot',
   'descripcion','cantidad','precio_incluye_iva','porcentaje_iva','base_monto','iva_monto','total_linea');

-- 5) Facturas por estado. Las Anuladas que ya existen perdieron sus líneas con el comportamiento anterior (se borraban
--    al anular): la migración NO las recupera ni las infiere; seguirán «sin detalle». Solo se informan aquí.
SELECT estado_admin, COUNT(*) AS facturas FROM fact_facturas GROUP BY estado_admin;

-- 6) Debe devolver 0: ninguna factura Anulada conserva líneas ACTIVAS (si devolviera filas, habría que revisarlas antes).
SELECT COUNT(*) AS lineas_activas_en_anuladas
FROM fact_factura_viajes ffv
INNER JOIN fact_facturas f ON f.id = ffv.factura_id
WHERE f.estado_admin = 'Anulada';

-- 7) Detalle de las Anuladas existentes (sin líneas; solo para saber cuáles quedarán sin histórico).
SELECT f.id, f.empresa_id, f.numero_factura, f.monto_total, f.actualizado_en
FROM fact_facturas f
WHERE f.estado_admin = 'Anulada'
ORDER BY f.id;
