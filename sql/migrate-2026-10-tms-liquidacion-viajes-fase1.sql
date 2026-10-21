-- TMS LIQUIDACION DE VIAJES — FASE 1 (modelo persistente minimo). Solo aplicar manualmente tras preflight aprobado y
-- comparacion de DDL. MariaDB 11.8.9. Sin seeds, sin backfill, sin datos, sin ALTER de tablas existentes, sin DROP.
-- IF NOT EXISTS es NOOP estructural: NO repara drift; preflight/verify son obligatorios.
-- Ausencia de fila en tms_viaje_liquidaciones = «sin liquidacion registrada» (incluye todo el historico).
-- NO modifica el cierre, facturacion, fondos, cuadrilla, FEL ni contabilidad.

-- (1) Configuracion por empresa. Sin fila, o fecha NULL = la liquidacion NO se exige (el sistema actual no cambia).
CREATE TABLE IF NOT EXISTS tms_liquidacion_config (
  empresa_id INT NOT NULL,
  fecha_activacion_liquidacion DATE NULL DEFAULT NULL,
  actualizado_por INT NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id),
  CONSTRAINT fk_tlc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tlc_actor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (2) Liquidacion 1:1 por viaje (estado VIGENTE). La historia vive en tms_viaje_liquidacion_eventos.
CREATE TABLE IF NOT EXISTS tms_viaje_liquidaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  estado VARCHAR(20) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  reporte_recibido_en DATETIME NOT NULL,
  reporte_recibido_por INT NOT NULL,
  liquidado_en DATETIME NULL,
  liquidado_por INT NULL,
  reabierto_en DATETIME NULL,
  reabierto_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tvl_empresa_plan (empresa_id, plan_id),
  KEY idx_tvl_empresa_estado (empresa_id, estado),
  CONSTRAINT fk_tvl_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_plan FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_reporte_por FOREIGN KEY (reporte_recibido_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_liquidado_por FOREIGN KEY (liquidado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_reabierto_por FOREIGN KEY (reabierto_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvl_estado CHECK (estado IN ('REPORTE_RECIBIDO', 'LIQUIDADO', 'EN_AJUSTE')),
  CONSTRAINT ck_tvl_version CHECK (version >= 1),
  CONSTRAINT ck_tvl_pares CHECK (
    (liquidado_en IS NULL) = (liquidado_por IS NULL) AND (reabierto_en IS NULL) = (reabierto_por IS NULL)
  ),
  -- Coherencia estado <-> marcas: REPORTE_RECIBIDO solo existe antes de la primera liquidacion; LIQUIDADO y EN_AJUSTE
  -- conservan la ultima liquidacion; EN_AJUSTE exige la ultima reapertura.
  CONSTRAINT ck_tvl_estado_marcas CHECK (
    (estado = 'REPORTE_RECIBIDO' AND liquidado_en IS NULL AND reabierto_en IS NULL)
    OR (estado = 'LIQUIDADO' AND liquidado_en IS NOT NULL)
    OR (estado = 'EN_AJUSTE' AND liquidado_en IS NOT NULL AND reabierto_en IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (3) Eventos APPEND-ONLY. Una fila por transicion; `version` = version de la liquidacion DESPUES de la transicion, de modo que
-- UNIQUE (empresa_id, plan_id, version) impide duplicar un evento. Nunca se actualiza ni se borra (la aplicacion no emite UPDATE/DELETE;
-- ON DELETE RESTRICT impide borrar la liquidacion mientras tenga eventos).
CREATE TABLE IF NOT EXISTS tms_viaje_liquidacion_eventos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  version INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  estado_antes VARCHAR(20) NULL,
  estado_despues VARCHAR(20) NOT NULL,
  actor_id INT NOT NULL,
  detalle VARCHAR(500) NULL,
  snapshot_json LONGTEXT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tvle_version (empresa_id, plan_id, version),
  KEY idx_tvle_actor (actor_id),
  CONSTRAINT fk_tvle_liquidacion FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_viaje_liquidaciones(empresa_id, plan_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvle_actor FOREIGN KEY (actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvle_version CHECK (version >= 1),
  CONSTRAINT ck_tvle_snapshot CHECK (snapshot_json IS NULL OR JSON_VALID(snapshot_json)),
  CONSTRAINT ck_tvle_transicion CHECK (
    (tipo = 'REPORTE_RECIBIDO' AND estado_antes IS NULL AND estado_despues = 'REPORTE_RECIBIDO')
    OR (tipo = 'LIQUIDADO' AND estado_antes = 'REPORTE_RECIBIDO' AND estado_despues = 'LIQUIDADO')
    OR (tipo = 'REABIERTO' AND estado_antes = 'LIQUIDADO' AND estado_despues = 'EN_AJUSTE'
        AND detalle IS NOT NULL AND CHAR_LENGTH(TRIM(detalle)) >= 5)
    OR (tipo = 'RELIQUIDADO' AND estado_antes = 'EN_AJUSTE' AND estado_despues = 'LIQUIDADO')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
