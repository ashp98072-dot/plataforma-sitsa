-- PR A: solo infraestructura. Ejecutar UNICAMENTE tras preflight APTO y autorización.
-- Sin seeds/backfill, sin automatización. Una tabla existente NO se considera compatible por IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS cont_cuentas_rol (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  cuenta_id INT NOT NULL,
  rol VARCHAR(40) NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_cuentas_rol (empresa_id, entidad_id, rol),
  KEY idx_cont_cuentas_rol_cuenta (empresa_id, entidad_id, cuenta_id),
  CONSTRAINT fk_cont_rol_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_rol_cuenta FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cont_rol_valido CHECK (rol IN ('CLIENTES','IVA_POR_PAGAR','RETENCION_IVA','VENTAS_SERVICIOS','VENTAS_BIENES')),
  CONSTRAINT ck_cont_rol_activa CHECK (activa IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cont_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  factura_id INT NOT NULL,
  tipo_evento VARCHAR(40) NOT NULL,
  evento_origen_id INT NULL,
  asiento_id INT NOT NULL,
  clave_evento VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fecha_contable DATE NOT NULL,
  datos_snapshot JSON NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_evento_clave (empresa_id, entidad_id, clave_evento),
  UNIQUE KEY uq_cont_evento_asiento (empresa_id, entidad_id, asiento_id),
  UNIQUE KEY uq_cont_evento_ambito (empresa_id, entidad_id, factura_id, id),
  KEY idx_cont_evento_factura (empresa_id, entidad_id, factura_id, tipo_evento),
  KEY idx_cont_evento_origen (empresa_id, entidad_id, factura_id, evento_origen_id),
  CONSTRAINT fk_cont_evento_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- No modifica fact_facturas: FK física simple + comprobación empresa/entidad bajo lock en el helper.
  CONSTRAINT fk_cont_evento_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_asiento FOREIGN KEY (empresa_id, entidad_id, asiento_id) REFERENCES cont_asientos(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_origen FOREIGN KEY (empresa_id, entidad_id, factura_id, evento_origen_id) REFERENCES cont_eventos(empresa_id, entidad_id, factura_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_actor FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cont_evento_tipo CHECK (tipo_evento IN ('FACTURA_EMITIDA','COBRO_CONFIRMADO','RETENCION_NO_EMITIDA')),
  -- COBRO reservado, imposible insertar hasta añadir confirmación + FK en PR B/D.
  CONSTRAINT ck_cont_evento_origen CHECK (
    (tipo_evento = 'FACTURA_EMITIDA' AND evento_origen_id IS NULL) OR
    (tipo_evento = 'RETENCION_NO_EMITIDA' AND evento_origen_id IS NOT NULL)),
  CONSTRAINT ck_cont_evento_huella CHECK (huella REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_cont_evento_snapshot CHECK (JSON_VALID(datos_snapshot) AND JSON_VALUE(datos_snapshot, '$.version') IS NOT NULL AND JSON_VALUE(datos_snapshot, '$.version') = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
