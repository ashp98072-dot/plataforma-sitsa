-- PR B. Solo aplicar manualmente tras preflight aprobado y comparación de DDL.
-- MariaDB 11.8.9. Sin seeds/backfill, sin ALTER de padres, sin asientos.
-- IF NOT EXISTS es NOOP estructural: NO repara drift; preflight/verify son obligatorios.
CREATE TABLE IF NOT EXISTS fact_pago_confirmaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  pago_id INT NULL,
  factura_id INT NOT NULL,
  cuenta_bancaria_id INT NOT NULL,
  monto DECIMAL(14,2) NOT NULL,
  fecha_acreditacion DATE NOT NULL,
  referencia VARCHAR(120) NOT NULL,
  observaciones TEXT NULL,
  idempotency_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'CONFIRMADA',
  confirmado_por INT NOT NULL,
  confirmado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulado_por INT NULL,
  anulado_en DATETIME NULL,
  motivo_anulacion TEXT NULL,
  evidencia_ruta VARCHAR(500) NULL,
  evidencia_nombre VARCHAR(255) NULL,
  evidencia_mime VARCHAR(40) NULL,
  evidencia_tamano INT NULL,
  evidencia_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  UNIQUE KEY uq_fpc_idempotencia (empresa_id,entidad_id,idempotency_key),
  KEY idx_fpc_factura_estado (empresa_id,entidad_id,factura_id,estado),
  KEY idx_fpc_banco_fecha (empresa_id,entidad_id,cuenta_bancaria_id,fecha_acreditacion),
  KEY idx_fpc_pago (pago_id),
  CONSTRAINT fk_fpc_entidad FOREIGN KEY (empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_banco FOREIGN KEY (empresa_id,entidad_id,cuenta_bancaria_id) REFERENCES cont_cuentas_bancarias(empresa_id,entidad_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_pago FOREIGN KEY (pago_id) REFERENCES fact_pagos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_actor FOREIGN KEY (confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fpc_monto CHECK (monto > 0),
  CONSTRAINT ck_fpc_referencia CHECK (CHAR_LENGTH(TRIM(referencia)) > 0),
  CONSTRAINT ck_fpc_estado CHECK (
    (estado='CONFIRMADA' AND anulado_por IS NULL AND anulado_en IS NULL AND motivo_anulacion IS NULL)
    OR (estado='ANULADA' AND anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_anulacion))>0)
  ),
  CONSTRAINT ck_fpc_evidencia CHECK (
    (evidencia_ruta IS NULL AND evidencia_nombre IS NULL AND evidencia_mime IS NULL AND evidencia_tamano IS NULL AND evidencia_sha256 IS NULL)
    OR (evidencia_ruta IS NOT NULL AND evidencia_nombre IS NOT NULL AND evidencia_mime IS NOT NULL AND evidencia_mime IN ('application/pdf','image/png','image/jpeg') AND evidencia_tamano IS NOT NULL AND evidencia_tamano BETWEEN 1 AND 10485760 AND evidencia_sha256 IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
