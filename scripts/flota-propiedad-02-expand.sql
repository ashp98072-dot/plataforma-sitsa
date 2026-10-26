-- PENDIENTE DE AUDITORÍA. Una única operación DDL; NO ejecutar con otros pasos.
-- Precondición: preflight aprobado, backup verificado, feature apagada.
-- Si algún nombre ya existe, DETENERSE e inspeccionar, no usar IF NOT EXISTS.
-- No cambia empresa_id ni reescribe históricos. NULL de empresa_propietaria_id
-- en EMPRESA significa propietario legacy = empresa_id.
ALTER TABLE flota_vehiculos
  ADD COLUMN tipo_propiedad VARCHAR(10) NOT NULL DEFAULT 'EMPRESA',
  ADD COLUMN empresa_propietaria_id INT NULL,
  ADD COLUMN propietario_externo VARCHAR(120) NULL,
  ADD COLUMN tipo_vehiculo VARCHAR(80) NULL,
  ADD COLUMN revision_propiedad INT UNSIGNED NOT NULL DEFAULT 0,
  ADD INDEX idx_flota_propietaria (empresa_propietaria_id),
  ADD CONSTRAINT fk_flota_propietaria FOREIGN KEY (empresa_propietaria_id)
    REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT ck_flota_propiedad CHECK (
    (tipo_propiedad = 'EMPRESA' AND propietario_externo IS NULL)
    OR (tipo_propiedad = 'EXTERNO' AND empresa_propietaria_id IS NULL
      AND propietario_externo IS NOT NULL AND CHAR_LENGTH(TRIM(propietario_externo)) > 0
      AND tipo_vehiculo IS NOT NULL AND CHAR_LENGTH(TRIM(tipo_vehiculo)) > 0)
  );
-- PARAR. Ejecutar e inspeccionar el postcheck en otra operación, antes de activar.
