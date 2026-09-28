-- MIGRACIÓN — RRHH-INVENTARIO-CAMBIOS-1 (devolución y cambio de artículo)
-- Idempotente (CREATE TABLE IF NOT EXISTS), MariaDB-compatible, sin
-- DELETE/UPDATE, sin backfill destructivo. NO se ejecuta automáticamente —
-- aplicar manualmente (phpMyAdmin / consola MySQL) cuando corresponda.
--
-- Única tabla nueva. No hay ALTER TABLE — ver
-- sql/discovery-2026-09-rrhh-inventario-cambios.sql para el porqué
-- (inventario_rrhh_movimientos.tipo e inventario_rrhh_entregas.estado ya
-- son VARCHAR sin lista cerrada).

CREATE TABLE IF NOT EXISTS inventario_rrhh_ajustes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  -- Entrega ORIGINAL sobre la que se registra la devolución/cambio. Nunca
  -- se modifica esa fila (append-only) — este registro es la trazabilidad.
  entrega_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL, -- DEVOLUCION | CAMBIO
  cantidad INT NOT NULL, -- siempre positivo: unidades devueltas/cambiadas
  -- Solo para tipo = CAMBIO:
  articulo_nuevo_id INT NULL,
  entrega_nueva_id INT NULL, -- fila NUEVA en inventario_rrhh_entregas para el artículo nuevo
  movimiento_salida_id INT NULL, -- movimiento CAMBIO_SALIDA del artículo nuevo
  -- Siempre presente (DEVOLUCION y CAMBIO ambos regresan stock del artículo original):
  movimiento_devolucion_id INT NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ajustes_entrega (empresa_id, entrega_id),
  -- Corrección post-revisión: resolverOrigenFinancieroTx() (inventario.ts)
  -- camina la cadena de cambios hacia atrás por entrega_nueva_id (¿esta
  -- entrega vino de un cambio?) — este índice garantiza UN solo padre por
  -- entrega derivada; las devoluciones conservan NULL y no colisionan.
  UNIQUE KEY uq_ajustes_entrega_nueva (empresa_id, entrega_nueva_id),
  INDEX idx_ajustes_empresa (empresa_id, creado_en),
  CONSTRAINT fk_ajustes_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ajustes_entrega FOREIGN KEY (entrega_id) REFERENCES inventario_rrhh_entregas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ajustes_articulo_nuevo FOREIGN KEY (articulo_nuevo_id) REFERENCES inventario_rrhh(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ajustes_entrega_nueva FOREIGN KEY (entrega_nueva_id) REFERENCES inventario_rrhh_entregas(id) ON DELETE SET NULL,
  CONSTRAINT fk_ajustes_mov_devolucion FOREIGN KEY (movimiento_devolucion_id) REFERENCES inventario_rrhh_movimientos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ajustes_mov_salida FOREIGN KEY (movimiento_salida_id) REFERENCES inventario_rrhh_movimientos(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
