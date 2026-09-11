-- GASTOS-ADMINISTRATIVO-1 — Fase 1: columnas estructurales para requirente,
-- solicitante, autorizante y estado en Gastos operativos, EQUIVALENTES a
-- las de tms_solicitudes_fondo (ver migrate-2026-09-fondos-entidad-requirente.sql),
-- pero SIN encabezado/lote nuevo: cada fila de tms_gastos_operativos es su
-- propia unidad administrativa (opción B aprobada, no se crea
-- tms_solicitudes_gasto). Migración aditiva y manual.
--
-- Las 14 columnas nuevas quedan NULL para TODA fila existente (ninguna
-- tiene DEFAULT distinto de NULL, `estado` incluido — a propósito no lleva
-- DEFAULT 'Pendiente', porque en MySQL un ADD COLUMN ... DEFAULT 'x'
-- también rellena las filas ya existentes, y eso es exactamente lo que no
-- se quiere aquí). La aplicación interpreta `estado IS NULL` como
-- histórico/legado ya aceptado, nunca como pendiente de autorizar.
--
-- Esta migración NO incluye backfill (ver, por separado y sin ejecutar,
-- sql/backfill-2026-09-gastos-estado-historico.sql). No crea tablas, no
-- hace UPDATE/DELETE/DROP. No toca tiene_factura ni ninguna columna de
-- comprobante/factura existente.
--
-- SOLO EJECUTAR MANUALMENTE tras autorización explícita — no se corre
-- desde la aplicación ni en este PR.

ALTER TABLE tms_gastos_operativos
  ADD COLUMN IF NOT EXISTS entidad_requirente_id INT NULL AFTER numero_cuenta_pago,
  ADD COLUMN IF NOT EXISTS entidad_requirente_nombre VARCHAR(200) NULL AFTER entidad_requirente_id,
  ADD COLUMN IF NOT EXISTS requirente_empleado_id INT NULL AFTER entidad_requirente_nombre,
  ADD COLUMN IF NOT EXISTS requirente_nombre VARCHAR(200) NULL AFTER requirente_empleado_id,
  ADD COLUMN IF NOT EXISTS requirente_usuario_id INT NULL AFTER requirente_nombre,
  ADD COLUMN IF NOT EXISTS solicitante_usuario_id INT NULL AFTER requirente_usuario_id,
  ADD COLUMN IF NOT EXISTS solicitante_nombre VARCHAR(200) NULL AFTER solicitante_usuario_id,
  ADD COLUMN IF NOT EXISTS autorizante_empleado_id INT NULL AFTER solicitante_nombre,
  ADD COLUMN IF NOT EXISTS autorizante_nombre VARCHAR(200) NULL AFTER autorizante_empleado_id,
  ADD COLUMN IF NOT EXISTS autorizante_usuario_id INT NULL AFTER autorizante_nombre,
  ADD COLUMN IF NOT EXISTS estado VARCHAR(30) NULL AFTER autorizante_usuario_id,
  ADD COLUMN IF NOT EXISTS autorizado_en DATETIME NULL AFTER estado,
  ADD COLUMN IF NOT EXISTS rechazado_en DATETIME NULL AFTER autorizado_en,
  ADD COLUMN IF NOT EXISTS motivo_rechazo VARCHAR(300) NULL AFTER rechazado_en,
  ADD INDEX IF NOT EXISTS idx_gastos_estado (empresa_id, estado);

-- FK de ámbito: entidad requirente. Verificado antes de escribir esta
-- migración: cont_entidades tiene UNIQUE KEY uq_cont_entidad_empresa_id
-- (empresa_id, id) — mismo orden exacto que exige esta FK compuesta.
SET @fk_entidad_existe := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_gastos_operativos'
    AND CONSTRAINT_NAME = 'fk_gasto_entidad_requirente_ambito'
);
SET @sql_fk_entidad := IF(@fk_entidad_existe = 0,
  'ALTER TABLE tms_gastos_operativos ADD CONSTRAINT fk_gasto_entidad_requirente_ambito FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_gasto_entidad_requirente_ambito ya existe'' AS resultado'
);
PREPARE stmt_fk_entidad FROM @sql_fk_entidad;
EXECUTE stmt_fk_entidad;
DEALLOCATE PREPARE stmt_fk_entidad;

-- FK de ámbito: requirente-empleado (legado, mismo criterio que
-- tms_solicitudes_fondo). Verificado: empleados tiene UNIQUE KEY
-- uq_ruta_personal_empresa_id (empresa_id, id) — mismo orden exacto.
SET @fk_requirente_existe := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_gastos_operativos'
    AND CONSTRAINT_NAME = 'fk_gasto_requirente_ambito'
);
SET @sql_fk_requirente := IF(@fk_requirente_existe = 0,
  'ALTER TABLE tms_gastos_operativos ADD CONSTRAINT fk_gasto_requirente_ambito FOREIGN KEY (empresa_id, requirente_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_gasto_requirente_ambito ya existe'' AS resultado'
);
PREPARE stmt_fk_requirente FROM @sql_fk_requirente;
EXECUTE stmt_fk_requirente;
DEALLOCATE PREPARE stmt_fk_requirente;

-- FK de ámbito: autorizante-empleado (legado, mismo criterio). Mismo
-- índice compuesto verificado arriba (empleados.uq_ruta_personal_empresa_id).
SET @fk_autorizante_existe := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_gastos_operativos'
    AND CONSTRAINT_NAME = 'fk_gasto_autorizante_ambito'
);
SET @sql_fk_autorizante := IF(@fk_autorizante_existe = 0,
  'ALTER TABLE tms_gastos_operativos ADD CONSTRAINT fk_gasto_autorizante_ambito FOREIGN KEY (empresa_id, autorizante_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_gasto_autorizante_ambito ya existe'' AS resultado'
);
PREPARE stmt_fk_autorizante FROM @sql_fk_autorizante;
EXECUTE stmt_fk_autorizante;
DEALLOCATE PREPARE stmt_fk_autorizante;

-- Nota: sin FK para requirente_usuario_id / solicitante_usuario_id /
-- autorizante_usuario_id — mismo criterio que tms_solicitudes_fondo:
-- `usuarios` es una tabla GLOBAL sin empresa_id, no se puede componer una
-- FK de ámbito con ella; la pertenencia a esta empresa se valida en
-- aplicación (resolverUsuarioDeEmpresaTx), no en la base.
