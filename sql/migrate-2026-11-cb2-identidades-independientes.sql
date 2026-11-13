-- Propuesta MANUAL. Aplicar antes de usar pilotoTipo. No actualiza consumos previos.
ALTER TABLE flota_cb2_consumos
 ADD CONSTRAINT ck_cb2_piloto_unico CHECK (empleado_id IS NULL OR piloto_externo_id IS NULL),
 DROP CONSTRAINT ck_cb2c_unidad_tipo,
 ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (
  -- Politicas anteriores: preservar su forma e historial.
  (vehiculo_id IS NOT NULL AND asociacion_externa_id IS NULL AND identidad_externa IS NULL AND piloto_externo_id IS NULL AND unidad_externa_id IS NULL)
  OR (vehiculo_id IS NULL AND empleado_id IS NULL AND asociacion_externa_id IS NOT NULL AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa) AND piloto_externo_id IS NULL AND unidad_externa_id IS NULL)
  OR (vehiculo_id IS NULL AND empleado_id IS NULL AND asociacion_externa_id IS NULL AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa) AND piloto_externo_id IS NOT NULL AND unidad_externa_id IS NOT NULL AND COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')<>'INDEPENDIENTE_V1')
  OR (
   asociacion_externa_id IS NULL AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa)
   AND COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')='INDEPENDIENTE_V1'
   AND ((vehiculo_id IS NOT NULL AND unidad_externa_id IS NULL) OR (vehiculo_id IS NULL AND unidad_externa_id IS NOT NULL))
   AND COALESCE(JSON_VALUE(identidad_externa,'$.piloto.tipo'),'')=IF(empleado_id IS NOT NULL,'INTERNO','EXTERNO')
   AND COALESCE(JSON_VALUE(identidad_externa,'$.piloto.id'),0)=COALESCE(empleado_id,piloto_externo_id)
   AND COALESCE(JSON_VALUE(identidad_externa,'$.unidad.tipo'),'')=IF(vehiculo_id IS NOT NULL,'FLOTA','EXTERNA')
   AND COALESCE(JSON_VALUE(identidad_externa,'$.unidad.id'),0)=COALESCE(vehiculo_id,unidad_externa_id)
   AND ((empleado_id IS NOT NULL AND piloto_externo_id IS NULL) OR (empleado_id IS NULL AND piloto_externo_id IS NOT NULL))
  )
 );
