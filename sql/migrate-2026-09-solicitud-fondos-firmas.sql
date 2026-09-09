-- SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (corrección PR #212 — firmas reales)
-- Aplicación MANUAL (MariaDB 11.8, mismo motor que el resto del
-- proyecto). NO se ejecuta automáticamente. Aditiva y reejecutable
-- (ADD COLUMN/ADD INDEX con IF NOT EXISTS; las FOREIGN KEY nuevas se
-- agregan solo si todavía no existen, mismo criterio que
-- sql/migrate-2026-09-solicitud-fondos-reporte.sql).
--
-- NO hace DROP de columnas, NO borra datos, NO modifica en masa filas
-- existentes: las solicitudes de fondo ya guardadas quedan intactas,
-- con las columnas nuevas en NULL (compatible con el estado "antes" del
-- código — fondos-solicitud-pdf.ts sigue mostrando nombre + espacio en
-- blanco para cualquier solicitud sin estas columnas).
--
-- ARQUITECTURA: se reutiliza TAL CUAL la de Viáticos (firmas_electronicas,
-- ver sql/propuesta-2026-08-firma-electronica*.sql) — NO se inventa otra
-- tabla ni se guardan imágenes en columnas nuevas. Cada firma real
-- (Solicitante al crear, Requirente si está asociado a un usuario,
-- Autorizante al autorizar) queda como una fila INMUTABLE en
-- firmas_electronicas (modulo='FONDOS', entidad_tipo='SOLICITUD_FONDO',
-- entidad_id=<id de la solicitud>, accion='SOLICITAR_FONDO' |
-- 'REQUERIR_FONDO' | 'AUTORIZAR_FONDO') — leerla después (para el PDF)
-- es leer un snapshot ya congelado en el momento de la firma, NUNCA la
-- firma "actual" de ese usuario en `usuario_firmas` ("Mi firma"); cambiar
-- o borrar la plantilla personal después nunca altera esta copia.
--
-- Estas columnas nuevas en tms_solicitudes_fondo son SOLO la referencia
-- ligera (quién + su nombre real en ese momento) para no tener que
-- re-consultar firmas_electronicas solo para mostrar un nombre — mismo
-- patrón que ya usan autorizante_empleado_id/autorizante_nombre en esa
-- misma tabla (columnas de la migración original):
--   solicitante_usuario_id INT NULL      -- usuarios.id de quien creó la solicitud (sesión, nunca del cliente)
--   solicitante_nombre     VARCHAR(200)  -- snapshot de usuarios.nombre al crear
--   requirente_usuario_id  INT NULL      -- OPCIONAL: cuando el requirente es un usuario real del sistema (además de requirente_empleado_id/requirente_nombre existentes, que siguen sin cambios para el caso de texto libre o empleado RRHH sin firma)
--   autorizante_usuario_id INT NULL      -- usuarios.id de quien autorizó (sesión, nunca del cliente) — distinto de autorizante_empleado_id, que sigue existiendo sin cambios
--
-- `usuarios` es GLOBAL (sin empresa_id, ver usuario_firmas) — estas FK
-- son de una sola columna a usuarios(id), mismo criterio que
-- fk_usuario_firma_usuario en sql/propuesta-2026-08-usuario-firmas.sql,
-- nunca una FK compuesta con empresa_id (el aislamiento multiempresa de
-- CUÁL usuario puede elegirse como requirente/autorizante lo valida el
-- código en src/lib/tms/fondos.ts contra usuario_empresa, no el esquema).

ALTER TABLE tms_solicitudes_fondo
  ADD COLUMN IF NOT EXISTS solicitante_usuario_id INT NULL DEFAULT NULL AFTER creado_por,
  ADD COLUMN IF NOT EXISTS solicitante_nombre VARCHAR(200) NULL DEFAULT NULL AFTER solicitante_usuario_id,
  ADD COLUMN IF NOT EXISTS requirente_usuario_id INT NULL DEFAULT NULL AFTER requirente_nombre,
  ADD COLUMN IF NOT EXISTS autorizante_usuario_id INT NULL DEFAULT NULL AFTER autorizante_nombre;

ALTER TABLE tms_solicitudes_fondo
  ADD INDEX IF NOT EXISTS idx_fondo_solicitante_usuario (solicitante_usuario_id),
  ADD INDEX IF NOT EXISTS idx_fondo_requirente_usuario (requirente_usuario_id),
  ADD INDEX IF NOT EXISTS idx_fondo_autorizante_usuario (autorizante_usuario_id);

SET @db := DATABASE();

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_fondo'
    AND CONSTRAINT_NAME = 'fk_fondo_solicitante_usuario' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitudes_fondo
     ADD CONSTRAINT fk_fondo_solicitante_usuario
     FOREIGN KEY (solicitante_usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_fondo'
    AND CONSTRAINT_NAME = 'fk_fondo_requirente_usuario' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitudes_fondo
     ADD CONSTRAINT fk_fondo_requirente_usuario
     FOREIGN KEY (requirente_usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_fondo'
    AND CONSTRAINT_NAME = 'fk_fondo_autorizante_usuario' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitudes_fondo
     ADD CONSTRAINT fk_fondo_autorizante_usuario
     FOREIGN KEY (autorizante_usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
