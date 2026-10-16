-- C-2C — conciliacion controlada reporte proveedor <-> vale interno. PROPUESTA: NO ejecutada en produccion por la rama.
-- Probada solo en MariaDB 11.8.9 desechable. Ejecutar ANTES: preflight-2026-10-combustibles-c2c-conciliacion.sql y detenerse ante divergencias.
-- Incremental, ADITIVA e idempotente (IF NOT EXISTS). Sin DML, sin backfill: las columnas nuevas nacen NULL (ninguna fila existente cambia).
--
-- Modelo: se AMPLIAN las filas de C-2B (flota_combustible_conciliacion_filas); no hay tabla paralela.
--   estado_c2c / modo_c2c ........ estado de conciliacion (separado de estado_parseo) y AUTO|MANUAL
--   carga_vinculada_id ........... vinculo ACTIVO fila canonica <-> vale (propuesta AUTO exacta o confirmacion MANUAL)
--   carga_sugerida_id ............ candidato unico propuesto que requiere revision
--   diferencias_c2c (JSON) ....... diferencias estructuradas por campo
--   confirmado_por_usuario_id / confirmado_en / calculado_en
-- Unicidad (MariaDB no tiene UNIQUE parcial): UNIQUE (empresa_id, carga_vinculada_id). Las columnas NULL no chocan entre si, de modo que
-- "un vale <-> maximo una fila" lo garantiza el motor, y "una fila <-> maximo un vale" lo garantiza que sea UNA columna.
-- carga_combustible_id (legacy) NO se reutiliza: una carga legacy puede aparecer en varias conciliaciones historicas.
ALTER TABLE flota_combustible_conciliacion_filas
  ADD COLUMN IF NOT EXISTS estado_c2c VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS modo_c2c VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS carga_vinculada_id INT NULL,
  ADD COLUMN IF NOT EXISTS carga_sugerida_id INT NULL,
  ADD COLUMN IF NOT EXISTS diferencias_c2c JSON NULL,
  ADD COLUMN IF NOT EXISTS calculado_en DATETIME NULL,
  ADD COLUMN IF NOT EXISTS confirmado_por_usuario_id INT NULL,
  ADD COLUMN IF NOT EXISTS confirmado_en DATETIME NULL;

ALTER TABLE flota_combustible_conciliacion_filas
  ADD UNIQUE INDEX IF NOT EXISTS uq_fccif_vinculo (empresa_id, carga_vinculada_id),
  ADD INDEX IF NOT EXISTS idx_fccif_c2c (empresa_id, conciliacion_id, estado_c2c),
  ADD INDEX IF NOT EXISTS idx_fccif_sugerida (empresa_id, carga_sugerida_id);

ALTER TABLE flota_combustible_conciliacion_filas
  ADD CONSTRAINT IF NOT EXISTS chk_fccif_estado_c2c CHECK (estado_c2c IS NULL OR estado_c2c IN
    ('PENDIENTE','COINCIDENCIA_EXACTA','COINCIDENCIA_CON_DIFERENCIAS','SIN_VALE_INTERNO','VALE_INTERNO_SIN_REPORTE','AMBIGUA','DESCARTADA_MANUAL')),
  ADD CONSTRAINT IF NOT EXISTS chk_fccif_modo_c2c CHECK (modo_c2c IS NULL OR modo_c2c IN ('AUTO','MANUAL')),
  ADD CONSTRAINT IF NOT EXISTS chk_fccif_vinculo_estado CHECK (carga_vinculada_id IS NULL OR estado_c2c IN ('COINCIDENCIA_EXACTA','COINCIDENCIA_CON_DIFERENCIAS')),
  ADD CONSTRAINT IF NOT EXISTS chk_fccif_diferencias_json CHECK (diferencias_c2c IS NULL OR JSON_VALID(diferencias_c2c));

ALTER TABLE flota_combustible_conciliacion_filas
  ADD FOREIGN KEY IF NOT EXISTS fk_fccif_vinculo (carga_vinculada_id) REFERENCES flota_combustible_cargas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD FOREIGN KEY IF NOT EXISTS fk_fccif_sugerida (carga_sugerida_id) REFERENCES flota_combustible_cargas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD FOREIGN KEY IF NOT EXISTS fk_fccif_confirmo (confirmado_por_usuario_id) REFERENCES usuarios(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- La pertenencia a la misma empresa (fila.empresa_id = vale.empresa_id) y al mismo proveedor se valida en la transaccion del servicio
-- y se audita en postcheck (no hay UNIQUE (empresa_id,id) en flota_combustible_cargas y no se altera esa tabla).
