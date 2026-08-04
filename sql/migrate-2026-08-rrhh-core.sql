-- RRHH core (desde web/asistencias) — ejecutar en phpMyAdmin sobre la DB de la plataforma.
SET NAMES utf8mb4;

-- Config por empresa
CREATE TABLE IF NOT EXISTS configuracion (
  empresa_id INT NOT NULL,
  parametro VARCHAR(100) NOT NULL,
  valor TEXT NOT NULL,
  PRIMARY KEY (empresa_id, parametro),
  CONSTRAINT fk_cfg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feriados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  descripcion VARCHAR(200) NOT NULL,
  fecha DATE NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_feriado (empresa_id, fecha),
  CONSTRAINT fk_fer_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Saldos vacaciones FIFO
CREATE TABLE IF NOT EXISTS saldos_vacaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  anio_laboral INT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fin DATE NOT NULL,
  dias_otorgados DECIMAL(8,2) NOT NULL DEFAULT 0,
  dias_disponibles DECIMAL(8,2) NOT NULL DEFAULT 0,
  estado VARCHAR(30) NOT NULL DEFAULT 'Vigente',
  UNIQUE KEY uq_saldo_periodo (id_empleado, periodo_inicio, periodo_fin),
  CONSTRAINT fk_saldo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_saldo_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS detalle_consumo_vacaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incidencia_id INT NOT NULL,
  saldo_id INT NOT NULL,
  dias_tomados DECIMAL(8,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_det_inc FOREIGN KEY (incidencia_id) REFERENCES incidencias(id) ON DELETE CASCADE,
  CONSTRAINT fk_det_saldo FOREIGN KEY (saldo_id) REFERENCES saldos_vacaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marcajes_en_ruta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  comentario TEXT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ruta_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ruta_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Incidencias: subtipo
ALTER TABLE incidencias
  ADD COLUMN subtipo VARCHAR(80) NULL AFTER tipo;

-- Sesiones: viaje largo + estados web + permitir sesión abierta multi-día
ALTER TABLE sesiones_trabajo
  ADD COLUMN viaje_largo TINYINT(1) NOT NULL DEFAULT 0 AFTER estado;

ALTER TABLE sesiones_trabajo DROP INDEX uq_sesion;
ALTER TABLE sesiones_trabajo
  ADD INDEX idx_sesion_emp_fecha (empresa_id, id_empleado, fecha_jornada);

UPDATE sesiones_trabajo SET estado = 'ABIERTA' WHERE estado IN ('En curso', 'en curso');
UPDATE sesiones_trabajo SET estado = 'CERRADA' WHERE estado IN ('Cerrada', 'cerrada');
