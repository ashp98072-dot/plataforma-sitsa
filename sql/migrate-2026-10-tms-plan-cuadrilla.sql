-- CUADRILLA: expansión aditiva. NO se ejecuta automáticamente.
-- Aplicar manualmente solo después del preflight y antes del despliegue.
-- No altera auxiliares, personal, empleados ni viáticos; sin backfill.
-- IF NOT EXISTS no verifica una tabla previa: ante diferencias, DETENER.
CREATE TABLE IF NOT EXISTS tms_plan_cuadrilla (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  orden SMALLINT NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  id_empleado INT NULL,
  nombre VARCHAR(200) NOT NULL,
  identificacion VARCHAR(100) NULL,
  telefono VARCHAR(50) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tpc_plan_empleado (plan_id, id_empleado),
  UNIQUE KEY uq_tpc_plan_orden (plan_id, orden),
  INDEX idx_tpc_empresa_plan (empresa_id, plan_id),
  INDEX idx_tpc_empresa_empleado (empresa_id, id_empleado),
  CONSTRAINT chk_tpc_tipo CHECK (
    (tipo = 'INTERNO' AND id_empleado IS NOT NULL AND identificacion IS NULL AND telefono IS NULL)
    OR (tipo = 'EXTERNO' AND id_empleado IS NULL)
  ),
  CONSTRAINT fk_tpc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_tpc_plan FOREIGN KEY (empresa_id, plan_id)
    REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_tpc_empleado FOREIGN KEY (empresa_id, id_empleado)
    REFERENCES empleados(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
