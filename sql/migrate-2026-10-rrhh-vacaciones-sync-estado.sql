-- MariaDB 11.8.9. Aplicar solo después del preflight aprobado.
-- Índice de frescura VACÍO. No toca empleados, saldos, incidencias ni FIFO.
-- IF NOT EXISTS no valida estructuras previas: si existe, comparar SHOW CREATE TABLE.
CREATE TABLE IF NOT EXISTS rrhh_vacaciones_sync_estado (
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ultima_sync_fecha DATE NULL,
  dirty TINYINT(1) NOT NULL DEFAULT 1,
  generacion BIGINT UNSIGNED NOT NULL DEFAULT 0,
  politica_fingerprint VARCHAR(100) NULL,
  fecha_alta_sync DATE NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, id_empleado),
  CONSTRAINT chk_vsync_dirty CHECK (dirty IN (0, 1)),
  CONSTRAINT fk_vsync_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_vsync_empleado FOREIGN KEY (empresa_id, id_empleado) REFERENCES empleados(empresa_id, id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
