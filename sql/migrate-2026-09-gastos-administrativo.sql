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
--
-- ESTADO REAL EN PRODUCCIÓN (actualizado tras el incidente de las FK,
-- ver el bloque de comentario extenso antes de las 3 ALTER de abajo):
-- las 14 columnas de este bloque YA están aplicadas (verificadas
-- nullable, estado sin default, sin backfill). El bloque ADD COLUMN de
-- abajo NO debe volver a ejecutarse en esa base — ya es un no-op ahí
-- por el IF NOT EXISTS, pero se deja intacto para que la migración
-- siga siendo válida en cualquier entorno nuevo (dev/staging) que
-- parta de cero. Las 3 FK originales NO quedaron registradas — quedan
-- como nombres de índice reservados; la corrección usa 3 nombres
-- nuevos (fk_gastos_entidad_req_scope / fk_gastos_requirente_emp_scope
-- / fk_gastos_autorizante_emp_scope), ver el bloque de comentario
-- extenso más abajo.

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

-- ============================================================
-- INCIDENTE (documentado, no se repite el intento con los nombres
-- originales) — al ejecutar esta migración en producción, las 14
-- columnas se aplicaron correctamente, pero las 3 constraints FK de
-- abajo NO terminaron de registrarse (confirmado: 0 filas en
-- information_schema.REFERENTIAL_CONSTRAINTS y en KEY_COLUMN_USAGE
-- para tms_gastos_operativos). Sin embargo, `SHOW INDEX FROM
-- tms_gastos_operativos` sí muestra índices con los nombres
-- fk_gasto_entidad_requirente_ambito / fk_gasto_requirente_ambito /
-- fk_gasto_autorizante_ambito.
--
-- Causa: ADD CONSTRAINT ... FOREIGN KEY crea, cuando hace falta, un
-- ÍNDICE DE SOPORTE sobre las columnas referenciadas ANTES de registrar
-- la constraint — y si lo crea automáticamente, lo nombra igual que la
-- constraint. En MySQL/MariaDB sin DDL atómico garantizado para este
-- ALTER (común en hosting compartido), esos dos pasos no siempre
-- confirman/revierten como una unidad: el índice quedó creado, el
-- registro de la FK no. Como el nombre de índice y el nombre de
-- constraint comparten el mismo espacio de nombres por tabla en
-- InnoDB, reintentar con el MISMO nombre choca contra el índice
-- huérfano (errno 121, "Duplicate key on write or update" — colisión
-- de nombre de metadato, no de datos).
--
-- Los tres nombres originales quedan PERMANENTEMENTE reservados como
-- nombres de índice en esta tabla — nunca se vuelven a usar como
-- nombre de constraint. Los índices huérfanos NO se eliminan (podrían
-- ser exactamente el soporte que la FK real necesita y borrarlos sin
-- necesidad sería un riesgo innecesario sobre un objeto ya estable).
--
-- Corrección: registrar las FK reales con NOMBRES NUEVOS, nunca usados
-- antes en esta tabla. InnoDB no exige que el índice de soporte tenga
-- el mismo nombre que la constraint — busca entre TODOS los índices
-- existentes uno que ya cubra esas columnas como prefijo izquierdo en
-- el orden correcto y, si lo encuentra, lo REUTILIZA sin crear ni
-- eliminar nada. Los índices huérfanos ya cubren exactamente las
-- columnas que cada FK necesita (los creó esta misma migración), así
-- que deberían reutilizarse automáticamente.
--
-- ANTES de ejecutar los ALTER de abajo, confirma con esta consulta de
-- solo lectura que los tres índices huérfanos cubren las columnas
-- esperadas, en el orden esperado (evidencia, no suposición):
--
--   SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
--   FROM information_schema.STATISTICS
--   WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME = 'tms_gastos_operativos'
--     AND INDEX_NAME IN (
--       'fk_gasto_entidad_requirente_ambito',
--       'fk_gasto_requirente_ambito',
--       'fk_gasto_autorizante_ambito'
--     )
--   ORDER BY INDEX_NAME, SEQ_IN_INDEX;
--
-- Se espera: fk_gasto_entidad_requirente_ambito -> (empresa_id,
-- entidad_requirente_id); fk_gasto_requirente_ambito -> (empresa_id,
-- requirente_empleado_id); fk_gasto_autorizante_ambito -> (empresa_id,
-- autorizante_empleado_id). Si alguno no coincide, DETENTE — no
-- ejecutes los ALTER de abajo y repórtalo antes de continuar.
-- ============================================================

-- FK de ámbito: entidad requirente. Nombre NUEVO (nunca usado antes en
-- esta tabla) — fk_gasto_entidad_requirente_ambito queda reservado
-- como nombre de índice, no se reutiliza. Idempotente sobre el nombre
-- NUEVO, no sobre el viejo.
SET @fk_entidad_existe := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_gastos_operativos'
    AND CONSTRAINT_NAME = 'fk_gastos_entidad_req_scope'
);
SET @sql_fk_entidad := IF(@fk_entidad_existe = 0,
  'ALTER TABLE tms_gastos_operativos ADD CONSTRAINT fk_gastos_entidad_req_scope FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_gastos_entidad_req_scope ya existe'' AS resultado'
);
PREPARE stmt_fk_entidad FROM @sql_fk_entidad;
EXECUTE stmt_fk_entidad;
DEALLOCATE PREPARE stmt_fk_entidad;

-- FK de ámbito: requirente-empleado (legado, mismo criterio que
-- tms_solicitudes_fondo). Nombre NUEVO, mismo motivo que arriba.
SET @fk_requirente_existe := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_gastos_operativos'
    AND CONSTRAINT_NAME = 'fk_gastos_requirente_emp_scope'
);
SET @sql_fk_requirente := IF(@fk_requirente_existe = 0,
  'ALTER TABLE tms_gastos_operativos ADD CONSTRAINT fk_gastos_requirente_emp_scope FOREIGN KEY (empresa_id, requirente_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_gastos_requirente_emp_scope ya existe'' AS resultado'
);
PREPARE stmt_fk_requirente FROM @sql_fk_requirente;
EXECUTE stmt_fk_requirente;
DEALLOCATE PREPARE stmt_fk_requirente;

-- FK de ámbito: autorizante-empleado (legado, mismo criterio). Nombre
-- NUEVO, mismo motivo que arriba.
SET @fk_autorizante_existe := (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_gastos_operativos'
    AND CONSTRAINT_NAME = 'fk_gastos_autorizante_emp_scope'
);
SET @sql_fk_autorizante := IF(@fk_autorizante_existe = 0,
  'ALTER TABLE tms_gastos_operativos ADD CONSTRAINT fk_gastos_autorizante_emp_scope FOREIGN KEY (empresa_id, autorizante_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_gastos_autorizante_emp_scope ya existe'' AS resultado'
);
PREPARE stmt_fk_autorizante FROM @sql_fk_autorizante;
EXECUTE stmt_fk_autorizante;
DEALLOCATE PREPARE stmt_fk_autorizante;

-- Nota: sin FK para requirente_usuario_id / solicitante_usuario_id /
-- autorizante_usuario_id — mismo criterio que tms_solicitudes_fondo:
-- `usuarios` es una tabla GLOBAL sin empresa_id, no se puede componer una
-- FK de ámbito con ella; la pertenencia a esta empresa se valida en
-- aplicación (resolverUsuarioDeEmpresaTx), no en la base.
