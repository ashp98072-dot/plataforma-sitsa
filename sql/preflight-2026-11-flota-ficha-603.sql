-- SOLO LECTURA. PREFLIGHT de la eliminación controlada de la ficha #603 (C-035BXR, Fresco Fresh, empresa 4). NO ejecuta ni prepara ningún cambio.
-- Resultado de producción del diagnóstico previo: #603 solo tiene 1 acceso compartido; 0 viajes, lecturas, servicios, documentos, filtros, cargas y bloqueos.
-- Este preflight confirma TODO lo demás antes de aprobar: (1) las filas exactas a respaldar, (2) el inventario COMPLETO de claves foráneas hacia flota_vehiculos,
-- (3) un conteo de cada columna que pueda referenciar un vehículo (se genera solo, sin escribir nada), (4) disparadores, (5) operaciones abiertas, (6) datos de #603 que no están en #1297.
-- Uso (phpMyAdmin, base de producción seleccionada): ejecutar sentencia por sentencia. Sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET.
-- Es una consulta administrativa (ve todas las empresas): no compartir resultados fuera del equipo responsable.

-- P1) Filas EXACTAS que se respaldarían (exportar cada resultado como SQL desde phpMyAdmin: Exportar → «Los resultados de la consulta» → SQL, y guardar con su hash).
SELECT * FROM flota_vehiculos WHERE id = 603;
SELECT * FROM flota_vehiculo_acceso WHERE vehiculo_id = 603;

-- P2) Inventario COMPLETO de claves foráneas que apuntan a flota_vehiculos y su regla de borrado (comparar con la lista esperada del plan).
SELECT k.TABLE_NAME AS tabla, k.COLUMN_NAME AS columna, k.CONSTRAINT_NAME AS restriccion, r.DELETE_RULE AS al_borrar, r.UPDATE_RULE AS al_actualizar
FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = 'flota_vehiculos' ORDER BY k.TABLE_NAME, k.COLUMN_NAME;

-- P3) GENERADOR de conteos: devuelve una sentencia SELECT por cada columna que podría referenciar un vehículo (clave foránea real o nombre *vehiculo*_id / unidad_recurrente_id).
-- Copiar TODA la columna `ejecutar` y ejecutarla (son solo SELECT). Esperado: filas = 0 en todas salvo flota_vehiculo_acceso (1). (Se excluye tms_planes_viaje.vehiculo_solicitado_perfil_id: apunta a perfiles de costeo, no a vehículos.)
SELECT CONCAT('SELECT ''', c.TABLE_NAME, '.', c.COLUMN_NAME, ''' AS origen, COUNT(*) AS filas FROM `', c.TABLE_NAME, '` WHERE `', c.COLUMN_NAME, '` = 603;') AS ejecutar
FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME <> 'flota_vehiculos' AND c.COLUMN_NAME <> 'vehiculo_solicitado_perfil_id' AND (c.COLUMN_NAME REGEXP 'vehiculo.*_id$' OR c.COLUMN_NAME = 'unidad_recurrente_id' OR c.COLUMN_NAME = 'tc_vehiculo_id' OR c.COLUMN_NAME = 'flota_vehiculo_id')
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;

-- P3b) Lo mismo en UNA sola sentencia: devuelve una celda `ejecutar_todo`; copiar ese texto, pegarlo en la pestaña SQL y ejecutarlo para obtener UNA tabla con todos los conteos.
SELECT GROUP_CONCAT(CONCAT('SELECT ''', c.TABLE_NAME, '.', c.COLUMN_NAME, ''' AS origen, COUNT(*) AS filas FROM `', c.TABLE_NAME, '` WHERE `', c.COLUMN_NAME, '` = 603') ORDER BY c.TABLE_NAME, c.COLUMN_NAME SEPARATOR ' UNION ALL ') AS ejecutar_todo
FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME <> 'flota_vehiculos' AND c.COLUMN_NAME <> 'vehiculo_solicitado_perfil_id' AND (c.COLUMN_NAME REGEXP 'vehiculo.*_id$' OR c.COLUMN_NAME = 'unidad_recurrente_id' OR c.COLUMN_NAME = 'tc_vehiculo_id' OR c.COLUMN_NAME = 'flota_vehiculo_id');

-- P4) Referencias dentro de datos JSON (sin clave foránea): asignaciones de combustible CB2 y consumos con instantánea.
SELECT 'flota_cb2_asignaciones (anterior/nuevo)' AS origen, COUNT(*) AS filas FROM flota_cb2_asignaciones WHERE JSON_VALUE(anterior, '$.vehiculoId') = 603 OR JSON_VALUE(anterior, '$.vehiculo_id') = 603 OR JSON_VALUE(nuevo, '$.vehiculoId') = 603 OR JSON_VALUE(nuevo, '$.vehiculo_id') = 603;
SELECT 'flota_cb2_filas (decision)' AS origen, COUNT(*) AS filas FROM flota_cb2_filas WHERE JSON_VALUE(decision, '$.vehiculoId') = 603 OR JSON_VALUE(decision, '$.vehiculo_id') = 603;

-- P5) Disparadores sobre las tablas que tocaría el cambio (ninguno debería bloquear un DELETE de una ficha que no es alias).
SELECT TRIGGER_NAME AS disparador, EVENT_OBJECT_TABLE AS tabla, EVENT_MANIPULATION AS evento, ACTION_TIMING AS momento
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE IN ('flota_vehiculos', 'flota_vehiculo_acceso') ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;

-- P6) Operaciones abiertas o vigentes que bloquearían (esperado: ninguna).
SELECT 'viajes abiertos' AS que, COUNT(*) AS filas FROM flota_viajes WHERE vehiculo_id = 603 AND estado = 'abierto';
SELECT 'planes TMS vigentes por tc_vehiculo_id' AS que, COUNT(*) AS filas FROM tms_planes_viaje WHERE tc_vehiculo_id = 603 AND (estado NOT IN ('Cerrado', 'Cancelado') OR fecha_plan >= CURRENT_DATE);
SELECT 'unidad TMS ligada' AS que, COUNT(*) AS filas FROM tms_unidades WHERE flota_vehiculo_id = 603;

-- P7) Datos descriptivos de #603 que #1297 NO tiene (se conservarían en el respaldo; copiarlos a #1297 sería un cambio aparte que requiere aprobación).
SELECT 'campo' AS campo, 'valor_603' AS valor_603, 'valor_1297' AS valor_1297 FROM DUAL WHERE FALSE
UNION ALL SELECT 'descripcion', a.descripcion, b.descripcion FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.descripcion <=> b.descripcion)
UNION ALL SELECT 'color', a.color, b.color FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.color <=> b.color)
UNION ALL SELECT 'km_actual', a.km_actual, b.km_actual FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.km_actual <=> b.km_actual)
UNION ALL SELECT 'km_intervalo_servicio', a.km_intervalo_servicio, b.km_intervalo_servicio FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.km_intervalo_servicio <=> b.km_intervalo_servicio)
UNION ALL SELECT 'rin_llanta', a.rin_llanta, b.rin_llanta FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.rin_llanta <=> b.rin_llanta)
UNION ALL SELECT 'medida_llanta', a.medida_llanta, b.medida_llanta FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.medida_llanta <=> b.medida_llanta)
UNION ALL SELECT 'tipo_aceite', a.tipo_aceite, b.tipo_aceite FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.tipo_aceite <=> b.tipo_aceite)
UNION ALL SELECT 'notas', a.notas, b.notas FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.notas <=> b.notas)
UNION ALL SELECT 'filtro_servicio_mayor', a.filtro_servicio_mayor, b.filtro_servicio_mayor FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.filtro_servicio_mayor <=> b.filtro_servicio_mayor)
UNION ALL SELECT 'filtro_servicio_menor', a.filtro_servicio_menor, b.filtro_servicio_menor FROM flota_vehiculos a, flota_vehiculos b WHERE a.id = 603 AND b.id = 1297 AND NOT (a.filtro_servicio_menor <=> b.filtro_servicio_menor);
