CREATE TABLE cxp_pagos (
  id INT NOT NULL AUTO_INCREMENT,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  fecha_pago DATE NOT NULL,
  monto_total DECIMAL(14,2) NOT NULL,
  medio_pago VARCHAR(40) NOT NULL DEFAULT '',
  referencia VARCHAR(120) NOT NULL DEFAULT '',
  observaciones VARCHAR(500) NULL,
  clave_idempotencia VARCHAR(64) NOT NULL,
  huella CHAR(64) NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'REGISTRADO',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversado_por INT NULL,
  reversado_en DATETIME NULL,
  motivo_reversion VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cxpp_ambito (empresa_id, entidad_id, id),
  UNIQUE KEY uq_cxpp_clave (empresa_id, entidad_id, clave_idempotencia),
  KEY idx_cxpp_listado (empresa_id, entidad_id, estado, fecha_pago),
  KEY idx_cxpp_proveedor (empresa_id, entidad_id, proveedor_id, fecha_pago),
  CONSTRAINT fk_cxpp_fiscal FOREIGN KEY (empresa_id, entidad_id, proveedor_id) REFERENCES cxp_proveedor_fiscal(empresa_id, entidad_id, proveedor_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cxpp_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cxpp_reversor FOREIGN KEY (reversado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cxpp_monto CHECK (monto_total > 0),
  CONSTRAINT ck_cxpp_estado CHECK (estado IN ('REGISTRADO','REVERSADO')),
  CONSTRAINT ck_cxpp_clave CHECK (CHAR_LENGTH(clave_idempotencia) >= 8),
  CONSTRAINT ck_cxpp_reversion CHECK (
    (estado = 'REGISTRADO' AND reversado_por IS NULL AND reversado_en IS NULL AND motivo_reversion IS NULL)
    OR (estado = 'REVERSADO' AND reversado_por IS NOT NULL AND reversado_en IS NOT NULL AND motivo_reversion IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_reversion)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE cxp_pago_aplicaciones (
  id INT NOT NULL AUTO_INCREMENT,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  pago_id INT NOT NULL,
  factura_id INT NOT NULL,
  monto DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cxpa_pago_factura (empresa_id, entidad_id, pago_id, factura_id),
  KEY idx_cxpa_factura (empresa_id, entidad_id, factura_id),
  CONSTRAINT fk_cxpa_pago FOREIGN KEY (empresa_id, entidad_id, pago_id) REFERENCES cxp_pagos(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cxpa_factura FOREIGN KEY (empresa_id, entidad_id, factura_id) REFERENCES cxp_facturas(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cxpa_monto CHECK (monto > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
