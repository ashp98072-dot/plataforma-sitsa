-- Planilla: líneas de nómina + control de pago (efectivo / cheque / transferencia).
-- Seguro para re-ejecutar.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_planilla_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  periodo_id INT NOT NULL,
  id_empleado INT NOT NULL,
  codigo_empleado VARCHAR(40) NOT NULL,
  nombre_empleado VARCHAR(200) NOT NULL,
  dpi VARCHAR(20) NULL,
  tipo_contrato VARCHAR(40) NULL,
  forma_pago VARCHAR(40) NOT NULL DEFAULT 'transferencia',
  sueldo_base DECIMAL(12,2) NOT NULL DEFAULT 0,
  bono_incentivo DECIMAL(12,2) NOT NULL DEFAULT 0,
  bono_herramientas DECIMAL(12,2) NOT NULL DEFAULT 0,
  otros_ingresos DECIMAL(12,2) NOT NULL DEFAULT 0,
  igss_laboral DECIMAL(12,2) NOT NULL DEFAULT 0,
  igss_patronal DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuentos DECIMAL(12,2) NOT NULL DEFAULT 0,
  isr DECIMAL(12,2) NOT NULL DEFAULT 0,
  neto DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado_pago VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  ref_pago VARCHAR(120) NULL,
  notas TEXT NULL,
  UNIQUE KEY uq_plan_linea (periodo_id, id_empleado),
  INDEX idx_plan_lineas_periodo (empresa_id, periodo_id),
  INDEX idx_plan_lineas_pago (empresa_id, forma_pago, estado_pago)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
