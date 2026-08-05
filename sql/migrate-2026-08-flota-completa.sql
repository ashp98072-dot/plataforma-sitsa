-- Flota / Predios completa (paridad control-flota + Excel SITSA)
-- Ejecutar en MySQL Hostinger (u611730801_Plataforma)

ALTER TABLE flota_vehiculos
  ADD COLUMN IF NOT EXISTS descripcion VARCHAR(200) NULL AFTER modelo,
  ADD COLUMN IF NOT EXISTS color VARCHAR(80) NULL AFTER descripcion,
  ADD COLUMN IF NOT EXISTS tipo_combustible VARCHAR(40) NULL DEFAULT 'diesel' AFTER color,
  ADD COLUMN IF NOT EXISTS chasis VARCHAR(80) NULL AFTER tipo_combustible,
  ADD COLUMN IF NOT EXISTS capacidad VARCHAR(80) NULL AFTER chasis,
  ADD COLUMN IF NOT EXISTS credito VARCHAR(80) NULL AFTER capacidad,
  ADD COLUMN IF NOT EXISTS empresa_activo VARCHAR(120) NULL AFTER credito,
  ADD COLUMN IF NOT EXISTS nit VARCHAR(40) NULL AFTER empresa_activo,
  ADD COLUMN IF NOT EXISTS condicion_propiedad VARCHAR(120) NULL AFTER nit,
  ADD COLUMN IF NOT EXISTS seguros VARCHAR(120) NULL AFTER condicion_propiedad,
  ADD COLUMN IF NOT EXISTS motivo_taller VARCHAR(300) NULL AFTER fecha_entrada_taller,
  ADD COLUMN IF NOT EXISTS activo TINYINT(1) NOT NULL DEFAULT 1 AFTER estado,
  ADD COLUMN IF NOT EXISTS notas TEXT NULL AFTER activo;

-- MySQL antiguo sin IF NOT EXISTS en ADD COLUMN: usar procedimiento seguro abajo si falla.

ALTER TABLE flota_lecturas
  ADD COLUMN IF NOT EXISTS conductor VARCHAR(120) NULL AFTER nota;

ALTER TABLE flota_servicios
  ADD COLUMN IF NOT EXISTS tipo_trabajo VARCHAR(120) NULL AFTER tipo,
  ADD COLUMN IF NOT EXISTS dias_en_taller INT NULL AFTER descripcion,
  ADD COLUMN IF NOT EXISTS motivo_taller VARCHAR(300) NULL AFTER dias_en_taller;

CREATE TABLE IF NOT EXISTS flota_viajes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  piloto_nombre VARCHAR(120) NOT NULL,
  piloto_usuario_id INT NULL,
  km_salida INT NOT NULL,
  km_llegada INT NULL,
  hora_salida DATETIME NOT NULL,
  hora_llegada DATETIME NULL,
  destino VARCHAR(200) NULL,
  observaciones TEXT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'abierto',
  INDEX idx_fv_emp (empresa_id),
  INDEX idx_fv_veh (vehiculo_id),
  INDEX idx_fv_estado (empresa_id, estado),
  CONSTRAINT fk_fv_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fv_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
