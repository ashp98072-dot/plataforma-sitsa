-- SOLO LECTURA. Preflight de sql/migrate-2026-10-fact-2-borrador-snapshots-iva.sql. No modifica nada.

-- 1) Las tablas base existen y qué columnas tienen hoy (las nuevas aún no deben aparecer).
SHOW COLUMNS FROM fact_facturas;
SHOW COLUMNS FROM fact_factura_viajes;

-- 2) La garantía anti doble facturación sigue vigente (debe existir UNIQUE uq_factviaje_plan sobre plan_id).
SHOW INDEX FROM fact_factura_viajes;

-- 3) Cuántas filas existen hoy (se quedarán con snapshot NULL; la aplicación las muestra con los datos que ya tienen).
SELECT estado_admin, COUNT(*) AS facturas FROM fact_facturas GROUP BY estado_admin;
SELECT COUNT(*) AS lineas FROM fact_factura_viajes;

-- 4) Las columnas que el código FACT-2 lee de tms_planes_viaje deben existir.
SHOW COLUMNS FROM tms_planes_viaje WHERE Field IN
  ('ruta_codigo_historico','lugar_carga_id','lugar_descarga_id','lugar_descarga_historico',
   'tarifa_moneda_historico','tarifa_comercial','piloto_externo_nombre');
