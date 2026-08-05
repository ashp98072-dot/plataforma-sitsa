-- Permisos granulares por módulo (Ver / Crear / Editar / Eliminar)
-- Ejecutar en phpMyAdmin sobre u611730801_Plataforma.

-- Ignorar error si la columna ya existe (#1060)
ALTER TABLE usuario_modulo
  ADD COLUMN puede_crear TINYINT(1) NOT NULL DEFAULT 0 AFTER puede_ver;

ALTER TABLE usuario_modulo
  ADD COLUMN puede_eliminar TINYINT(1) NOT NULL DEFAULT 0 AFTER puede_editar;

-- Índice para upserts globales (empresa_id NULL = permiso de plataforma)
-- Si falla por duplicados, limpia filas repetidas primero.
ALTER TABLE usuario_modulo
  ADD INDEX idx_um_usuario_modulo (usuario_id, modulo);
