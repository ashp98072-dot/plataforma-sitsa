-- PROPUESTA para auditor?a. No ejecutar autom?ticamente. Requiere #613 instalado.
-- ALTER ?nico: las ramas anteriores y las FK permanecen; no se actualizan registros.
ALTER TABLE flota_cb2_consumos
 ADD CONSTRAINT ck_cb2_piloto_reportado CHECK (
   COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')<>'REPORTADO_V1'
   OR (empleado_id IS NULL AND piloto_externo_id IS NULL AND asociacion_externa_id IS NULL)
 ),
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
 OR (
   asociacion_externa_id IS NULL AND empleado_id IS NULL AND piloto_externo_id IS NULL
   AND vehiculo_id IS NULL AND unidad_externa_id IS NOT NULL
   AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa)
   AND COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')='REPORTADO_V1'
   AND COALESCE(JSON_VALUE(identidad_externa,'$.piloto.tipo'),'')='REPORTADO'
   AND JSON_VALUE(identidad_externa,'$.piloto.id') IS NULL
   AND COALESCE(JSON_VALUE(identidad_externa,'$.unidad.tipo'),'')='EXTERNA'
   AND COALESCE(JSON_VALUE(identidad_externa,'$.unidad.id'),0)=unidad_externa_id
  )
 );
