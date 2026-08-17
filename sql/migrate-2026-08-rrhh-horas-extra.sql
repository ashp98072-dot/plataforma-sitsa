-- Fase 4 (autogestión RRHH): registro de horas extra por el supervisor.
-- Seguro para re-ejecutar (phpMyAdmin). Si algo ya existe, se omite sin romper el resto.
--
-- A diferencia de solicitudes_vacaciones (colaborador solicita, RRHH aprueba),
-- aquí el supervisor registra directamente las horas de su subordinado — sin
-- bandeja de aprobación intermedia, según se definió con el cliente. El monto
-- calculado se guarda también en rrhh_prestaciones (tipo 'Horas extra') para
-- que se sume automáticamente al neto de planilla, igual que cualquier otro
-- ingreso adicional ya soportado en generarLineasPeriodo.
SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS horas_extra_registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha DATE NOT NULL,
  horas DECIMAL(5,2) NOT NULL,
  tarifa_hora DECIMAL(10,4) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  motivo TEXT NULL,
  registrado_por_id INT NOT NULL,
  registrado_por_nombre VARCHAR(150) NOT NULL,
  prestacion_id INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_horext_empresa_emp (empresa_id, id_empleado),
  INDEX idx_horext_supervisor (empresa_id, registrado_por_id),
  CONSTRAINT fk_horext_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_horext_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_horext_supervisor FOREIGN KEY (registrado_por_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_horext_prestacion FOREIGN KEY (prestacion_id) REFERENCES rrhh_prestaciones(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;