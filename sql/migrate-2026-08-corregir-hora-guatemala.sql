-- Corrige timestamps guardados en UTC (reloj de pared) → hora Guatemala (UTC-6).
-- Guatemala no usa horario de verano. Ejecutar UNA sola vez en Hostinger/phpMyAdmin.
-- Marcajes: la app también aplica tz_guatemala_marcajes_v1 sola al abrir Marcajes.
-- No volver a ejecutar (doblaría el ajuste).

UPDATE sesiones_trabajo
SET
  entrada_at = DATE_SUB(entrada_at, INTERVAL 6 HOUR),
  salida_at = IF(salida_at IS NULL, NULL, DATE_SUB(salida_at, INTERVAL 6 HOUR));

UPDATE sesiones_trabajo
SET fecha_jornada = DATE(entrada_at)
WHERE entrada_at IS NOT NULL;

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

-- Marca migración de marcajes como hecha (evita doble ajuste por la app)
CREATE TABLE IF NOT EXISTS sitsa_migrations (
  id VARCHAR(64) PRIMARY KEY,
  aplicado_at DATETIME NOT NULL
);
INSERT IGNORE INTO sitsa_migrations (id, aplicado_at)
VALUES ('tz_guatemala_marcajes_v1', NOW());
