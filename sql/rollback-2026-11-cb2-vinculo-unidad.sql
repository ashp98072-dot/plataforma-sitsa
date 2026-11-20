-- REVERSIÓN de `migrate-2026-11-cb2-vinculo-unidad.sql`. NO se ejecuta desde la aplicación. Solo posible si NINGUNA fila usa `vinculo_unidad`:
--   SELECT COUNT(*) FROM flota_cb2_consumos WHERE vinculo_unidad IS NOT NULL;   -- debe dar 0 (vincula antes esas filas con la corrección auditada «Vincular unidad» o decide su destino)
-- Si quedan filas sin vincular, el ALTER FALLA sin cambiar nada (el CHECK del nivel 4 no admite filas sin unidad). Restaura la definición exacta del nivel 4.
ALTER TABLE flota_cb2_consumos
 DROP CONSTRAINT ck_cb2c_vinculo,
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
 ),
 DROP COLUMN vinculo_unidad;
