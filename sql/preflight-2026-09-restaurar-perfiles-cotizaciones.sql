-- SOLO LECTURA de datos/esquema; no ejecutar la migración hasta confirmar
-- fuente, tenant y APLICAR. Seleccione antes la base correcta en phpMyAdmin.
-- Reemplace el slug en ESTA copia y en la migración; nunca suponga empresa_id=1.
-- No usa information_schema (no disponible para el usuario Hostinger).

SELECT VERSION() AS version_servidor, DATABASE() AS base_activa;
SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
SHOW INDEX FROM tms_cotizacion_costeo_perfiles;

-- Confirmar una sola empresa y su ID antes de revisar los registros.
SELECT id, slug, nombre FROM empresas WHERE slug = 'REEMPLAZAR_SLUG_EMPRESA';

-- Estado completo del tenant, incluidos códigos ajenos a esta recuperación.
SELECT p.id, p.empresa_id, p.codigo, p.nombre, p.activo,
       p.costo_adquisicion, p.dias_operacion_mes, p.gps_mensual,
       p.seguro_vehiculo_mensual, p.costo_aceite_servicio,
       p.vida_util_aceite_km, p.costo_juego_llantas, p.vida_util_llantas_km,
       p.rendimiento_km_galon, p.deprec_valor_base, p.deprec_anios,
       p.deprec_dias_operacion_mes, p.refrig_valor_base, p.refrig_anios,
       p.refrig_dias_operacion_mes
FROM tms_cotizacion_costeo_perfiles p
JOIN empresas e ON e.id = p.empresa_id
WHERE e.slug = 'REEMPLAZAR_SLUG_EMPRESA'
ORDER BY p.codigo;

-- APLICAR: ninguno de los cinco códigos existe.
-- NOOP: los cinco existen y cada valor coincide con el preview documentado.
-- DETENER: slug inexistente, situación parcial o cualquier divergencia.
-- Revisar además SHOW CREATE TABLE: si difiere de sql/schema.sql, DETENER
-- aunque el resultado de datos sea APLICAR/NOOP.
WITH esperados AS (
  SELECT 'CAMION_2_7T' codigo, 'Camión 2.7 toneladas' nombre, 30 dias, 140 gps, 1150 seguro,
         1350 aceite, 5000 vida_aceite, 5000 llantas, 50000 vida_llantas, 22 rendimiento,
         150000 deprec_base, 5 deprec_anios, 26 deprec_dias,
         CAST(NULL AS DECIMAL(14,2)) refrig_base, CAST(NULL AS DECIMAL(5,2)) refrig_anios,
         CAST(NULL AS DECIMAL(5,2)) refrig_dias
  UNION ALL SELECT 'CAMION_5T', 'Camión 5 toneladas', 30, 140, 1150, 1500, 5000, 6900, 50000, 17, 182142.86, 5, 26, NULL, NULL, NULL
  UNION ALL SELECT 'CAMION_5T_REFRIGERADO', 'Camión 5 toneladas refrigerado', 30, 140, 1150, 1500, 5000, 7800, 50000, 14, 182142.86, 5, 26, 100000, 5, 26
  UNION ALL SELECT 'CAMION_10T', 'Camión 10 toneladas', 30, 140, 1150, 2500, 5000, 9900, 50000, 9.5, 120000, 5, 26, NULL, NULL, NULL
  UNION ALL SELECT 'CABEZAL', 'Cabezal', 30, 140, 1150, 3000, 5000, 10200, 50000, 8, 250000, 5, 26, NULL, NULL, NULL
), comparacion AS (
  SELECT x.codigo, p.id,
    (p.id IS NOT NULL
     AND p.nombre = x.nombre AND p.activo = 1 AND p.costo_adquisicion IS NULL
     AND p.dias_operacion_mes = x.dias AND p.gps_mensual = x.gps
     AND p.seguro_vehiculo_mensual = x.seguro AND p.costo_aceite_servicio = x.aceite
     AND p.vida_util_aceite_km = x.vida_aceite AND p.costo_juego_llantas = x.llantas
     AND p.vida_util_llantas_km = x.vida_llantas AND p.rendimiento_km_galon = x.rendimiento
     AND p.deprec_valor_base <=> x.deprec_base AND p.deprec_anios <=> x.deprec_anios
     AND p.deprec_dias_operacion_mes <=> x.deprec_dias
     AND p.refrig_valor_base <=> x.refrig_base AND p.refrig_anios <=> x.refrig_anios
     AND p.refrig_dias_operacion_mes <=> x.refrig_dias) AS coincide
  FROM esperados x
  LEFT JOIN empresas e ON e.slug = 'REEMPLAZAR_SLUG_EMPRESA'
  LEFT JOIN tms_cotizacion_costeo_perfiles p ON p.empresa_id = e.id AND p.codigo = x.codigo
)
SELECT COUNT(*) AS perfiles_esperados, SUM(id IS NOT NULL) AS codigos_existentes,
       SUM(coincide = 1) AS perfiles_identicos,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM empresas WHERE slug = 'REEMPLAZAR_SLUG_EMPRESA') THEN 'DETENER'
         WHEN SUM(id IS NOT NULL) = 0 THEN 'APLICAR'
         WHEN SUM(coincide = 1) = COUNT(*) THEN 'NOOP'
         ELSE 'DETENER'
       END AS estado_datos
FROM comparacion;
