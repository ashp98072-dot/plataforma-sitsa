-- Solo lectura. Un resultado vacío no prueba ausencia si la cuenta no tiene visibilidad.
-- Úsese tras un error del instalador ejecutar-redistribucion-controlado.mjs; no reintentar sin este diagnóstico.
SELECT DATABASE() AS base, VERSION() AS version;
-- 1) Objetos de la migración presentes (esperado: 2 tablas, 2 columnas, 4 triggers y 1 CHECK al terminar).
SELECT 'tablas' AS objeto, TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_redistribuciones','canecas_redistribuciones_origen')
UNION ALL SELECT 'columnas de capas', COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_capas_costo' AND COLUMN_NAME IN ('redistribucion_id','orden_fifo')
UNION ALL SELECT 'triggers', TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('trg_can_redis_bu','trg_can_redis_bd','trg_can_redis_origen_bu','trg_can_redis_origen_bd')
UNION ALL SELECT 'check', CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('chk_can_capa_fuente','chk_can_capa_orden');
-- 2) Cláusula del CHECK de fuente: con la migración aplicada menciona redistribucion_id.
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='canecas_capas_costo' ORDER BY CONSTRAINT_NAME;
-- 3) Definición del trigger de capas: la versión nueva menciona orden_fifo y redistribucion_id.
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('canecas_capas_costo','canecas_redistribuciones','canecas_redistribuciones_origen') ORDER BY TRIGGER_NAME;
-- 4) Estructura de las tablas nuevas y de capas.
SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_redistribuciones','canecas_redistribuciones_origen','canecas_capas_costo') ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_redistribuciones','canecas_redistribuciones_origen','canecas_capas_costo') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
SELECT TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_redistribuciones','canecas_redistribuciones_origen','canecas_capas_costo') AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;
-- 5) Datos (ejecutar solo si las columnas redistribucion_id y orden_fifo existen; si no, estas dos consultas fallan): no debe haber filas con orden_fifo sin redistribución ni capas con más de una fuente.
SELECT COUNT(*) AS capas_con_orden_sin_redistribucion FROM canecas_capas_costo WHERE orden_fifo IS NOT NULL AND redistribucion_id IS NULL;
SELECT COUNT(*) AS capas_con_fuente_invalida FROM canecas_capas_costo WHERE (recepcion_id IS NOT NULL)+(valoracion_id IS NOT NULL)+(redistribucion_id IS NOT NULL)<>1;
