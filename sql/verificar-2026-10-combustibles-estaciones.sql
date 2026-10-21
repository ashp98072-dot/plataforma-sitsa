-- SOLO LECTURA. Comparar conteo/IDs/textos con el preflight; cero backfill esperado.
SELECT DATABASE() AS base_objetivo;
SHOW CREATE TABLE flota_combustible_estaciones;
SHOW INDEX FROM flota_combustible_estaciones;
SHOW CREATE TABLE flota_combustible_cargas;
SHOW INDEX FROM flota_combustible_cargas;
SELECT COUNT(*) AS vales, MIN(id) AS primer_id, MAX(id) AS ultimo_id,
 SUM(gasolinera IS NOT NULL AND TRIM(gasolinera)<>'') AS con_texto_historico,
 SUM(estacion_id IS NOT NULL) AS con_estacion FROM flota_combustible_cargas;
SELECT COUNT(*) AS referencias_invalidas FROM flota_combustible_cargas c
LEFT JOIN flota_combustible_estaciones e ON e.id=c.estacion_id AND e.empresa_id=c.empresa_id AND e.proveedor_id=c.proveedor_id
WHERE c.estacion_id IS NOT NULL AND e.id IS NULL;
