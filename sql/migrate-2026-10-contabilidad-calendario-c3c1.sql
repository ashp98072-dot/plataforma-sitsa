-- C3C-1: PROPUESTA NO EJECUTADA. Solo runner scripts/ci/c3c1/run-windows.mjs.
-- No ejecutar directamente: el runner sustituye {{C3C1_SCHEMA}} solo tras verificar
-- pipe, proceso, datadir, base nueva e identidad privada de esta ejecucion.
-- Sin procedimientos auxiliares, DROP, ALTER, backfill ni datos reales.
-- DDL no es atomico entre tablas: ante error detenerse y conservar evidencia.
CREATE TABLE `{{C3C1_SCHEMA}}`.cont_ejercicios (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  codigo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIGURADO',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ce_codigo (empresa_id, entidad_id, codigo),
  UNIQUE KEY uq_ce_ambito (empresa_id, entidad_id, id),
  KEY ix_ce_fechas (empresa_id, entidad_id, fecha_inicio, fecha_fin),
  CONSTRAINT fk_ce_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES `{{C3C1_SCHEMA}}`.cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ce_actor FOREIGN KEY (creado_por) REFERENCES `{{C3C1_SCHEMA}}`.usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_ce_fechas CHECK (fecha_inicio >= '1000-01-01' AND fecha_fin >= fecha_inicio),
  CONSTRAINT ck_ce_estado CHECK (estado = 'CONFIGURADO'),
  CONSTRAINT ck_ce_codigo CHECK (codigo REGEXP '^[A-Z0-9_-]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `{{C3C1_SCHEMA}}`.cont_periodos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  ejercicio_id INT NOT NULL,
  codigo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIGURADO',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cp_codigo (empresa_id, entidad_id, ejercicio_id, codigo),
  UNIQUE KEY uq_cp_orden (empresa_id, entidad_id, ejercicio_id, orden),
  UNIQUE KEY uq_cp_ambito (empresa_id, entidad_id, id),
  CONSTRAINT fk_cp_ejercicio FOREIGN KEY (empresa_id, entidad_id, ejercicio_id) REFERENCES `{{C3C1_SCHEMA}}`.cont_ejercicios(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cp_actor FOREIGN KEY (creado_por) REFERENCES `{{C3C1_SCHEMA}}`.usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cp_fechas CHECK (fecha_inicio >= '1000-01-01' AND fecha_fin >= fecha_inicio),
  CONSTRAINT ck_cp_estado CHECK (estado = 'CONFIGURADO'),
  CONSTRAINT ck_cp_orden CHECK (orden BETWEEN 1 AND 366),
  CONSTRAINT ck_cp_codigo CHECK (codigo REGEXP '^[A-Z0-9_-]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
