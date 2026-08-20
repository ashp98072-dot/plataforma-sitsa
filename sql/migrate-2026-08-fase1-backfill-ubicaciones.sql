-- Fase 1, paso 2/3 (portal pilotos / marcaje multiubicación): backfill.
-- Copia la geocerca vieja (tabla configuracion: geocerca_activa/lat/lng/radio_m)
-- a ubicaciones_marcaje como "Sede principal", una sola vez por empresa.
-- No borra ni toca la configuración vieja — sigue existiendo igual.
-- Seguro para re-ejecutar: si la empresa ya tiene alguna fila en
-- ubicaciones_marcaje, se omite (NOT EXISTS).
SET NAMES utf8mb4;

INSERT INTO ubicaciones_marcaje (empresa_id, nombre, lat, lng, radio_m, activa)
SELECT
  c_activa.empresa_id,
  'Sede principal',
  CAST(c_lat.valor AS DECIMAL(10,7)),
  CAST(c_lng.valor AS DECIMAL(10,7)),
  COALESCE(NULLIF(c_radio.valor, ''), '150') + 0,
  1
FROM configuracion c_activa
JOIN configuracion c_lat
  ON c_lat.empresa_id = c_activa.empresa_id AND c_lat.parametro = 'geocerca_lat'
JOIN configuracion c_lng
  ON c_lng.empresa_id = c_activa.empresa_id AND c_lng.parametro = 'geocerca_lng'
LEFT JOIN configuracion c_radio
  ON c_radio.empresa_id = c_activa.empresa_id AND c_radio.parametro = 'geocerca_radio_m'
WHERE c_activa.parametro = 'geocerca_activa'
  AND c_activa.valor = '1'
  AND c_lat.valor IS NOT NULL AND c_lat.valor <> ''
  AND c_lng.valor IS NOT NULL AND c_lng.valor <> ''
  AND NOT EXISTS (
    SELECT 1 FROM ubicaciones_marcaje u WHERE u.empresa_id = c_activa.empresa_id
  );