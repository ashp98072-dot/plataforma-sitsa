-- SOLO LECTURA. Seleccionar explícitamente la BD objetivo en phpMyAdmin.
-- No ejecutar migrate hasta revisar TODOS los bloques. No implica aprobación automática.
SELECT VERSION() AS version_servidor, DATABASE() AS base_objetivo;
SHOW CREATE TABLE flota_combustible_cargas;
SHOW FULL COLUMNS FROM flota_combustible_cargas;
SHOW INDEX FROM flota_combustible_cargas;
SHOW TABLE STATUS LIKE 'flota_combustible_cargas';
SHOW CREATE TABLE flota_vehiculos;
SHOW CREATE TABLE flota_viajes;
SHOW CREATE TABLE compras_proveedores;
SHOW CREATE TABLE usuarios;
-- SHOW CREATE incluye TODAS las FK físicas: revisar acciones/tipos antes de cambiar nullability.
SELECT COUNT(*) AS registros, SUM(viaje_id IS NULL) AS sin_viaje,
 SUM(empleado_id IS NULL) AS sin_empleado, SUM(piloto_nombre IS NULL) AS sin_piloto,
 SUM(fecha_consumo IS NULL) AS sin_fecha,
 SUM(ruta_relativa IS NULL OR TRIM(ruta_relativa)='') AS sin_ruta_evidencia,
 MIN(creado_at) AS primer_registro, MAX(creado_at) AS ultimo_registro
FROM flota_combustible_cargas;
SELECT empresa_id, UPPER(TRIM(numero_vale)) AS vale, COUNT(*) AS cantidad
FROM flota_combustible_cargas WHERE numero_vale IS NOT NULL AND TRIM(numero_vale)<>''
GROUP BY empresa_id, UPPER(TRIM(numero_vale)) HAVING COUNT(*)>1;
-- No exponer nombres/documentos personales. Archivos físicos requieren una verificación separada de solo lectura.
SELECT COUNT(*) AS referencias_vehiculo_inexistente FROM flota_combustible_cargas c
LEFT JOIN flota_vehiculos v ON v.id=c.vehiculo_id WHERE v.id IS NULL;
SELECT COUNT(*) AS referencias_viaje_inexistente_o_ajeno FROM flota_combustible_cargas c
LEFT JOIN flota_viajes v ON v.id=c.viaje_id AND v.empresa_id=c.empresa_id
WHERE c.viaje_id IS NOT NULL AND v.id IS NULL;
-- APLICAR: esquema histórico esperado (INT signed, piloto VARCHAR(120)), tablas InnoDB,
-- sin FK/CHECK incompatible y sin referencias rotas. Campos nuevos ausentes.
-- Si C-1 previo ya agregó proveedor/observaciones, puede completarse tras comprobar sus tipos exactos y los IDs aún ausentes.
-- NOOP: proveedor_id/creado_por_usuario_id/revisado_por_usuario_id INT NULL y observaciones VARCHAR(1000) NULL,
-- con los tres campos legacy nullable. Sin backfill de históricos ni atribución retroactiva de usuarios.
-- DETENER: cualquier definición distinta/estado parcial no explicado, FK/CHECK incompatible o referencias rotas.
-- Duplicados históricos: reportar/revisar, NO borrar/normalizar/backfill ni añadir UNIQUE en C-1.
