-- Recordatorios y bitácora legal de RRHH. Seguro para re-ejecutar (phpMyAdmin).
-- Si algo ya existe, se omite sin romper el resto.
SET NAMES utf8mb4;
SET @db := DATABASE();

-- Recordatorios: vencimientos y obligaciones con fecha (contratos,
-- obligaciones legales recurrentes, exámenes médicos, citas legales, etc.).
-- NOTA: los vencimientos de licencia de conducir NO se guardan aquí — se
-- calculan al vuelo desde empleados.licencia_vence, para no duplicar datos.
CREATE TABLE IF NOT EXISTS rrhh_recordatorios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  tipo VARCHAR(30) NOT NULL, -- Contrato | ObligacionLegal | ExamenMedico | CitaLegal | Otro
  titulo VARCHAR(200) NOT NULL,
  -- Fecha de la próxima (o única) ocurrencia. Para recurrentes, se usa el
  -- mes/día de esta fecha cada año; el año en sí se ignora al calcular la
  -- próxima ocurrencia.
  fecha DATE NOT NULL,
  recurrente TINYINT(1) NOT NULL DEFAULT 0,
  dias_aviso_previo INT NOT NULL DEFAULT 7,
  -- Empleado relacionado (fin de período de prueba, examen médico de X
  -- persona, etc.). NULL = recordatorio general de la empresa (aguinaldo,
  -- IGSS, bono 14).
  empleado_id INT NULL,
  notas TEXT NULL,
  -- Para NO recurrentes: fecha en que se marcó atendido (NULL = pendiente).
  atendido_en DATE NULL,
  -- Para recurrentes: año en que se atendió la ocurrencia de ESE año. Al
  -- cambiar el año calendario, vuelve a quedar pendiente automáticamente
  -- sin que nadie tenga que reactivarlo a mano.
  atendido_anio INT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_record_empresa_fecha (empresa_id, fecha),
  INDEX idx_record_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_record_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bitácora legal: registro histórico (amonestaciones, suspensiones,
-- despidos, gestiones generales, demandas/citas ya realizadas, etc.).
CREATE TABLE IF NOT EXISTS rrhh_bitacora_legal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  tipo VARCHAR(30) NOT NULL, -- Amonestacion | Suspension | Despido | GestionGeneral | Otro
  fecha DATE NOT NULL,
  descripcion TEXT NOT NULL,
  -- NULL = gestión general de la empresa, no de una persona específica.
  empleado_id INT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bitleg_empresa_fecha (empresa_id, fecha),
  INDEX idx_bitleg_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_bitleg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_bitleg_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;