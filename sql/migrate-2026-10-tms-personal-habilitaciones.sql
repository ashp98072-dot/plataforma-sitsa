-- HABILITACIONES OPERATIVAS: expansión aditiva. NO se ejecuta automáticamente.
-- Aplicar manualmente solo después del preflight y antes del despliegue.
-- No altera empleados, tms_personal, auxiliares, viáticos ni disponibilidad; sin backfill.
-- IF NOT EXISTS no verifica una tabla previa: ante diferencias, DETENER.
CREATE TABLE IF NOT EXISTS tms_personal_habilitaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  rol VARCHAR(20) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'HABILITADO',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tph_empleado_rol (empresa_id, empleado_id, rol),
  INDEX idx_tph_empresa_empleado (empresa_id, empleado_id),
  INDEX idx_tph_empresa_rol_activo (empresa_id, rol, activo),
  CONSTRAINT chk_tph_rol CHECK (rol IN ('PILOTO', 'AUXILIAR')),
  CONSTRAINT chk_tph_estado CHECK (estado IN ('HABILITADO', 'CAPACITACION')),
  CONSTRAINT fk_tph_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_tph_empleado FOREIGN KEY (empresa_id, empleado_id)
    REFERENCES empleados(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
