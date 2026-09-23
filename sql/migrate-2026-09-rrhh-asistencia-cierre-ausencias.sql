-- RRHH-TOMAR-ASISTENCIA-2 — cierre diario de asistencia y ausencias confirmadas.
--
-- ADITIVA y no destructiva: solo CREATE TABLE IF NOT EXISTS (segura de repetir).
-- No altera ni reinterpreta sesiones_trabajo, incidencias ni ninguna tabla de planilla.
-- NO ejecutada por este PR. Correr antes: preflight-2026-09-rrhh-asistencia-cierre-ausencias.sql.
--
-- Divisor de la falta: NO requiere DDL. Se guarda (opcional) en la tabla existente
-- `configuracion` con parametro = 'divisor_falta' (entero 15–31); sin fila la app usa 30
-- (constante única DIVISOR_FALTA_DEFAULT en src/lib/rrhh/config.ts).
--
-- Política de FKs: empresa y empleado CASCADE (igual que sesiones_trabajo/incidencias);
-- planilla_periodo_id RESTRICT (a diferencia de rrhh_descuento_cuotas, que usa SET NULL):
-- una falta ya descontada nunca debe "liberarse" en silencio al borrar un período.

SET NAMES utf8mb4;

-- Un registro por empresa+fecha: distingue "día pendiente" de "día cerrado por RRHH".
CREATE TABLE IF NOT EXISTS rrhh_asistencia_cierres (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  fecha DATE NOT NULL,
  cerrado_por VARCHAR(100) NOT NULL,
  cerrado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por VARCHAR(100) NULL,
  actualizado_en DATETIME NULL,
  presentes INT NOT NULL DEFAULT 0,
  ausentes INT NOT NULL DEFAULT 0,
  justificados INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_asist_cierre (empresa_id, fecha),
  CONSTRAINT fk_asist_cierre_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ausencia confirmada por RRHH (CONFIRMADA / ANULADA; nunca se borra).
CREATE TABLE IF NOT EXISTS rrhh_asistencia_ausencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  fecha DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA',
  confirmado_por VARCHAR(100) NOT NULL,
  confirmado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulado_por VARCHAR(100) NULL,
  anulado_en DATETIME NULL,
  motivo_anulacion VARCHAR(300) NULL,
  planilla_periodo_id INT NULL,
  monto_aplicado DECIMAL(12,2) NULL,
  aplicado_en DATETIME NULL,
  aplicado_por VARCHAR(100) NULL,
  UNIQUE KEY uq_asist_ausencia (empresa_id, empleado_id, fecha),
  INDEX idx_asist_aus_fecha (empresa_id, fecha),
  INDEX idx_asist_aus_planilla (empresa_id, estado, planilla_periodo_id, fecha),
  INDEX idx_asist_aus_periodo (planilla_periodo_id),
  CONSTRAINT fk_asist_aus_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_asist_aus_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_asist_aus_periodo FOREIGN KEY (planilla_periodo_id) REFERENCES rrhh_planilla_periodos(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
