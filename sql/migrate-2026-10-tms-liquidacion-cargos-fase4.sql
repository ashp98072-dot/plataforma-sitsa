-- TMS LIQUIDACION DE VIAJES — FASE 4 (cargos adicionales facturables). Solo aplicar manualmente tras preflight aprobado y
-- comparacion de DDL. MariaDB 11.8.9. Sin seeds, sin backfill, sin datos, sin ALTER de tablas existentes, sin DROP.
-- IF NOT EXISTS es NOOP estructural: NO repara drift; preflight/verify son obligatorios.
-- Un cargo adicional NO es un gasto operativo, un viatico ni una solicitud de fondo: es un importe facturable al CLIENTE por un
-- servicio extra del viaje. NO define IVA (tratamiento fiscal PENDIENTE de definicion de negocio/fiscal), NO crea lineas de
-- factura/FEL y NO toca cierre, facturacion, fondos, gastos ni contabilidad.

-- (1) Cargo: estado VIGENTE (nunca se borra; se anula con motivo y puede reactivarse). Moneda = la de la tarifa del viaje.
CREATE TABLE IF NOT EXISTS tms_viaje_cargos_adicionales (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  concepto VARCHAR(120) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  observacion VARCHAR(500) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1,
  anulado_por INT NULL,
  anulado_en DATETIME NULL,
  motivo_anulacion VARCHAR(500) NULL,
  clave_envio VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tvca_empresa_id (empresa_id, id),
  UNIQUE KEY uq_tvca_clave (empresa_id, clave_envio),
  KEY idx_tvca_plan (empresa_id, plan_id, activo),
  CONSTRAINT fk_tvca_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_plan FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_actualizador FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvca_monto CHECK (monto > 0),
  CONSTRAINT ck_tvca_concepto CHECK (CHAR_LENGTH(TRIM(concepto)) >= 2),
  CONSTRAINT ck_tvca_version CHECK (version >= 1),
  CONSTRAINT ck_tvca_activo CHECK (activo IN (0, 1)),
  -- Anulado exige quién, cuándo y motivo; activo no conserva marcas de anulación (la historia vive en los eventos).
  CONSTRAINT ck_tvca_anulacion CHECK (
    (activo = 1 AND anulado_por IS NULL AND anulado_en IS NULL AND motivo_anulacion IS NULL)
    OR (activo = 0 AND anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL
        AND CHAR_LENGTH(TRIM(motivo_anulacion)) >= 5)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (2) Eventos APPEND-ONLY: una fila por cambio del cargo, con su estado antes/despues. `version` = version del cargo DESPUES del
-- cambio, de modo que UNIQUE (empresa_id, cargo_id, version) impide duplicar un evento. La aplicacion nunca hace UPDATE/DELETE;
-- ON DELETE RESTRICT impide borrar el cargo mientras tenga historia.
CREATE TABLE IF NOT EXISTS tms_viaje_cargo_eventos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cargo_id INT NOT NULL,
  plan_id INT NOT NULL,
  version INT NOT NULL,
  tipo VARCHAR(12) NOT NULL,
  actor_id INT NOT NULL,
  estado_antes LONGTEXT NULL,
  estado_despues LONGTEXT NOT NULL,
  motivo VARCHAR(500) NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tvce_version (empresa_id, cargo_id, version),
  KEY idx_tvce_plan (empresa_id, plan_id, id),
  KEY idx_tvce_actor (actor_id),
  CONSTRAINT fk_tvce_cargo FOREIGN KEY (empresa_id, cargo_id) REFERENCES tms_viaje_cargos_adicionales(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvce_actor FOREIGN KEY (actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvce_version CHECK (version >= 1),
  CONSTRAINT ck_tvce_tipo CHECK (tipo IN ('CREADO', 'EDITADO', 'ANULADO', 'REACTIVADO')),
  CONSTRAINT ck_tvce_json CHECK (JSON_VALID(estado_despues) AND (estado_antes IS NULL OR JSON_VALID(estado_antes))),
  CONSTRAINT ck_tvce_motivo CHECK (tipo <> 'ANULADO' OR (motivo IS NOT NULL AND CHAR_LENGTH(TRIM(motivo)) >= 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
