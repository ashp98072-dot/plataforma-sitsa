-- C2B. MariaDB 11.8. Aplicación MANUAL, con respaldo y sin escrituras concurrentes.
-- Requiere C2A y migrate-2026-08-contabilidad-entidades.sql.
-- Revisar SHOW CREATE TABLE de las cinco tablas y cont_entidades antes/después.
-- Repetible por nombre. IF NOT EXISTS no corrige definiciones divergentes.
-- DDL confirma implícitamente. Ante error detenerse; nunca desactivar FKs.
-- NULL se conserva SOLO para datos legados: no se reasigna ni elimina ninguna fila.
-- El backend C2B exige empresa/entidad en todos los nuevos registros.

ALTER TABLE cont_cuentas
  ADD UNIQUE INDEX IF NOT EXISTS uq_cuenta_entidad (empresa_id, entidad_id, codigo),
  ADD UNIQUE INDEX IF NOT EXISTS uq_cont_cuenta_ambito (empresa_id, entidad_id, id),
  ADD CONSTRAINT fk_cont_cuenta_entidad FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id)
    REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT;

ALTER TABLE cont_asientos
  ADD UNIQUE INDEX IF NOT EXISTS uq_asiento_entidad (empresa_id, entidad_id, numero),
  ADD UNIQUE INDEX IF NOT EXISTS uq_cont_asiento_ambito (empresa_id, entidad_id, id),
  ADD CONSTRAINT fk_cont_asiento_entidad FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id)
    REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT;

ALTER TABLE cont_cxc
  ADD CONSTRAINT fk_cont_cxc_entidad FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id)
    REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT;

ALTER TABLE cont_cxp
  ADD CONSTRAINT fk_cont_cxp_entidad FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id)
    REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT;

ALTER TABLE cont_asiento_detalle
  ADD CONSTRAINT fk_cont_detalle_asiento_ambito FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id, asiento_id)
    REFERENCES cont_asientos(empresa_id, entidad_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cont_detalle_cuenta_ambito FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id, cuenta_id)
    REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT;

-- Retirar unicidad antigua SOLO después de crear las nuevas restricciones.
-- No reinstalar versiones anteriores de la aplicación: omiten entidad_id.
ALTER TABLE cont_cuentas DROP INDEX IF EXISTS uq_cuenta;
ALTER TABLE cont_asientos DROP INDEX IF EXISTS uq_asiento;
