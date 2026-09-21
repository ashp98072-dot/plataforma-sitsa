-- Solo lectura. Ejecutar seleccionando primero la base de la plataforma.
-- Resultado: APLICAR si faltan ambas columnas, NOOP si ambas son exactas,
-- DETENER si existe una definición parcial o incompatible.
SET @schema_objetivo := DATABASE();

SELECT CASE
  WHEN @schema_objetivo IS NULL THEN 'DETENER'
  WHEN SUM(CASE WHEN table_name = 'tms_cliente_rutas' AND column_name = 'servicio_refrigerado_habitual'
                    AND data_type = 'tinyint' AND column_type = 'tinyint(1)' AND is_nullable = 'NO'
                    AND CAST(column_default AS DECIMAL(20,6)) = 0 THEN 1 ELSE 0 END) = 1
   AND SUM(CASE WHEN table_name = 'tms_cotizaciones' AND column_name = 'servicio_refrigerado'
                    AND data_type = 'tinyint' AND column_type = 'tinyint(1)' AND is_nullable = 'NO'
                    AND CAST(column_default AS DECIMAL(20,6)) = 0 THEN 1 ELSE 0 END) = 1 THEN 'NOOP'
  WHEN COALESCE(SUM(column_name IN ('servicio_refrigerado_habitual','servicio_refrigerado')), 0) = 0 THEN 'APLICAR'
  ELSE 'DETENER'
END AS resultado
FROM information_schema.columns
WHERE table_schema = @schema_objetivo
  AND ((table_name = 'tms_cliente_rutas' AND column_name = 'servicio_refrigerado_habitual')
    OR (table_name = 'tms_cotizaciones' AND column_name = 'servicio_refrigerado'));
