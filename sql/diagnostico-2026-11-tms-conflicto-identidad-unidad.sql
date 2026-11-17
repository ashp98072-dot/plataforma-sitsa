-- SOLO LECTURA. Diagnóstico del error «Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos» al copiar programación.
-- Uso (phpMyAdmin, base de producción ya seleccionada): reemplazar @empresa y @placa por los de la fila indicada en el mensaje («Fila N (unidad PLACA)»).
-- NO modifica nada. La reparación (si procede) es UNA sentencia por unidad, con guarda triple, que decide el propietario tras ver este resultado (ver el final del archivo, comentada).
SET @empresa = 1;            -- ← empresa activa
SET @placa   = 'C-801BXY';   -- ← placa de la unidad que indica el mensaje

-- 1) Unidades TMS de esa empresa con la misma placa (comparación sin guiones, espacios ni mayúsculas, como hace el resolvedor).
SELECT u.id AS tms_unidad_id, u.placa, u.flota_vehiculo_id,
       (SELECT COUNT(*) FROM tms_planes_viaje p WHERE p.unidad_id = u.id) AS planes_que_la_usan
FROM tms_unidades u
WHERE u.empresa_id = @empresa
  AND REPLACE(REPLACE(UPPER(u.placa),'-',''),' ','') = REPLACE(REPLACE(UPPER(@placa),'-',''),' ','');

-- 2) Vehículos de Flota visibles para la empresa (propios o compartidos) con esa placa.
SELECT v.id AS flota_id, v.empresa_id AS empresa_duena, v.placa, v.activo, v.estado,
       EXISTS (SELECT 1 FROM flota_vehiculo_acceso a WHERE a.vehiculo_id = v.id AND a.empresa_id = @empresa) AS compartido_con_la_empresa
FROM flota_vehiculos v
WHERE REPLACE(REPLACE(UPPER(v.placa),'-',''),' ','') = REPLACE(REPLACE(UPPER(@placa),'-',''),' ','')
  AND (v.empresa_id = @empresa OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso a WHERE a.vehiculo_id = v.id AND a.empresa_id = @empresa));

-- 3) Cómo leer el resultado:
--   a) UNA unidad TMS con flota_vehiculo_id NULL y UN vehículo de Flota activo con esa placa → caso típico de «unidad histórica sin vincular» (el de la copia).
--   b) flota_vehiculo_id apunta a OTRO vehículo de Flota (alias/fusión/placa reutilizada) → NO vincular a ciegas: revisar la identidad canónica del vehículo.
--   c) Varias unidades TMS o varios vehículos de Flota con la placa → ambigüedad: decidir manualmente cuál es la correcta.
--   d) Sin vehículo de Flota activo → la placa no existe vigente en Flota (la validación de la copia lo debería haber rechazado antes).

-- 4) REPARACIÓN (NO ejecutar sin autorización expresa; solo el caso a). Una por unidad, con el patrón de la Fase A3 (id + empresa + placa + NULL):
--    Vincular la unidad TMS histórica a su vehículo de Flota hace que los planes viejos de esa unidad pasen a atribuirse a ese vehículo: es la decisión que el resolvedor
--    no toma solo. Verificar antes los «planes_que_la_usan» del resultado 1.
-- UPDATE tms_unidades
--    SET flota_vehiculo_id = <flota_id del resultado 2>
--  WHERE id = <tms_unidad_id del resultado 1>
--    AND empresa_id = @empresa
--    AND placa = '<placa exacta del resultado 1>'
--    AND flota_vehiculo_id IS NULL;
-- Reversión: UPDATE tms_unidades SET flota_vehiculo_id = NULL WHERE id = <tms_unidad_id> AND empresa_id = @empresa;
