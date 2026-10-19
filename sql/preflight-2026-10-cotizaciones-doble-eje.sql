-- PROPUESTA SOLO LECTURA: no ejecutada. SET configura solo esta sesión.
-- Elegir empresa explícita; nunca tomar DATABASE() como identidad de tenant.
SET @doble_eje_slug = 'REEMPLAZAR_SLUG_EMPRESA';
SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
WITH esperado AS (
SELECT
  c.empresa_id AS empresa_id,
  'DOBLE_EJE' AS codigo,
  'Doble eje' AS nombre,
  1 AS activo,
  275000 AS costo_adquisicion,
  c.dias_operacion_mes AS dias_operacion_mes,
  100 AS gps_mensual,
  1250 AS seguro_vehiculo_mensual,
  2400 AS costo_aceite_servicio,
  c.vida_util_aceite_km AS vida_util_aceite_km,
  26820 AS costo_juego_llantas,
  c.vida_util_llantas_km AS vida_util_llantas_km,
  c.rendimiento_km_galon AS rendimiento_km_galon,
  275000 AS deprec_valor_base,
  5 AS deprec_anios,
  c.deprec_dias_operacion_mes AS deprec_dias_operacion_mes,
  c.refrig_valor_base AS refrig_valor_base,
  c.refrig_anios AS refrig_anios,
  c.refrig_dias_operacion_mes AS refrig_dias_operacion_mes,
  c.viajes_mes AS viajes_mes,
  1490 AS precio_llanta,
  18 AS cantidad_llantas,
  9388.59 AS salario_piloto_mensual,
  6046.73 AS salario_auxiliar_mensual,
  250 AS viaticos_hotel_viaje,
  c.auxiliar_multiplica_dias AS auxiliar_multiplica_dias,
  c.viaticos_hotel_multiplica_dias AS viaticos_hotel_multiplica_dias
FROM tms_cotizacion_costeo_perfiles c
JOIN empresas e ON e.id = c.empresa_id
WHERE e.slug = @doble_eje_slug AND @doble_eje_slug <> 'REEMPLAZAR_SLUG_EMPRESA'
  AND c.codigo = 'CABEZAL'
), base_valida AS (
  SELECT c.id FROM tms_cotizacion_costeo_perfiles c
JOIN empresas e ON e.id = c.empresa_id
WHERE e.slug = @doble_eje_slug AND @doble_eje_slug <> 'REEMPLAZAR_SLUG_EMPRESA'
  AND c.codigo = 'CABEZAL' AND c.activo = 1 AND c.dias_operacion_mes > 0 AND c.vida_util_aceite_km > 0
    AND c.vida_util_llantas_km > 0 AND c.rendimiento_km_galon > 0
    AND c.deprec_dias_operacion_mes > 0
)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM esperado) <> 1 OR (SELECT COUNT(*) FROM base_valida) <> 1 THEN 'DETENER'
  WHEN NOT EXISTS (SELECT 1 FROM tms_cotizacion_costeo_perfiles p JOIN esperado x ON p.empresa_id=x.empresa_id WHERE p.codigo='DOBLE_EJE') THEN 'APLICAR'
  WHEN EXISTS (SELECT 1 FROM tms_cotizacion_costeo_perfiles p JOIN esperado x ON p.empresa_id=x.empresa_id
    WHERE p.empresa_id <=> x.empresa_id
      AND p.codigo <=> x.codigo
      AND p.nombre <=> x.nombre
      AND p.activo <=> x.activo
      AND p.costo_adquisicion <=> x.costo_adquisicion
      AND p.dias_operacion_mes <=> x.dias_operacion_mes
      AND p.gps_mensual <=> x.gps_mensual
      AND p.seguro_vehiculo_mensual <=> x.seguro_vehiculo_mensual
      AND p.costo_aceite_servicio <=> x.costo_aceite_servicio
      AND p.vida_util_aceite_km <=> x.vida_util_aceite_km
      AND p.costo_juego_llantas <=> x.costo_juego_llantas
      AND p.vida_util_llantas_km <=> x.vida_util_llantas_km
      AND p.rendimiento_km_galon <=> x.rendimiento_km_galon
      AND p.deprec_valor_base <=> x.deprec_valor_base
      AND p.deprec_anios <=> x.deprec_anios
      AND p.deprec_dias_operacion_mes <=> x.deprec_dias_operacion_mes
      AND p.refrig_valor_base <=> x.refrig_valor_base
      AND p.refrig_anios <=> x.refrig_anios
      AND p.refrig_dias_operacion_mes <=> x.refrig_dias_operacion_mes
      AND p.viajes_mes <=> x.viajes_mes
      AND p.precio_llanta <=> x.precio_llanta
      AND p.cantidad_llantas <=> x.cantidad_llantas
      AND p.salario_piloto_mensual <=> x.salario_piloto_mensual
      AND p.salario_auxiliar_mensual <=> x.salario_auxiliar_mensual
      AND p.viaticos_hotel_viaje <=> x.viaticos_hotel_viaje
      AND p.auxiliar_multiplica_dias <=> x.auxiliar_multiplica_dias
      AND p.viaticos_hotel_multiplica_dias <=> x.viaticos_hotel_multiplica_dias) THEN 'NOOP'
  ELSE 'DETENER'
END AS resultado;
-- Preview completo: comparar antes de autorizar el alta. No contiene datos de otros tenants.
SELECT
  c.empresa_id AS empresa_id,
  'DOBLE_EJE' AS codigo,
  'Doble eje' AS nombre,
  1 AS activo,
  275000 AS costo_adquisicion,
  c.dias_operacion_mes AS dias_operacion_mes,
  100 AS gps_mensual,
  1250 AS seguro_vehiculo_mensual,
  2400 AS costo_aceite_servicio,
  c.vida_util_aceite_km AS vida_util_aceite_km,
  26820 AS costo_juego_llantas,
  c.vida_util_llantas_km AS vida_util_llantas_km,
  c.rendimiento_km_galon AS rendimiento_km_galon,
  275000 AS deprec_valor_base,
  5 AS deprec_anios,
  c.deprec_dias_operacion_mes AS deprec_dias_operacion_mes,
  c.refrig_valor_base AS refrig_valor_base,
  c.refrig_anios AS refrig_anios,
  c.refrig_dias_operacion_mes AS refrig_dias_operacion_mes,
  c.viajes_mes AS viajes_mes,
  1490 AS precio_llanta,
  18 AS cantidad_llantas,
  9388.59 AS salario_piloto_mensual,
  6046.73 AS salario_auxiliar_mensual,
  250 AS viaticos_hotel_viaje,
  c.auxiliar_multiplica_dias AS auxiliar_multiplica_dias,
  c.viaticos_hotel_multiplica_dias AS viaticos_hotel_multiplica_dias
FROM tms_cotizacion_costeo_perfiles c
JOIN empresas e ON e.id = c.empresa_id
WHERE e.slug = @doble_eje_slug AND @doble_eje_slug <> 'REEMPLAZAR_SLUG_EMPRESA'
  AND c.codigo = 'CABEZAL';
