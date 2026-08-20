-- Fase 1, paso 1/3 (portal pilotos / marcaje multiubicación): tabla de
-- ubicaciones de marcaje. Todavía NO se usa en la validación real —
-- la geocerca vieja (geocerca_activa/lat/lng/radio_m en config) sigue
-- funcionando igual mientras tanto. Ver PLAN-PORTAL-PILOTOS.md.
-- Seguro para re-ejecutar (phpMyAdmin). Si algo ya existe, se omite sin romper el resto.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ubicaciones_marcaje (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  radio_m INT NOT NULL DEFAULT 150,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ubic_marcaje_empresa (empresa_id, activa),
  CONSTRAINT fk_ubic_marcaje_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;