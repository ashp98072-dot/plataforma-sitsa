-- C2A: preparación aditiva para MariaDB 11.8. Aplicación MANUAL, no automática.
-- NO separa libros todavía. No cargar datos por entidad hasta completar C2B.
-- Requiere las cinco tablas contables actuales. Revisar SHOW CREATE TABLE primero.
-- IF NOT EXISTS evita duplicar nombres, pero no corrige definiciones divergentes.
-- DDL puede confirmar implícitamente: respaldo y ventana de mantenimiento.
-- No hay limpieza, backfill, cambios a clientes ni sustitución de claves únicas.

ALTER TABLE cont_cuentas
  ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_cont_cuentas_entidad (empresa_id, entidad_id);

ALTER TABLE cont_asientos
  ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_cont_asientos_entidad (empresa_id, entidad_id);

ALTER TABLE cont_asiento_detalle
  ADD COLUMN IF NOT EXISTS empresa_id INT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_cont_detalle_entidad (empresa_id, entidad_id);

ALTER TABLE cont_cxc
  ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_cont_cxc_entidad (empresa_id, entidad_id);

ALTER TABLE cont_cxp
  ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS idx_cont_cxp_entidad (empresa_id, entidad_id);

-- Los INSERT actuales omiten estos campos y siguen guardando NULL.
-- Las FKs compuestas y NOT NULL llegarán con el corte de C2B, no antes.
-- No eliminar uq_cuenta/uq_asiento ni habilitar datos mixtos por esta preparación.
