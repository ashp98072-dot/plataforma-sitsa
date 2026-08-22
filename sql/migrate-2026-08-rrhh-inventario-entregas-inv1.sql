-- RRHH INV-1 — Entregas de inventario a empleados (con o sin cobro)
--
-- Aditiva, no destructiva. No toca inventario_rrhh, inventario_rrhh_movimientos,
-- ni ninguna tabla de D1/D2 (rrhh_descuentos_maestro/rrhh_descuento_cuotas).
--
-- inventario_rrhh_entregas.descuento_id:
--   Apunta HACIA rrhh_descuentos_maestro (nunca al revés) — D1/D2 no
--   necesitan ningún cambio de schema para esta integración. NULL en
--   entregas sin cobro.
--
-- inventario_rrhh_entregas.costo_unitario_entrega:
--   Precio vigente AL MOMENTO de la entrega (histórico) — no se actualiza
--   si después cambia inventario_rrhh.costo_unitario.
--
-- inventario_rrhh_entregas.movimiento_id:
--   Traza el movimiento SALIDA (inventario_rrhh_movimientos) generado por
--   esta entrega.
--
-- No hay hard delete de entregas desde la aplicación — son registro
-- histórico/contable.

SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS inventario_rrhh_entregas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  articulo_id INT NOT NULL,
  empleado_id INT NOT NULL,
  cantidad INT NOT NULL,
  costo_unitario_entrega DECIMAL(12,2) NOT NULL,
  costo_total DECIMAL(12,2) NOT NULL,
  monto_cobrado DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_id INT NULL,
  movimiento_id INT NULL,
  motivo VARCHAR(300) NULL,
  entregado_por VARCHAR(100) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ENTREGADO',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entregas_articulo (empresa_id, articulo_id),
  INDEX idx_entregas_empleado (empresa_id, empleado_id),
  INDEX idx_entregas_descuento (descuento_id),
  CONSTRAINT fk_entregas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entregas_articulo FOREIGN KEY (articulo_id) REFERENCES inventario_rrhh(id) ON DELETE RESTRICT,
  CONSTRAINT fk_entregas_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT,
  CONSTRAINT fk_entregas_descuento FOREIGN KEY (descuento_id) REFERENCES rrhh_descuentos_maestro(id) ON DELETE SET NULL,
  CONSTRAINT fk_entregas_movimiento FOREIGN KEY (movimiento_id) REFERENCES inventario_rrhh_movimientos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
