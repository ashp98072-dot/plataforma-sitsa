-- PROPUESTA PARA REVISIÓN. NO se ejecuta desde la aplicación ni desde una solicitud. Aplicar UNA sola vez, con importaciones pausadas (el ALTER toca flota_cb2_consumos).
-- Objetivo: poder GUARDAR un consumo Shell cuya placa NO se vincula a un vehículo de Flota (placa duplicada/ambigua o desconocida), conservando la placa original del Excel:
--   · `vinculo_unidad` = NULL        → comportamiento actual (unidad de Flota o identidad externa registrada).
--   · `vinculo_unidad` = 'AMBIGUA'   → la placa coincide con varias unidades de Flota; no se eligió ninguna (se resuelve después).
--   · `vinculo_unidad` = 'SIN_VINCULO' → la placa no corresponde a ninguna unidad de Flota; no se crea ningún vehículo.
-- No crea tablas ni vehículos, no modifica ni borra filas (las filas existentes quedan con vinculo_unidad NULL y siguen cumpliendo el CHECK), no cambia FK.
-- Requiere el NIVEL 4 (piloto-reportado). GUARDA DE ORDEN: la primera cláusula reemplaza `ck_cb2_piloto_reportado` por su misma definición; si el nivel 4 no está instalado esa
-- restricción no existe y TODO el ALTER falla sin cambiar nada. La aplicación detecta la instalación (columna + CHECK) y, mientras no esté, conserva el comportamiento anterior.
-- No es idempotente: repetirlo falla (columna duplicada) sin cambiar nada. Reversión: ver LEEME (solo posible mientras no existan filas con vinculo_unidad).
ALTER TABLE flota_cb2_consumos
 ADD COLUMN vinculo_unidad VARCHAR(20) NULL,
 DROP CONSTRAINT ck_cb2_piloto_reportado,
 ADD CONSTRAINT ck_cb2_piloto_reportado CHECK (
   COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')<>'REPORTADO_V1'
   OR (empleado_id IS NULL AND piloto_externo_id IS NULL AND asociacion_externa_id IS NULL)
 ),
 DROP CONSTRAINT ck_cb2c_unidad_tipo,
 ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (
  -- Políticas anteriores (idénticas a REPORTADO_V1 / nivel 4): preservar su forma e historial.
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
  -- NUEVO: unidad sin vincular (placa original conservada en placa_original / placa_normalizada). El piloto es un empleado (empleado_id) o un nombre reportado (tablas de pilotos reportados).
  OR (
   vinculo_unidad IN ('AMBIGUA','SIN_VINCULO')
   AND vehiculo_id IS NULL AND unidad_externa_id IS NULL AND asociacion_externa_id IS NULL AND piloto_externo_id IS NULL AND identidad_externa IS NULL
  )
 ),
 ADD CONSTRAINT ck_cb2c_vinculo CHECK (
  vinculo_unidad IS NULL
  OR (vinculo_unidad IN ('AMBIGUA','SIN_VINCULO') AND vehiculo_id IS NULL AND unidad_externa_id IS NULL AND asociacion_externa_id IS NULL AND piloto_externo_id IS NULL AND identidad_externa IS NULL)
 );
