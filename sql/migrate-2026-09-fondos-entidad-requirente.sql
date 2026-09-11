-- SOLICITUD-FONDOS-ENTIDAD-REQUIRIENTE-1
-- Migración estructural, aditiva y manual. No crea ni modifica entidades.

ALTER TABLE tms_solicitudes_fondo
  ADD COLUMN IF NOT EXISTS entidad_requirente_id INT NULL AFTER codigo,
  ADD COLUMN IF NOT EXISTS entidad_requirente_nombre VARCHAR(200) NULL AFTER entidad_requirente_id;

SET @fk_existe := (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tms_solicitudes_fondo'
    AND CONSTRAINT_NAME = 'fk_fondo_entidad_requirente_ambito'
);

SET @sql_fk := IF(
  @fk_existe = 0,
  'ALTER TABLE tms_solicitudes_fondo ADD CONSTRAINT fk_fondo_entidad_requirente_ambito FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT',
  'SELECT ''FK fk_fondo_entidad_requirente_ambito ya existe'' AS resultado'
);
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;
