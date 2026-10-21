-- CxC-1 — Cobro multi-factura + anulación de cobro. PROPUESTA: NO ejecutada por el PR.
-- Solo aplicar manualmente tras sql/preflight-2026-10-cxc-cobros-multifactura.sql (resultado APLICAR) y revisión de DDL.
-- MariaDB 11.8.9 / InnoDB. ADITIVA: tablas nuevas + una columna NULL nueva en fact_pago_confirmaciones.
-- Sin DROP, sin UPDATE/DELETE/INSERT de datos, sin backfill, sin tocar fact_pagos ni fact_facturas, sin asientos.
--
-- Modelo (decisión aprobada): CABECERA de cobro + APLICACIONES a facturas. fact_pagos NO se extiende ni se migra:
--   * Los pagos históricos (fact_pagos) siguen valiendo como están (un pago = una factura).
--   * Saldo de una factura = monto_total − Σ fact_pagos − Σ aplicaciones de cobros VIGENTES (un cobro ANULADO deja de contar).
--   * Cada dinero entra por UN solo camino (o fact_pagos legado, o fact_cobros nuevo): nada se duplica ni se copia.
-- Un cobro anulado NO se borra: conserva cabecera y aplicaciones (auditoría); solo cambia su estado.

CREATE TABLE IF NOT EXISTS fact_cobros (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  cliente_id INT NOT NULL,
  moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  fecha_cobro DATE NOT NULL,
  monto_total DECIMAL(14,2) NOT NULL,                 -- = Σ aplicaciones (lo calcula y valida el servidor)
  medio_pago VARCHAR(40) NULL,
  referencia VARCHAR(120) NULL,
  observaciones TEXT NULL,
  clave_idempotencia VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'VIGENTE',      -- VIGENTE | ANULADO
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulado_por INT NULL,
  anulado_en DATETIME NULL,
  motivo_anulacion TEXT NULL,
  UNIQUE KEY uq_fcobro_idempotencia (empresa_id, entidad_id, clave_idempotencia),
  UNIQUE KEY uq_fcobro_ambito (empresa_id, entidad_id, id),
  KEY idx_fcobro_cliente (empresa_id, entidad_id, cliente_id, fecha_cobro),
  KEY idx_fcobro_estado (empresa_id, entidad_id, estado),
  CONSTRAINT fk_fcobro_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fcobro_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fcobro_actor FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fcobro_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fcobro_monto CHECK (monto_total > 0),
  CONSTRAINT ck_fcobro_estado CHECK (
    (estado = 'VIGENTE' AND anulado_por IS NULL AND anulado_en IS NULL AND motivo_anulacion IS NULL)
    OR (estado = 'ANULADO' AND anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_anulacion)) > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS fact_cobro_aplicaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  cobro_id INT NOT NULL,
  factura_id INT NOT NULL,
  monto DECIMAL(14,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fcapl_cobro_factura (cobro_id, factura_id),   -- una aplicación por factura dentro de un cobro
  KEY idx_fcapl_factura (factura_id),
  KEY idx_fcapl_ambito (empresa_id, entidad_id, cobro_id),
  CONSTRAINT fk_fcapl_cobro FOREIGN KEY (empresa_id, entidad_id, cobro_id) REFERENCES fact_cobros(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fcapl_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fcapl_monto CHECK (monto > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
-- Misma empresa / entidad / cliente entre cobro y factura: lo exige el servicio dentro de la transacción (fact_facturas no tiene
-- una clave única compuesta que permita una FK así sin alterar la tabla padre); sql/postcheck-…sql verifica que no haya excepciones.

-- Vínculo opcional de una confirmación bancaria con un cobro (para bloquear la anulación del cobro mientras la confirmación esté activa).
ALTER TABLE fact_pago_confirmaciones
  ADD COLUMN IF NOT EXISTS cobro_id INT NULL AFTER pago_id,
  ADD KEY IF NOT EXISTS idx_fpc_cobro (cobro_id);
-- La FK se crea solo si no existe (patrón information_schema + PREPARE; sin la cláusula IF NOT EXISTS en la FK).
SET @fk_fpc_cobro := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'fact_pago_confirmaciones' AND CONSTRAINT_NAME = 'fk_fpc_cobro' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql := IF(@fk_fpc_cobro = 0, 'ALTER TABLE fact_pago_confirmaciones ADD CONSTRAINT fk_fpc_cobro FOREIGN KEY (cobro_id) REFERENCES fact_cobros(id) ON DELETE RESTRICT ON UPDATE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
