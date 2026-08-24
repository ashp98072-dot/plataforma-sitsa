-- VIAT-1: ubicaciones/paradas guardadas por cliente, para acelerar la
-- captura de paradas en Programación. Aditivo e idempotente.
--
-- MIGRACIÓN REAL: debe ejecutarse manualmente antes de desplegar este
-- cambio (mismo criterio que sql/migrate-2026-08-viat-0-viaticos.sql — sin
-- DDL automático en runtime; el código de aplicación asume que ya está
-- aplicada y falla con el error real de MySQL si no lo está). NO se
-- ejecutó en este entorno.
--
-- No duplica el maestro de clientes: cliente_id referencia tms_clientes
-- (la misma tabla que ya usa tms_planes_viaje.cliente_id), que a su vez es
-- el espejo del maestro compartido `clientes` (vía tms_cliente_id).

CREATE TABLE IF NOT EXISTS tms_cliente_ubicaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL, -- alias, ej. "Bodega Central", "Planta Escuintla"
  direccion VARCHAR(300) NULL,
  -- No existían en el modelo (clientes/tms_clientes solo tienen
  -- `direccion` como texto libre) — se agregan como campos opcionales,
  -- sin implementar un sistema geográfico.
  municipio VARCHAR(120) NULL,
  departamento VARCHAR(120) NULL,
  referencia VARCHAR(300) NULL,
  -- CARGA | ENTREGA | AMBOS
  tipo VARCHAR(20) NOT NULL DEFAULT 'AMBOS',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmscliub_cliente (empresa_id, cliente_id, activo),
  CONSTRAINT fk_tmscliub_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmscliub_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vínculo opcional desde la parada REALMENTE usada en un viaje hacia la
-- ubicación guardada que la originó. Deliberadamente SIN FK: es solo una
-- referencia informativa ("de cuál ubicación guardada vino esta parada");
-- lugar_nombre en tms_plan_paradas ya es y sigue siendo el texto/dirección
-- HISTÓRICO real de ese viaje — si la ubicación del cliente cambia o se
-- desactiva después, el viaje ya registrado no pierde ni reinterpreta la
-- dirección que efectivamente usó.
ALTER TABLE tms_plan_paradas
  ADD COLUMN IF NOT EXISTS cliente_ubicacion_id INT NULL AFTER lugar_id;
