-- FACT-1-IMPLEMENTACIÓN-1 — PROPUESTA DE MIGRACIÓN, NO EJECUTAR AQUÍ.
--
-- Este archivo NO se ha ejecutado contra ninguna base de datos (ni local
-- ni de producción). El usuario debe revisarlo y ejecutarlo manualmente
-- (fuera de esta sesión) cuando lo apruebe.
--
-- Crea el modelo base de FACT-1 (diseño aprobado en FACT-1-DISEÑO, con
-- los 3 ajustes de FACT-1-IMPLEMENTACIÓN-1):
--   A) el estado del viaje se deriva por estado_admin de la factura
--      vinculada (Borrador -> "en borrador de factura", Emitida ->
--      "Facturado", Anulada no cuenta como facturación activa) — no hay
--      columna nueva para esto, se deriva en las consultas de
--      src/lib/facturacion/facturas.ts.
--   B) numero_factura y fecha_emision son NULL mientras la factura es
--      Borrador — se exigen recién al emitir (aplicación, no DB).
--   C) los pagos pertenecen a la factura completa, nunca prorrateados
--      por viaje — fact_pagos no tiene columna plan_id.
--
-- Aditivo: no toca tms_planes_viaje, cont_cxc/cont_cxp, ni las tablas de
-- fact_empresa_perfil/fact_cliente_perfil (cuestionario) ya existentes.

CREATE TABLE IF NOT EXISTS fact_facturas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  -- (B) NULL mientras Borrador; UNIQUE con empresa_id abajo. InnoDB/MySQL
  -- trata cada NULL como distinto en un índice UNIQUE, así que varios
  -- Borradores sin número asignado nunca chocan entre sí.
  numero_factura VARCHAR(60) NULL,
  -- (B) NULL mientras Borrador — se exige al emitir (aplicación).
  fecha_emision DATE NULL,
  monto_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  estado_admin ENUM('Borrador','Emitida','Anulada') NOT NULL DEFAULT 'Borrador',
  observaciones TEXT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_en DATETIME NULL,
  UNIQUE KEY uq_factura_numero (empresa_id, numero_factura),
  KEY idx_factura_cliente (empresa_id, cliente_id),
  KEY idx_factura_estado (empresa_id, estado_admin),
  CONSTRAINT fk_factura_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_factura_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fact_factura_viajes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  factura_id INT NOT NULL,
  plan_id INT NOT NULL,
  monto_asignado DECIMAL(14,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Un viaje, a lo sumo, en UNA fila viva. Anular una factura BORRA sus
  -- filas aquí (nunca las marca inactivas) — así el viaje queda libre de
  -- inmediato para una factura nueva, y este UNIQUE es una garantía real
  -- de base de datos, no solo de aplicación (mismo criterio ya usado en
  -- flota_viajes.plan_id / vincular-viaje-plan.ts).
  UNIQUE KEY uq_factviaje_plan (plan_id),
  KEY idx_factviaje_factura (factura_id),
  CONSTRAINT fk_factviaje_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE CASCADE,
  CONSTRAINT fk_factviaje_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fact_pagos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  factura_id INT NOT NULL,
  fecha_pago DATE NOT NULL,
  monto DECIMAL(14,2) NOT NULL,
  referencia VARCHAR(120) NULL,
  medio_pago VARCHAR(40) NULL,
  observaciones TEXT NULL,
  registrado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pagos_factura (factura_id),
  KEY idx_pagos_empresa (empresa_id),
  CONSTRAINT fk_pagos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_pagos_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
