-- RRHH D1 — Motor de descuentos y cuotas
--
-- Aditivo, no destructivo. Tablas completamente nuevas — no toca ni
-- reinterpreta rrhh_descuentos (queda como histórico/legado, sin cambios).
-- IGSS/ISR no se tocan (contratos-pago.ts / isr.ts siguen igual). D1 NO
-- conecta con generarLineasPeriodo — planilla_periodo_id existe en
-- rrhh_descuento_cuotas pero nadie la escribe todavía (eso es D2).
--
-- CREATE TABLE IF NOT EXISTS es seguro de ejecutar más de una vez.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_descuentos_maestro (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  clasificacion VARCHAR(20) NOT NULL,
  motivo TEXT NULL,
  monto_original DECIMAL(12,2) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  periodicidad VARCHAR(20) NOT NULL,
  numero_cuotas INT NOT NULL DEFAULT 1,
  monto_cuota DECIMAL(12,2) NOT NULL,
  cada_n_quincenas INT NULL,
  tipo_quincena_inicio VARCHAR(20) NULL,
  quincena_inicio TINYINT NULL,
  fecha_inicio DATE NOT NULL,
  documento_id INT NULL,
  autorizado_por VARCHAR(100) NULL,
  autorizado_en DATETIME NULL,
  motivo_pausa VARCHAR(300) NULL,
  motivo_cancelacion VARCHAR(300) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_descm_codigo (empresa_id, codigo),
  INDEX idx_descm_emp (empresa_id, empleado_id),
  INDEX idx_descm_estado (empresa_id, estado),
  CONSTRAINT fk_descm_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_descm_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_descm_documento FOREIGN KEY (documento_id) REFERENCES documentos_empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_descuento_cuotas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  descuento_id INT NOT NULL,
  numero_cuota INT NOT NULL,
  fecha_programada DATE NOT NULL,
  monto_programado DECIMAL(12,2) NOT NULL,
  monto_aplicado DECIMAL(12,2) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  planilla_periodo_id INT NULL,
  aplicado_en DATETIME NULL,
  aplicado_por VARCHAR(100) NULL,
  motivo_ajuste VARCHAR(300) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cuota_numero (descuento_id, numero_cuota),
  INDEX idx_cuota_desc (descuento_id),
  INDEX idx_cuota_estado (empresa_id, estado),
  INDEX idx_cuota_fecha (empresa_id, fecha_programada),
  CONSTRAINT fk_cuota_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cuota_descuento FOREIGN KEY (descuento_id) REFERENCES rrhh_descuentos_maestro(id) ON DELETE CASCADE,
  CONSTRAINT fk_cuota_periodo FOREIGN KEY (planilla_periodo_id) REFERENCES rrhh_planilla_periodos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_descuento_abonos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  descuento_id INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  fecha DATE NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_abono_desc (descuento_id),
  CONSTRAINT fk_abono_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_abono_descuento FOREIGN KEY (descuento_id) REFERENCES rrhh_descuentos_maestro(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
