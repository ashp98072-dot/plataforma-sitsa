-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma. No
-- consulta tablas de metadatos del sistema (producción no las permite).
--
-- Definición esperada:
--   flota_vehiculos.tipo_unidad        varchar(20)  NO   VEHICULO
--   tms_planes_viaje.tc_vehiculo_id    int(11)      YES  NULL
--   tms_planes_viaje.tc_placa_historica varchar(40) YES  NULL
--   tms_planes_viaje.tc_externo_placa   varchar(40) YES  NULL
--
-- Interpretación conjunta de los 4 resultados:
--   APLICAR: las 4 devuelven cero filas. Ejecutar
--            sql/migrate-2026-09-programacion-tc-caja-remolque.sql.
--   NOOP:    las 4 devuelven una fila con exactamente la definición
--            esperada. La migración ya está aplicada: no ejecutar nada.
--   DETENER: estado parcial (solo alguna existe) o alguna columna con
--            definición distinta. No ejecutar la migración: revisar primero
--            con los SHOW CREATE TABLE de abajo.

SHOW COLUMNS FROM flota_vehiculos LIKE 'tipo_unidad';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'tc_vehiculo_id';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'tc_placa_historica';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'tc_externo_placa';

-- Respaldo opcional (tampoco escribe ni altera datos).
SHOW CREATE TABLE flota_vehiculos;
SHOW CREATE TABLE tms_planes_viaje;

-- Informativo, para decidir después qué unidades clasificar como TC/CABEZAL
-- (solo lectura; este PR NO clasifica ni actualiza nada):
-- SELECT id, empresa_id, placa, marca, modelo, descripcion FROM flota_vehiculos WHERE activo = 1 ORDER BY empresa_id, placa;
