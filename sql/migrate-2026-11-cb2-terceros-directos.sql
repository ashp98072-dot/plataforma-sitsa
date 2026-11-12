-- Aplicación manual después de auditoría. No modifica consumos históricos ni asociaciones.
-- Activación separada: CB2_TERCEROS_DIRECTOS_APROBADA=1.
ALTER TABLE flota_cb2_consumos
 ADD piloto_externo_id INT NULL,
 ADD unidad_externa_id INT NULL,
 ADD CONSTRAINT fk_cb2c_piloto_directo FOREIGN KEY(empresa_id,piloto_externo_id) REFERENCES flota_cb2_externos_pilotos(empresa_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT fk_cb2c_unidad_directa FOREIGN KEY(empresa_id,unidad_externa_id) REFERENCES flota_cb2_externos_unidades(empresa_id,id) ON DELETE RESTRICT,
 ADD KEY ix_cb2c_piloto_directo(empresa_id,piloto_externo_id,id),
 ADD KEY ix_cb2c_unidad_directa(empresa_id,unidad_externa_id,id),
 DROP CONSTRAINT ck_cb2c_unidad_tipo,
 ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (
  (vehiculo_id IS NOT NULL AND asociacion_externa_id IS NULL AND identidad_externa IS NULL AND piloto_externo_id IS NULL AND unidad_externa_id IS NULL)
  OR (vehiculo_id IS NULL AND empleado_id IS NULL AND asociacion_externa_id IS NOT NULL AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa) AND piloto_externo_id IS NULL AND unidad_externa_id IS NULL)
  OR (vehiculo_id IS NULL AND empleado_id IS NULL AND asociacion_externa_id IS NULL AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa) AND piloto_externo_id IS NOT NULL AND unidad_externa_id IS NOT NULL)
 );
