-- [LAB B12] Tablas MÍNIMAS del TMS, SOLO para el laboratorio desechable de API-06A. NO es esquema de producción ni una migración.
-- Reproducen las columnas y CLAVES que usa src/lib/tms/parada-confirmacion.ts y a las que apuntan las claves foráneas de la migración propuesta:
--   tms_planes_viaje: UNIQUE (empresa_id, id) (sql/schema.sql: uq_tmsplanes_empresa_id) · tms_plan_paradas: PK id (src/lib/flota/schema.ts)
--   flota_viaje_evidencias (src/lib/flota/schema.ts) · tms_personal.id_empleado y tms_plan_pilotos_adicionales (consultas de viajes-piloto.ts) · auditoria (src/lib/auditoria.ts)
-- Sin claves foráneas ni datos: las pruebas B12 crean sus propias filas con la cuenta de aplicación del laboratorio.
CREATE TABLE tms_planes_viaje (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Programado',
  piloto_id INT NULL,
  UNIQUE KEY uq_plan (empresa_id, codigo),
  UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tms_plan_paradas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  orden TINYINT NOT NULL DEFAULT 1,
  lugar_id INT NULL,
  lugar_nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Entrega',
  requiere_evidencia TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_tpp_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tms_personal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Piloto',
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  id_empleado INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tms_plan_pilotos_adicionales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  personal_id INT NOT NULL,
  orden TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE flota_viajes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'abierto'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE flota_viaje_evidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  viaje_id INT NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  ruta_relativa VARCHAR(400) NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  mime VARCHAR(80) NULL,
  tamano INT NOT NULL DEFAULT 0,
  latitud DOUBLE NULL,
  longitud DOUBLE NULL,
  capturado_en DATETIME NULL,
  subido_por VARCHAR(100) NULL,
  creado_at DATETIME NOT NULL,
  parada_id INT NULL,
  INDEX idx_fve_viaje (viaje_id),
  INDEX idx_fve_emp (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NULL,
  usuario VARCHAR(100) NULL,
  accion VARCHAR(80) NOT NULL,
  modulo VARCHAR(40) NULL,
  detalle TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aud_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
