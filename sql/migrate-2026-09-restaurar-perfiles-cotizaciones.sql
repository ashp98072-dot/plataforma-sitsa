-- Restauración ADITIVA de perfiles de unidad, no ejecutada por este PR.
-- Ejecutar manualmente SOLO tras revisar docs/COTIZACIONES-RESTAURACION-PERFILES-EXCEL.md
-- y obtener APLICAR en sql/preflight-2026-09-restaurar-perfiles-cotizaciones.sql.
-- Seleccionar primero la base correcta y sustituir el slug exacto. NO hay
-- DELETE/TRUNCATE/UPDATE/REPLACE, ni escrituras en cotizaciones/snapshots.
-- El bloqueo de lote impide insertar si ya existe cualquiera de los cinco
-- códigos en este tenant. Repetición completa = NOOP; estado parcial = NOOP
-- sin sobrescritura y requiere resolver DETENER del preflight.

SET @restauracion_perfiles_slug = 'REEMPLAZAR_SLUG_EMPRESA';
SET @restauracion_perfiles_empresa_id = (
  SELECT id FROM empresas WHERE slug = @restauracion_perfiles_slug
);
SET @restauracion_perfiles_codigos_existentes = (
  SELECT COUNT(*) FROM tms_cotizacion_costeo_perfiles
  WHERE empresa_id = @restauracion_perfiles_empresa_id
    AND codigo IN ('CAMION_2_7T', 'CAMION_5T', 'CAMION_5T_REFRIGERADO', 'CAMION_10T', 'CABEZAL')
);

-- Cinco perfiles, nombres/códigos estables del motor. costo_adquisicion es
-- NULL: el workbook ofrece base de depreciación, no adquisición independiente.
-- GPS/seguro son mensuales; aceite es por servicio; llantas es juego completo.
INSERT INTO tms_cotizacion_costeo_perfiles (
  empresa_id, codigo, nombre, activo, costo_adquisicion, dias_operacion_mes,
  gps_mensual, seguro_vehiculo_mensual, costo_aceite_servicio,
  vida_util_aceite_km, costo_juego_llantas, vida_util_llantas_km,
  rendimiento_km_galon, deprec_valor_base, deprec_anios,
  deprec_dias_operacion_mes, refrig_valor_base, refrig_anios,
  refrig_dias_operacion_mes, creado_por
)
SELECT @restauracion_perfiles_empresa_id, x.codigo, x.nombre, 1, NULL, x.dias,
       x.gps, x.seguro, x.aceite, x.vida_aceite, x.llantas, x.vida_llantas,
       x.rendimiento, x.deprec_base, x.deprec_anios, x.deprec_dias,
       x.refrig_base, x.refrig_anios, x.refrig_dias, NULL
FROM (
  SELECT 'CAMION_2_7T' codigo, 'Camión 2.7 toneladas' nombre, 30 dias, 140 gps, 1150 seguro,
         1350 aceite, 5000 vida_aceite, 5000 llantas, 50000 vida_llantas, 22 rendimiento,
         150000 deprec_base, 5 deprec_anios, 26 deprec_dias,
         CAST(NULL AS DECIMAL(14,2)) refrig_base, CAST(NULL AS DECIMAL(5,2)) refrig_anios,
         CAST(NULL AS DECIMAL(5,2)) refrig_dias
  UNION ALL SELECT 'CAMION_5T', 'Camión 5 toneladas', 30, 140, 1150, 1500, 5000, 6900, 50000, 17, 182142.86, 5, 26, NULL, NULL, NULL
  UNION ALL SELECT 'CAMION_5T_REFRIGERADO', 'Camión 5 toneladas refrigerado', 30, 140, 1150, 1500, 5000, 7800, 50000, 14, 182142.86, 5, 26, 100000, 5, 26
  UNION ALL SELECT 'CAMION_10T', 'Camión 10 toneladas', 30, 140, 1150, 2500, 5000, 9900, 50000, 9.5, 120000, 5, 26, NULL, NULL, NULL
  UNION ALL SELECT 'CABEZAL', 'Cabezal', 30, 140, 1150, 3000, 5000, 10200, 50000, 8, 250000, 5, 26, NULL, NULL, NULL
) x
WHERE @restauracion_perfiles_empresa_id IS NOT NULL
  AND @restauracion_perfiles_slug <> 'REEMPLAZAR_SLUG_EMPRESA'
  AND @restauracion_perfiles_codigos_existentes = 0;

-- Lectura final: 5 nuevos registros solo en el tenant aprobado, 0 en NOOP.
SELECT codigo, nombre, activo, rendimiento_km_galon
FROM tms_cotizacion_costeo_perfiles
WHERE empresa_id = @restauracion_perfiles_empresa_id
  AND codigo IN ('CAMION_2_7T', 'CAMION_5T', 'CAMION_5T_REFRIGERADO', 'CAMION_10T', 'CABEZAL')
ORDER BY codigo;
