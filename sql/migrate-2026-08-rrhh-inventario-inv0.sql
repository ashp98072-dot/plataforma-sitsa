-- RRHH INV-0 — Costo unitario + movimientos de inventario (entrada/ajuste)
--
-- Aditivo, no destructivo. No borra ni reinterpreta ningún dato existente
-- de inventario_rrhh. No toca flota_inv_equipo (módulo independiente, sin
-- cambios en esta fase por decisión de negocio).
--
-- inventario_rrhh.costo_unitario:
--   Costo de referencia por unidad del artículo. NULL permitido — artículos
--   ya existentes quedan sin costo hasta que RRHH lo complete.
--
-- inventario_rrhh_movimientos:
--   Historial de movimientos de stock, append-only (nunca se edita ni se
--   borra una fila desde la aplicación). Cada movimiento guarda `cantidad`
--   como delta CON SIGNO (positivo = entrada/incremento, negativo =
--   ajuste a la baja) y `stock_resultante` como fotografía del stock justo
--   después de aplicarse — para poder reconstruir el historial sin
--   recalcular. Fase INV-0 solo genera tipo = 'ENTRADA' | 'AJUSTE'; otros
--   tipos (SALIDA por entrega, DEVOLUCION, PERDIDA) se agregarán en fases
--   futuras sin necesitar otra migración (columna VARCHAR sin lista
--   cerrada en BD).

SET NAMES utf8mb4;
SET @db := DATABASE();

-- =========================================================
-- inventario_rrhh.costo_unitario
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'inventario_rrhh' AND COLUMN_NAME = 'costo_unitario'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE inventario_rrhh ADD COLUMN costo_unitario DECIMAL(12,2) NULL AFTER unidad',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- inventario_rrhh_movimientos (tabla nueva)
-- =========================================================
CREATE TABLE IF NOT EXISTS inventario_rrhh_movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  articulo_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  cantidad INT NOT NULL,
  stock_resultante INT NOT NULL,
  motivo VARCHAR(300) NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invmov_articulo (empresa_id, articulo_id),
  INDEX idx_invmov_empresa (empresa_id, creado_en),
  CONSTRAINT fk_invmov_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_invmov_articulo FOREIGN KEY (articulo_id) REFERENCES inventario_rrhh(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
