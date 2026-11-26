-- Diagnóstico de solo lectura. Ejecutar por separado con un cliente que admita
-- parámetros vinculados: empresa_id, inicio y fin exclusivo (YYYY-MM-DD).
-- No contiene credenciales ni imprime vales, pilotos o datos personales.
SELECT TABLE_NAME, ENGINE, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
 ('flota_combustible_cargas','flota_vehiculos','flota_cb2_consumos');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
 ('flota_combustible_cargas','flota_vehiculos','flota_cb2_consumos')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
 ('flota_combustible_cargas','flota_vehiculos','flota_cb2_consumos')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

-- Parámetros: empresa_id, inicio, fin. Comparar key, rows y Extra.
EXPLAIN SELECT c.vehiculo_id, v.placa, c.tipo_combustible,
 SUM(c.galones), SUM(c.monto), COUNT(*)
FROM flota_combustible_cargas c JOIN flota_vehiculos v ON v.id=c.vehiculo_id
WHERE c.empresa_id=? AND c.estado='APROBADO' AND c.creado_at>=? AND c.creado_at<?
GROUP BY c.vehiculo_id,v.placa,c.tipo_combustible ORDER BY v.placa;

-- Consulta integrada anterior (para comparar con el código actualmente desplegado).
-- Parámetros: empresa_id, inicio, fin, inicio, fin.
EXPLAIN SELECT c.id,c.vehiculo_id,v.placa,c.proveedor_id,c.numero_vale,c.fecha_consumo,c.creado_at,c.galones,c.precio_galon AS precio,c.monto,c.tipo_combustible FROM flota_combustible_cargas c
JOIN flota_vehiculos v ON v.id=c.vehiculo_id
WHERE c.empresa_id=? AND c.estado='APROBADO'
 AND ((c.creado_at>=? AND c.creado_at<?) OR (c.fecha_consumo>=? AND c.fecha_consumo<?));

-- Consulta integrada propuesta. Parámetros: empresa_id, inicio, fin.
EXPLAIN SELECT c.id,c.vehiculo_id,v.placa,c.proveedor_id,c.numero_vale,c.fecha_consumo,c.creado_at,c.galones,c.precio_galon AS precio,c.monto,c.tipo_combustible FROM flota_combustible_cargas c
JOIN flota_vehiculos v ON v.id=c.vehiculo_id
WHERE c.empresa_id=? AND c.estado='APROBADO' AND c.creado_at>=? AND c.creado_at<?;

-- Parámetros: empresa_id, inicio, fin.
EXPLAIN SELECT c.*,COALESCE(v.placa,c.placa_original) AS placa,c.creado_en AS creado_at FROM flota_cb2_consumos c
LEFT JOIN flota_vehiculos v ON v.id=c.vehiculo_id
WHERE c.empresa_id=? AND c.fecha_consumo>=? AND c.fecha_consumo<?;

-- Si la cuenta tiene permisos: solo contadores de espera; no listar SQL de otros usuarios.
SELECT COUNT(*) AS esperas_activas FROM information_schema.INNODB_LOCK_WAITS;
