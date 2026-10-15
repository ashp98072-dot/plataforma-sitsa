-- SOLO LECTURA. Comparar conteos/IDs con preflight y comprobar los archivos por separado.
SELECT DATABASE() AS base_objetivo;
SHOW CREATE TABLE flota_combustible_cargas;
SHOW FULL COLUMNS FROM flota_combustible_cargas;
SHOW INDEX FROM flota_combustible_cargas;
SELECT COUNT(*) AS registros, MIN(id) AS primer_id, MAX(id) AS ultimo_id,
 SUM(proveedor_id IS NULL) AS sin_proveedor,
 SUM(viaje_id IS NULL) AS sin_viaje, SUM(empleado_id IS NULL) AS sin_empleado,
 SUM(piloto_nombre IS NULL) AS sin_piloto FROM flota_combustible_cargas;
SELECT COUNT(*) AS usuarios_referenciados_inexistentes FROM flota_combustible_cargas c
LEFT JOIN usuarios creador ON creador.id=c.creado_por_usuario_id
LEFT JOIN usuarios revisor ON revisor.id=c.revisado_por_usuario_id
WHERE (c.creado_por_usuario_id IS NOT NULL AND creador.id IS NULL)
   OR (c.revisado_por_usuario_id IS NOT NULL AND revisor.id IS NULL);
SELECT COUNT(*) AS proveedores_ajenos_o_inexistentes FROM flota_combustible_cargas c
LEFT JOIN compras_proveedores p ON p.id=c.proveedor_id AND p.empresa_id=c.empresa_id
WHERE c.proveedor_id IS NOT NULL AND p.id IS NULL;
SELECT empresa_id, proveedor_id, UPPER(TRIM(numero_vale)) AS vale, COUNT(*) AS cantidad
FROM flota_combustible_cargas WHERE proveedor_id IS NOT NULL AND numero_vale IS NOT NULL
GROUP BY empresa_id, proveedor_id, UPPER(TRIM(numero_vale)) HAVING COUNT(*)>1;
