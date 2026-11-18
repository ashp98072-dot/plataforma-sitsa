-- EJECUCION DEL NIVEL 4 (ALTER) CON ESQUEMA PRODUCTIVO EXPLICITO. NO ejecutado en produccion: lo ejecuta el propietario, UNA sola vez, solo si 30-preflight-nivel4-esquema.sql dio
-- `APTO PARA APLICAR NIVEL 4`. El ALTER nombra la base y la tabla (`u611730801_Plataforma`.`flota_cb2_consumos`), por lo que NO depende de la base seleccionada en phpMyAdmin
-- (incluso con information_schema seleccionada afecta solo a esa tabla). Contenido identico a sql/migrate-2026-11-cb2-piloto-reportado.sql salvo el calificador de la tabla (lo comprueba una prueba).
-- Es un solo ALTER atomico y fail-closed: si falta el nivel 3 (no existe ck_cb2_piloto_unico) o el nivel 4 ya esta instalado, falla ENTERO sin cambiar nada. Reconstruye la tabla y bloquea escrituras:
-- ejecutar en ventana, con importaciones pausadas. No cambia ni borra filas. Despues: 40-postcheck-nivel4-esquema.sql.
ALTER TABLE `u611730801_Plataforma`.`flota_cb2_consumos`
 DROP CONSTRAINT ck_cb2_piloto_unico,
 ADD CONSTRAINT ck_cb2_piloto_unico CHECK (empleado_id IS NULL OR piloto_externo_id IS NULL),
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
