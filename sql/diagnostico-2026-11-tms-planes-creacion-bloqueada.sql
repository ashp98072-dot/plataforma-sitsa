-- DIAGNÓSTICO DE SOLO LECTURA — «no se puede crear un viaje (individual ni copia masiva)» en producción.
-- NO modifica nada (solo SELECT/SHOW). NO ejecutado por esta rama: lo corre el responsable contra la BD de producción (phpMyAdmin → SQL)
-- y comparte TODOS los resultados. Cada bloque dice qué buscar. DETENER ante cualquier hallazgo; no corregir sin revisión independiente.
--
-- Contexto: el alta individual mostraba «No se pudo generar un código de plan único» porque el INSERT de tms_planes_viaje estaba dentro de un
-- `catch {}` que regeneraba el código ante CUALQUIER error SQL (la copia masiva mostraba «No se pudo crear el lote»). Con el código corregido
-- el error SQL real ya no se oculta; estos bloques identifican de qué error se trata SIN ejecutar ningún INSERT.
-- Hipótesis reproducida en MariaDB desechable (src/lib/tms/planes-codigo-unico.db.test.ts): tras sql/migrate-2026-11-flota-fusiones.sql, el
-- procedimiento instalar_guardas_fusion() crea triggers BEFORE INSERT/UPDATE `ffi_*`/`ffu_*` en toda tabla con una columna que cumpla
-- /(^|_)vehiculo(_.*)?_id$/. En tms_planes_viaje alcanza a `vehiculo_solicitado_perfil_id` (FK a tms_cotizacion_costeo_perfiles: es un PERFIL
-- de costeo, NO un vehículo) y la guarda busca ese número en flota_vehiculos: si coincide con el ID de un vehículo fusionado, el INSERT falla con
-- SQLSTATE 45000 «Seleccione la unidad principal: ID fusionado». Los bloques 5 y 7 confirman o descartan esta hipótesis. Ningún objeto de CB2
-- (flota_cb2_*) referencia ni tiene triggers sobre tms_planes_viaje en las migraciones del repositorio: el bloque 9 lo comprueba en producción.

-- 0) Motor, modo SQL y aislamiento (un modo estricto distinto, o una versión distinta, cambia errores de CHECK/FK/longitud).
SELECT VERSION() AS version, DATABASE() AS esquema, @@sql_mode AS sql_mode, @@character_set_database AS charset_bd, @@collation_database AS collation_bd;
SHOW VARIABLES LIKE '%isolation%';

-- 1) Columnas que usan los 4 INSERT de tms_planes_viaje (alta individual, copia masiva, importación Excel, solicitud de cliente): 39 en total.
--    Esperado: 39 filas. MENOS de 39 = columna ausente → «Unknown column» en el alta (esquema desactualizado, migración sin aplicar).
SELECT COUNT(*) AS columnas_presentes_de_39
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje'
   AND COLUMN_NAME IN ('empresa_id','codigo','cliente_id','lugar_carga_id','lugar_descarga_id','unidad_id','piloto_id','auxiliar_id','fecha_plan','hora_carga',
     'tipo_traslado','regreso_estimado','tarifa_comercial','tarifa_id','tarifa_nombre_historico','tarifa_monto_historico','tarifa_moneda_historico',
     'costo_operativo_referencia','referencia_cliente','ruta_id','ruta_codigo_historico','lugar_descarga_historico','contacto_nombre_historico',
     'contacto_cargo_historico','contacto_telefono_historico','notas','estado','tipo_viaje','piloto_externo_nombre','auxiliares_externos',
     'unidad_externa_placa','unidad_externa_descripcion','transportista_externo','costo_tercerizado','tc_vehiculo_id','tc_placa_historica',
     'tc_externo_placa','vehiculo_solicitado_perfil_id','vehiculo_solicitado_nombre');
-- Detalle de TODAS las columnas (comparar con sql/schema.sql; NOT NULL sin valor por defecto solo deben ser empresa_id, codigo y fecha_plan):
SELECT ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje' ORDER BY ORDINAL_POSITION;

-- 2) Índices. Esperado: UNIQUE uq_plan (empresa_id, codigo) y UNIQUE uq_tmsplanes_empresa_id (empresa_id, id). El código de la aplicación
--    SOLO reintenta ante una colisión del índice `uq_plan`; si en producción se llamara distinto, indicarlo (hay respaldo por valor duplicado).
SHOW INDEX FROM tms_planes_viaje;
SELECT AUTO_INCREMENT AS proximo_id, TABLE_ROWS AS filas_aprox, ENGINE, ROW_FORMAT, TABLE_COLLATION
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje';

-- 3) Restricciones: FKs y CHECKs de tms_planes_viaje.
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME,
       GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas, GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS referenciadas
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje' AND REFERENCED_TABLE_NAME IS NOT NULL
 GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME;
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje';

-- 4) TRIGGERS de las tablas que toca el alta de un viaje. Una tabla que en sql/schema.sql no tiene triggers y aquí sí los tiene es el sospechoso.
--    En tms_planes_viaje se esperan, tras migrate-2026-11-flota-fusiones.sql, DOS triggers BEFORE INSERT (ffi_*) y DOS BEFORE UPDATE (ffu_*).
SELECT EVENT_OBJECT_TABLE AS tabla, TRIGGER_NAME, EVENT_MANIPULATION AS evento, ACTION_TIMING AS momento, DEFINER, CREATED
  FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA = DATABASE()
   AND EVENT_OBJECT_TABLE IN ('tms_planes_viaje','tms_unidades','tms_lugares','tms_personal','tms_plan_auxiliares','tms_plan_pilotos_adicionales',
                              'tms_plan_cuadrilla','tms_plan_paradas','tms_plan_origen','tms_viaticos','tms_clientes','auditoria')
 ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, TRIGGER_NAME;
-- Cuerpo completo de los triggers de tms_planes_viaje (copiar y compartir):
SELECT TRIGGER_NAME, EVENT_MANIPULATION AS evento, ACTION_STATEMENT
  FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'tms_planes_viaje' ORDER BY TRIGGER_NAME;

-- 5) GUARDAS DE FUSIÓN SOBRE COLUMNAS QUE NO SON VEHÍCULOS (sobre-alcance de instalar_guardas_fusion). Para cada trigger BEFORE INSERT `ffi_*`
--    se extrae la columna que vigila (texto «v.id=NEW.`columna`») y se muestra a qué tabla apunta su FK.
--    HALLAZGO = una fila donde `referencia_fk` NO sea flota_vehiculos (esperado en tms_planes_viaje: vehiculo_solicitado_perfil_id →
--    tms_cotizacion_costeo_perfiles). Esa guarda compara un id de PERFIL con ids de VEHÍCULOS fusionados.
SELECT t.EVENT_OBJECT_TABLE AS tabla, t.TRIGGER_NAME,
       SUBSTRING_INDEX(SUBSTRING_INDEX(t.ACTION_STATEMENT, 'v.id=NEW.`', -1), '`', 1) AS columna_vigilada,
       (SELECT GROUP_CONCAT(DISTINCT k.REFERENCED_TABLE_NAME)
          FROM information_schema.KEY_COLUMN_USAGE k
         WHERE k.TABLE_SCHEMA = t.TRIGGER_SCHEMA AND k.TABLE_NAME = t.EVENT_OBJECT_TABLE AND k.REFERENCED_TABLE_NAME IS NOT NULL
           AND k.COLUMN_NAME = SUBSTRING_INDEX(SUBSTRING_INDEX(t.ACTION_STATEMENT, 'v.id=NEW.`', -1), '`', 1)) AS referencia_fk
  FROM information_schema.TRIGGERS t
 WHERE t.TRIGGER_SCHEMA = DATABASE() AND t.EVENT_MANIPULATION = 'INSERT' AND t.TRIGGER_NAME LIKE 'ffi\_%'
 ORDER BY t.EVENT_OBJECT_TABLE, columna_vigilada;

-- 6) Fusiones registradas (sin los snapshots JSON). Un ID aquí es el ORIGEN fusionado: la guarda rechaza cualquier INSERT que lo referencie.
SELECT COUNT(*) AS total_fusiones FROM flota_vehiculos_fusiones;
SELECT origen_id, destino_id, empresa_id, administrador_id, creado_en FROM flota_vehiculos_fusiones ORDER BY creado_en DESC LIMIT 200;

-- 7) CONFIRMACIÓN DE LA HIPÓTESIS (falso positivo): perfiles de costeo cuyo ID coincide con el ID de un vehículo fusionado. La guarda compara
--    SOLO el número (no mira la empresa ni el tipo de dato): cualquier fila aquí hace fallar TODO alta/copia que use ese perfil como
--    «vehículo solicitado». Esperado en una BD sana: 0 filas. Si hay filas y son los perfiles que usa la operación → causa confirmada.
SELECT f.origen_id AS id_vehiculo_fusionado, f.empresa_id AS empresa_de_la_fusion, p.id AS perfil_id, p.empresa_id AS empresa_del_perfil, p.codigo AS perfil_codigo, p.nombre AS perfil_nombre
  FROM flota_vehiculos_fusiones f JOIN tms_cotizacion_costeo_perfiles p ON p.id = f.origen_id
 ORDER BY f.origen_id, p.empresa_id;
-- Perfiles que sí se están usando en viajes recientes (para cruzar con el bloque anterior):
SELECT vehiculo_solicitado_perfil_id AS perfil_id, COUNT(*) AS viajes, MAX(id) AS ultimo_plan_id
  FROM tms_planes_viaje WHERE vehiculo_solicitado_perfil_id IS NOT NULL GROUP BY vehiculo_solicitado_perfil_id ORDER BY ultimo_plan_id DESC LIMIT 50;

-- 8) Referencias a vehículos fusionados (guardas LEGÍTIMAS: TC y unidad). Una copia masiva desde un día cuyo plan usa un TC fusionado fallará en esa
--    fila hasta elegir la unidad principal; no es el defecto del bloque 5, pero explica fallos parciales.
SELECT p.id AS plan_id, p.codigo, p.fecha_plan, p.tc_vehiculo_id, f.destino_id AS unidad_principal
  FROM tms_planes_viaje p JOIN flota_vehiculos_fusiones f ON f.origen_id = p.tc_vehiculo_id ORDER BY p.id DESC LIMIT 50;
SELECT u.id AS tms_unidad_id, u.placa, u.flota_vehiculo_id, f.destino_id AS unidad_principal
  FROM tms_unidades u JOIN flota_vehiculos_fusiones f ON f.origen_id = u.flota_vehiculo_id ORDER BY u.id DESC LIMIT 50;

-- 9) CB2 y otros módulos: ¿algo referencia a tms_planes_viaje o tiene triggers que lo alcancen? Esperado: ninguna tabla flota_cb2_* aparece como
--    dependiente de tms_planes_viaje y 0 triggers en tablas flota_cb2_*. (No se debe tocar CB2 sin demostrar que causa el fallo.)
SELECT TABLE_NAME AS tabla_dependiente, COLUMN_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'tms_planes_viaje' ORDER BY TABLE_NAME;
SELECT COUNT(*) AS tablas_cb2 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'flota\_cb2\_%';
SELECT EVENT_OBJECT_TABLE AS tabla_cb2, TRIGGER_NAME FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE LIKE 'flota\_cb2\_%';

-- 10) Estado de la instalación de las migraciones de flota (parcial = triggers sin tabla, o procedimiento sin limpiar).
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('flota_vehiculos_fusiones','flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones');
SELECT ROUTINE_NAME, ROUTINE_TYPE, CREATED FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE();
-- Esperado: ninguna rutina `instalar_guardas_fusion` (la migración la elimina al terminar). Una rutina viva = migración interrumpida.

-- 11) Numeración: últimos viajes y cantidad por día reciente (confirma que la generación de códigos no es la causa; hay UNIQUE por empresa).
SELECT id, empresa_id, codigo, fecha_plan, estado, tipo_viaje, tc_vehiculo_id, vehiculo_solicitado_perfil_id FROM tms_planes_viaje ORDER BY id DESC LIMIT 20;
SELECT empresa_id, fecha_plan, COUNT(*) AS viajes, MAX(codigo) AS ultimo_codigo
  FROM tms_planes_viaje WHERE fecha_plan >= CURDATE() - INTERVAL 7 DAY GROUP BY empresa_id, fecha_plan ORDER BY fecha_plan DESC, empresa_id;
-- Candados de traslape retenidos por alguna conexión (el alta usa GET_LOCK('tms_traslape_<empresa>')); NULL = libre.
SELECT e.id AS empresa_id, IS_USED_LOCK(CONCAT('tms_traslape_', e.id)) AS conexion_que_retiene_el_candado FROM empresas e;

-- 12) (Opcional; puede requerir privilegio PROCESS en el hosting) Transacciones y sesiones que retengan bloqueos.
SELECT trx_id, trx_state, trx_started, trx_mysql_thread_id, trx_rows_locked FROM information_schema.INNODB_TRX ORDER BY trx_started LIMIT 50;
