-- Migración histórica canónica del modelo fiscal RRHH.
-- Objetivo: MariaDB 11.8.9, InnoDB, utf8mb4. NO ejecutada por esta rama/PR.
-- Producción recibió ambas tablas manualmente antes de registrar esta migración.
-- CREATE TABLE IF NOT EXISTS es NO-OP para las tablas existentes en producción.
-- Este archivo reproduce el contrato de schema.sql en otras instalaciones/restauraciones.
-- No valida ni modifica esquemas preexistentes: revisar primero el preflight de solo lectura.
-- JSON es alias de LONGTEXT en MariaDB; no se convierten columnas existentes.
-- FKs diferidas a una migración futura separada y autorizada, previa validación de tipos/engine/datos.

CREATE TABLE IF NOT EXISTS rrhh_fiscal_empleado_ejercicio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ejercicio SMALLINT NOT NULL,
  revision INT NOT NULL,
  inicio_fiscal DATE NULL,
  corte_antecedentes DATE NULL,
  ingresos_gravados_previos DECIMAL(14,2) NULL,
  ingresos_exentos_previos DECIMAL(14,2) NULL,
  igss_laboral_previo DECIMAL(14,2) NULL,
  isr_retenido_previo DECIMAL(14,2) NULL,
  datos JSON NOT NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por VARCHAR(100) NULL,
  confirmado_en DATETIME NULL,
  UNIQUE KEY uq_fiscal_emp_anio_rev (empresa_id, id_empleado, ejercicio, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_fiscal_liquidaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ejercicio SMALLINT NOT NULL,
  evento_clave VARCHAR(80) NOT NULL,
  revision INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  fecha_corte DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  retener DECIMAL(14,2) NOT NULL DEFAULT 0,
  devolver DECIMAL(14,2) NOT NULL DEFAULT 0,
  snapshot JSON NOT NULL,
  aplicacion_clave VARCHAR(100) NULL,
  fecha_fiscal_ejecucion DATE NULL,
  referencia_ejecucion VARCHAR(120) NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por VARCHAR(100) NULL,
  confirmado_en DATETIME NULL,
  ejecutado_por VARCHAR(100) NULL,
  ejecutado_en DATETIME NULL,
  UNIQUE KEY uq_liquidacion_rev (empresa_id, id_empleado, ejercicio, evento_clave, revision),
  UNIQUE KEY uq_liquidacion_aplicacion (empresa_id, aplicacion_clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
