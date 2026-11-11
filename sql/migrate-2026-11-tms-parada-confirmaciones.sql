-- ============================================================================
-- TMS-ENTREGA-PILOTO-1 — confirmación de entrega POR PARADA hecha por el piloto.
-- PARA REVISIÓN: NO SE HA EJECUTADO en ningún entorno. No hay instalador, no se aplica solo,
-- y NO está en src/lib/flota/schema.ts (no se crea en runtime): hay que aplicarla a mano, con autorización.
--
-- Requisitos previos: tms_planes_viaje (UNIQUE uq_tmsplanes_empresa_id) y tms_plan_paradas ya existen
-- (tms_plan_paradas se crea en runtime por src/lib/flota/schema.ts; en producción ya existe).
--
-- Diseño:
--  * SOLO SE AGREGAN FILAS (ninguna sentencia de la aplicación hace UPDATE ni DELETE sobre esta tabla).
--    Una confirmación no se corrige ni se borra: si algo cambia, se agrega otra fila.
--  * Una parada admite como máximo UNA fila ENTREGADA_POR_PILOTO (UNIQUE uq_tmspc_entrega sobre
--    (parada_id, entrega_vigente), con entrega_vigente = 1 solo en esa fila y NULL en las demás).
--  * PARCIAL / RECHAZADA / INCIDENCIA nacen con revision = 'PENDIENTE' (revisión humana) y exigen nota.
--  * Se guarda una FOTOGRAFÍA de la parada y de la evidencia (tipo, orden, lugar, ruta, captura, autor): si luego se edita
--    la parada o se retira la evidencia, la confirmación histórica conserva lo que el piloto vio.
--  * FK ON DELETE RESTRICT a plan y parada: no se pueden borrar mientras exista una confirmación.
--  * La confirmación del piloto NO es una recepción aceptada por PriceSmart y no publica ningún estado externo.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tms_parada_confirmaciones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  viaje_id INT NOT NULL,
  parada_id INT NOT NULL,
  parada_tipo VARCHAR(40) NOT NULL,
  parada_orden TINYINT NOT NULL,
  parada_lugar_nombre VARCHAR(200) NOT NULL,
  resultado VARCHAR(24) NOT NULL,
  revision VARCHAR(12) NOT NULL,
  entrega_vigente TINYINT NULL,
  piloto_empleado_id INT NOT NULL,
  piloto_personal_id INT NOT NULL,
  piloto_usuario VARCHAR(100) NOT NULL,
  evidencia_id INT NOT NULL,
  evidencia_ruta VARCHAR(400) NOT NULL,
  evidencia_capturada_en DATETIME NULL,
  evidencia_subido_por VARCHAR(100) NULL,
  nota VARCHAR(500) NULL,
  confirmado_en DATETIME NOT NULL,
  UNIQUE KEY uq_tmspc_entrega (parada_id, entrega_vigente),
  INDEX idx_tmspc_parada (empresa_id, parada_id, id),
  INDEX idx_tmspc_plan (empresa_id, plan_id, id),
  CONSTRAINT fk_tmspc_plan FOREIGN KEY (empresa_id, plan_id)
    REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tmspc_parada FOREIGN KEY (parada_id)
    REFERENCES tms_plan_paradas(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tmspc_resultado CHECK (resultado IN ('ENTREGADA_POR_PILOTO','PARCIAL','RECHAZADA','INCIDENCIA')),
  CONSTRAINT ck_tmspc_revision CHECK (revision IN ('NO_REQUERIDA','PENDIENTE')),
  CONSTRAINT ck_tmspc_vigente CHECK (
    -- «<=>» (igualdad que tolera NULL): con «=», entrega_vigente NULL daría UNKNOWN y el CHECK lo ACEPTARÍA (hallazgo del laboratorio B12.3).
    (resultado = 'ENTREGADA_POR_PILOTO' AND entrega_vigente <=> 1 AND revision = 'NO_REQUERIDA')
    OR (resultado <> 'ENTREGADA_POR_PILOTO' AND entrega_vigente IS NULL AND revision = 'PENDIENTE')),
  CONSTRAINT ck_tmspc_nota CHECK (resultado = 'ENTREGADA_POR_PILOTO' OR (nota IS NOT NULL AND CHAR_LENGTH(nota) >= 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Verificación posterior (solo lectura): SHOW CREATE TABLE tms_parada_confirmaciones;
-- Reversión (solo con autorización y si aún no hay filas): DROP TABLE tms_parada_confirmaciones;
