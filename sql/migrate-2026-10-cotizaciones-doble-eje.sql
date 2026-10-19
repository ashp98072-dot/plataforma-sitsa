-- PROPUESTA DE ALTA: NO ejecutada. No cambia esquema ni CABEZAL.
-- Ejecutar preflight primero y continuar SOLO si devuelve APLICAR.
-- Completar slug y actor; cambiar aplicar a 1 solo tras aprobar el preview.
SET @doble_eje_slug = 'REEMPLAZAR_SLUG_EMPRESA';
SET @doble_eje_actor = 'REEMPLAZAR_USUARIO';
SET @doble_eje_aplicar = 0;
INSERT INTO tms_cotizacion_costeo_perfiles (
  empresa_id, codigo, nombre, activo, costo_adquisicion, dias_operacion_mes, gps_mensual, seguro_vehiculo_mensual, costo_aceite_servicio, vida_util_aceite_km, costo_juego_llantas, vida_util_llantas_km, rendimiento_km_galon, deprec_valor_base, deprec_anios, deprec_dias_operacion_mes, refrig_valor_base, refrig_anios, refrig_dias_operacion_mes, viajes_mes, precio_llanta, cantidad_llantas, salario_piloto_mensual, salario_auxiliar_mensual, viaticos_hotel_viaje, auxiliar_multiplica_dias, viaticos_hotel_multiplica_dias, creado_por
)
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
  c.viaticos_hotel_multiplica_dias AS viaticos_hotel_multiplica_dias,
  @doble_eje_actor AS creado_por
FROM tms_cotizacion_costeo_perfiles c
JOIN empresas e ON e.id = c.empresa_id
WHERE e.slug = @doble_eje_slug AND @doble_eje_slug <> 'REEMPLAZAR_SLUG_EMPRESA'
  AND c.codigo = 'CABEZAL'
  AND c.activo = 1 AND c.dias_operacion_mes > 0 AND c.vida_util_aceite_km > 0
    AND c.vida_util_llantas_km > 0 AND c.rendimiento_km_galon > 0
    AND c.deprec_dias_operacion_mes > 0
  AND @doble_eje_actor <> 'REEMPLAZAR_USUARIO' AND CHAR_LENGTH(TRIM(@doble_eje_actor)) BETWEEN 1 AND 100
  AND @doble_eje_aplicar = 1
  AND NOT EXISTS (SELECT 1 FROM tms_cotizacion_costeo_perfiles p
    WHERE p.empresa_id = c.empresa_id AND p.codigo = 'DOBLE_EJE');
SELECT ROW_COUNT() AS perfiles_insertados;
-- Esperado: 1 en el alta; 0 al repetir. Un conflicto concurrente de UNIQUE aborta: nunca sobrescribe.
