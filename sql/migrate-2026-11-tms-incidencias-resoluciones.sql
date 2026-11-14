-- ============================================================================
-- TMS-INCIDENCIAS-ENTREGA-1 — resolución administrativa de incidencias de entrega (PROPUESTA PARA REVISIÓN INDEPENDIENTE).
-- NO SE HA EJECUTADO en ningún entorno (ni siquiera en una base desechable). No se crea en runtime. Requiere autorización expresa para aplicarse.
-- Diseño y justificación: docs/TMS-INCIDENCIAS-ENTREGA-POLITICA.md. SOLO SE APRUEBA JUNTO CON ESA POLÍTICA.
--
-- Requisitos previos: tms_parada_confirmaciones (sql/migrate-2026-11-tms-parada-confirmaciones.sql, ya aplicada), tms_planes_viaje, usuarios.
--
-- Principios (todo es APPEND-ONLY; la aplicación solo emite SELECT e INSERT sobre estas tablas):
--  * La confirmación original del piloto NO se toca: ninguna sentencia de este archivo modifica filas de tms_parada_confirmaciones.
--    La única alteración de esa tabla es un ÍNDICE ÚNICO adicional (parte 1) que permite claves foráneas compuestas (misma empresa/plan/parada).
--  * Una resolución es una FILA NUEVA con justificación obligatoria, usuario, fecha y referencia a la incidencia original.
--  * «Autorizar nuevo intento» NO convierte nada en entregado: solo habilita UNA nueva confirmación del piloto (tabla de reintentos, parte 3).
--  * Ninguna columna de estas tablas representa «recepción oficial de PriceSmart» ni un estado externo.
--  * CHECK escritos con «<=>» donde interviene NULL (lección del laboratorio B12: «= 1» con NULL da UNKNOWN y el CHECK lo acepta).
-- ============================================================================

-- ---- Parte 1: índice único (metadatos) en la tabla ya existente, necesario para las claves foráneas compuestas de las partes 2 y 3 ----
ALTER TABLE tms_parada_confirmaciones
  ADD UNIQUE KEY IF NOT EXISTS uq_tmspc_ref (id, empresa_id, plan_id, parada_id);

-- ---- Parte 2: resoluciones administrativas (una fila por decisión; nunca se actualiza ni se borra) ----
CREATE TABLE IF NOT EXISTS tms_parada_incidencia_resoluciones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  parada_id INT NOT NULL,
  confirmacion_id BIGINT UNSIGNED NOT NULL,
  secuencia INT UNSIGNED NOT NULL,
  decision VARCHAR(24) NOT NULL,
  terminal TINYINT NULL,
  evidencia_corte_id INT NULL,
  justificacion VARCHAR(500) NOT NULL,
  resuelto_por INT NOT NULL,
  resuelto_por_usuario VARCHAR(80) NOT NULL,
  resuelto_en DATETIME NOT NULL,
  UNIQUE KEY uq_tmspr_secuencia (confirmacion_id, secuencia),
  UNIQUE KEY uq_tmspr_terminal (confirmacion_id, terminal),
  UNIQUE KEY uq_tmspr_ref (id, empresa_id, plan_id, parada_id, decision),
  INDEX idx_tmspr_empresa_fecha (empresa_id, resuelto_en),
  INDEX idx_tmspr_parada (empresa_id, parada_id, id),
  CONSTRAINT fk_tmspr_confirmacion FOREIGN KEY (confirmacion_id, empresa_id, plan_id, parada_id)
    REFERENCES tms_parada_confirmaciones(id, empresa_id, plan_id, parada_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tmspr_plan FOREIGN KEY (empresa_id, plan_id)
    REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tmspr_usuario FOREIGN KEY (resuelto_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tmspr_decision CHECK (decision IN ('MANTENER_PENDIENTE','AUTORIZAR_NUEVO_INTENTO','CERRAR_SIN_ENTREGA')),
  -- terminal = 1 solo en las decisiones que cierran la incidencia (a lo sumo UNA por incidencia gracias a uq_tmspr_terminal).
  -- evidencia_corte_id = mayor id de evidencia de la parada al autorizar: el nuevo intento debe respaldarse con una evidencia POSTERIOR.
  CONSTRAINT ck_tmspr_forma CHECK (
    (decision = 'MANTENER_PENDIENTE' AND terminal IS NULL AND evidencia_corte_id IS NULL)
    OR (decision = 'AUTORIZAR_NUEVO_INTENTO' AND terminal <=> 1 AND evidencia_corte_id IS NOT NULL)
    OR (decision = 'CERRAR_SIN_ENTREGA' AND terminal <=> 1 AND evidencia_corte_id IS NULL)),
  CONSTRAINT ck_tmspr_secuencia CHECK (secuencia >= 1),
  CONSTRAINT ck_tmspr_justificacion CHECK (CHAR_LENGTH(TRIM(justificacion)) >= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Parte 3: reintentos (consumo de una autorización) ----
-- Une la NUEVA confirmación del piloto con la resolución que la autorizó. Cada autorización se consume UNA sola vez (PRIMARY y UNIQUE) y solo una
-- resolución AUTORIZAR_NUEVO_INTENTO puede referenciarse (la clave foránea incluye la decisión).
CREATE TABLE IF NOT EXISTS tms_parada_confirmacion_reintentos (
  confirmacion_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  resolucion_id BIGINT UNSIGNED NOT NULL,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  parada_id INT NOT NULL,
  decision VARCHAR(24) NOT NULL DEFAULT 'AUTORIZAR_NUEVO_INTENTO',
  UNIQUE KEY uq_tmspcr_resolucion (resolucion_id),
  CONSTRAINT fk_tmspcr_confirmacion FOREIGN KEY (confirmacion_id, empresa_id, plan_id, parada_id)
    REFERENCES tms_parada_confirmaciones(id, empresa_id, plan_id, parada_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tmspcr_resolucion FOREIGN KEY (resolucion_id, empresa_id, plan_id, parada_id, decision)
    REFERENCES tms_parada_incidencia_resoluciones(id, empresa_id, plan_id, parada_id, decision) ON DELETE RESTRICT,
  CONSTRAINT ck_tmspcr_decision CHECK (decision = 'AUTORIZAR_NUEVO_INTENTO')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Postcheck propuesto (solo lectura) ----
--   SHOW CREATE TABLE tms_parada_incidencia_resoluciones; SHOW CREATE TABLE tms_parada_confirmacion_reintentos;
--   SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME IN ('tms_parada_incidencia_resoluciones','tms_parada_confirmacion_reintentos') ORDER BY 1, 2;
--   Esperado: resoluciones = PRIMARY, 3 UNIQUE (secuencia, terminal, ref), 3 FK y 4 CHECK; reintentos = PRIMARY, UNIQUE, 2 FK, 1 CHECK.
-- Reversión (solo con autorización y si aún no hay filas): DROP TABLE tms_parada_confirmacion_reintentos; DROP TABLE tms_parada_incidencia_resoluciones;
--   ALTER TABLE tms_parada_confirmaciones DROP KEY uq_tmspc_ref;
-- Permisos mínimos para la cuenta de aplicación del laboratorio: SELECT, INSERT sobre ambas tablas (nunca UPDATE/DELETE).
