-- Corrige timestamps guardados en UTC (reloj de pared) → hora Guatemala (UTC-6).
-- Guatemala no usa horario de verano. Ejecutar UNA sola vez en Hostinger/phpMyAdmin.
-- No volver a ejecutar tras el deploy del fix America/Guatemala (doblaría el ajuste).

UPDATE flota_viajes
SET
  hora_salida = DATE_SUB(hora_salida, INTERVAL 6 HOUR),
  hora_llegada = IF(hora_llegada IS NULL, NULL, DATE_SUB(hora_llegada, INTERVAL 6 HOUR));

UPDATE flota_viaje_evidencias
SET
  capturado_en = IF(capturado_en IS NULL, NULL, DATE_SUB(capturado_en, INTERVAL 6 HOUR)),
  creado_at = IF(creado_at IS NULL, NULL, DATE_SUB(creado_at, INTERVAL 6 HOUR));

UPDATE flota_lecturas
SET
  capturado_en = IF(capturado_en IS NULL, NULL, DATE_SUB(capturado_en, INTERVAL 6 HOUR));

UPDATE flota_lectura_evidencias
SET
  capturado_en = IF(capturado_en IS NULL, NULL, DATE_SUB(capturado_en, INTERVAL 6 HOUR)),
  creado_at = IF(creado_at IS NULL, NULL, DATE_SUB(creado_at, INTERVAL 6 HOUR));
