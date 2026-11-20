-- =====================================================================
-- DIAGNÓSTICO DE SOLO LECTURA — estado de la migración v2 de guardas de Flota tras un fallo o una ejecución parcial.
-- Solo SELECT (metadatos de information_schema y lectura de la tabla de respaldo). NO modifica tablas, registros, triggers ni procedimientos,
-- NO ejecuta migración, rollback ni fusiones. Opera sobre DATABASE(): elegir la base antes de ejecutar (en phpMyAdmin, panel izquierdo).
-- Usar el usuario de instalación (visibilidad de todos los triggers). Todas las comparaciones convierten AMBOS lados a
-- `CONVERT(x USING utf8mb4) COLLATE utf8mb4_bin`, así que no depende del cotejo de la base ni de la tabla de respaldo (incidente #1267).
--
-- Cómo usarlo:
--   A) Siempre válido: tablero de metadatos (existencia de la tabla de respaldo, cotejos, procedimientos residuales, guardas).
--   B, C, D) Requieren que la tabla flota_fusion_guardas_v2_respaldo EXISTA (indicador 1 de A = 1). Si no existe, fallan sin cambiar nada: v2 no ha dejado rastro.
-- Compartir los resultados de A y D (y B/C si hay filas) para decidir cómo reanudar.
--
-- Veredictos de D:
--   SIN CAMBIOS ....... respaldo vacío y las 2 guardas siguen presentes (fallo antes de respaldar): reanudar con la REVISIÓN 2 de la migración.
--   PARCIAL SEGURO .... el respaldo coincide con los triggers presentes y cada guarda ausente tiene respaldo: reanudar con la REVISIÓN 2.
--   COMPLETA .......... las 2 guardas ya no existen y están respaldadas: v2 aplicada; ejecutar el postcheck v2.
--   PELIGRO ........... guarda ausente SIN respaldo, o respaldo distinto del trigger vigente: NO reanudar; revisar a mano.
-- =====================================================================

-- A) TABLERO DE METADATOS
SELECT * FROM (
 SELECT 1 AS orden, 'tabla de respaldo flota_fusion_guardas_v2_respaldo existe (1/0)' AS indicador,
  CAST((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo') AS CHAR) AS valor
 UNION ALL SELECT 2, 'cotejo de la tabla de respaldo',
  (SELECT IFNULL(MAX(TABLE_COLLATION),'(no existe)') FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo')
 UNION ALL SELECT 3, 'cotejo por defecto de la base (los procedimientos lo usan)', @@collation_database
 UNION ALL SELECT 4, 'cotejo de la conexión actual', @@collation_connection
 UNION ALL SELECT 5, 'procedimientos de v2 residuales (esperado: ninguno)',
  (SELECT IFNULL(GROUP_CONCAT(ROUTINE_NAME ORDER BY ROUTINE_NAME),'(ninguno)') FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME IN ('respaldar_guarda_v2','retirar_guarda_v2','corregir_guardas_fusion_v2','revertir_guardas_fusion_v2'))
 UNION ALL SELECT 6, 'cotejo (de la base) con el que se crearon esos procedimientos',
  (SELECT IFNULL(GROUP_CONCAT(DISTINCT DATABASE_COLLATION),'(ninguno)') FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME IN ('respaldar_guarda_v2','retirar_guarda_v2','corregir_guardas_fusion_v2','revertir_guardas_fusion_v2'))
 UNION ALL SELECT 7, 'guardas del falso positivo presentes (2 por columna: 2 antes de v2, 0 después)',
  CAST((SELECT COUNT(*) FROM information_schema.TRIGGERS t WHERE t.TRIGGER_SCHEMA=DATABASE() AND (t.TRIGGER_NAME LIKE 'ffi\_%' OR t.TRIGGER_NAME LIKE 'ffu\_%')
    AND EXISTS(SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=t.TRIGGER_SCHEMA AND c.TABLE_NAME=t.EVENT_OBJECT_TABLE
      AND c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' AND c.COLUMN_NAME NOT IN ('vehiculo_id','unidad_recurrente_id')
      AND t.TRIGGER_NAME IN (CONCAT('ffi_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)),CONCAT('ffu_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)))
      AND EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.REFERENCED_TABLE_NAME<>'flota_vehiculos')
      AND NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos'))) AS CHAR)
 UNION ALL SELECT 8, 'guardas ffi_/ffu_ totales (informativo)',
  CAST((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND (TRIGGER_NAME LIKE 'ffi\_%' OR TRIGGER_NAME LIKE 'ffu\_%')) AS CHAR)
 UNION ALL SELECT 9, 'triggers principales de fusiones M1 (esperado 4)',
  CAST((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('flota_fusion_identidad','flota_fusion_inmutable','flota_fusion_no_borrar','flota_fusion_no_reactivar')) AS CHAR)
 UNION ALL SELECT 10, 'versión del servidor', VERSION()
) tablero ORDER BY orden;

-- B) ESTADO DE LAS 2 GUARDAS CONOCIDAS (tms_planes_viaje.vehiculo_solicitado_perfil_id) — requiere la tabla de respaldo
WITH n AS (
 SELECT CONVERT(CONCAT('ffi_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32)) USING utf8mb4) COLLATE utf8mb4_bin AS nombre, 'INSERT' AS evento
 UNION ALL
 SELECT CONVERT(CONCAT('ffu_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32)) USING utf8mb4) COLLATE utf8mb4_bin, 'UPDATE'
)
SELECT n.nombre AS guarda, n.evento,
 (SELECT COUNT(*) FROM information_schema.TRIGGERS t WHERE t.TRIGGER_SCHEMA=DATABASE()
   AND CONVERT(t.TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = n.nombre) AS presente_en_base,
 (SELECT COUNT(*) FROM flota_fusion_guardas_v2_respaldo r
   WHERE CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = n.nombre) AS filas_en_respaldo,
 (SELECT COUNT(*) FROM flota_fusion_guardas_v2_respaldo r JOIN information_schema.TRIGGERS t ON t.TRIGGER_SCHEMA=DATABASE()
   AND CONVERT(t.TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin
   WHERE CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = n.nombre
    AND CONVERT(r.tabla USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.momento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.ACTION_TIMING USING utf8mb4) COLLATE utf8mb4_bin
    AND CONVERT(r.evento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.EVENT_MANIPULATION USING utf8mb4) COLLATE utf8mb4_bin
    AND CHAR_LENGTH(r.accion)=CHAR_LENGTH(t.ACTION_STATEMENT) AND BINARY r.accion=BINARY t.ACTION_STATEMENT) AS respaldo_identico_al_trigger_vigente
FROM n ORDER BY n.evento DESC;

-- C) CONTENIDO DEL RESPALDO (cero filas = no se respaldó nada) — requiere la tabla de respaldo
SELECT id, tabla, campo, trigger_nombre, momento, evento, CHAR_LENGTH(accion) AS longitud_definicion, creado_en
FROM flota_fusion_guardas_v2_respaldo ORDER BY id;

-- D) VEREDICTO — requiere la tabla de respaldo
WITH n AS (
 SELECT CONVERT(CONCAT('ffi_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32)) USING utf8mb4) COLLATE utf8mb4_bin AS nombre
 UNION ALL
 SELECT CONVERT(CONCAT('ffu_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32)) USING utf8mb4) COLLATE utf8mb4_bin
), e AS (
 SELECT n.nombre,
  (SELECT COUNT(*) FROM information_schema.TRIGGERS t WHERE t.TRIGGER_SCHEMA=DATABASE() AND CONVERT(t.TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = n.nombre) AS en_base,
  (SELECT COUNT(*) FROM flota_fusion_guardas_v2_respaldo r WHERE CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = n.nombre) AS en_respaldo,
  (SELECT COUNT(*) FROM flota_fusion_guardas_v2_respaldo r JOIN information_schema.TRIGGERS t ON t.TRIGGER_SCHEMA=DATABASE()
    AND CONVERT(t.TRIGGER_NAME USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin
    WHERE CONVERT(r.trigger_nombre USING utf8mb4) COLLATE utf8mb4_bin = n.nombre
     AND CONVERT(r.tabla USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.EVENT_OBJECT_TABLE USING utf8mb4) COLLATE utf8mb4_bin
     AND CONVERT(r.momento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.ACTION_TIMING USING utf8mb4) COLLATE utf8mb4_bin
     AND CONVERT(r.evento USING utf8mb4) COLLATE utf8mb4_bin = CONVERT(t.EVENT_MANIPULATION USING utf8mb4) COLLATE utf8mb4_bin
     AND CHAR_LENGTH(r.accion)=CHAR_LENGTH(t.ACTION_STATEMENT) AND BINARY r.accion=BINARY t.ACTION_STATEMENT) AS igual
 FROM n
)
SELECT CASE
  WHEN SUM(en_base=0 AND en_respaldo=0) > 0 THEN 'PELIGRO: hay una guarda AUSENTE SIN respaldo. NO reanudar la migración. Recuperar esa guarda con la definición de migrate-2026-11-flota-fusiones.sql y revisar'
  WHEN SUM(en_base=1 AND en_respaldo>0 AND igual=0) > 0 THEN 'PELIGRO: el respaldo es DISTINTO del trigger vigente. NO reanudar. Revisar a mano'
  WHEN SUM(en_base)=2 AND SUM(en_respaldo)=0 THEN 'SIN CAMBIOS: respaldo vacío y las 2 guardas siguen presentes (fallo antes de respaldar). Reanudar con la REVISIÓN 2 de la migración'
  WHEN SUM(en_base)=0 AND SUM(en_respaldo>0)=2 THEN 'COMPLETA: las 2 guardas ya no existen y están respaldadas. v2 aplicada: ejecutar el postcheck v2'
  ELSE 'PARCIAL SEGURO: el respaldo coincide con los triggers presentes y cada guarda ausente tiene respaldo. Reanudar con la REVISIÓN 2 de la migración'
 END AS veredicto,
 SUM(en_base) AS guardas_presentes, SUM(en_respaldo>0) AS guardas_respaldadas, SUM(en_base=0 AND en_respaldo=0) AS ausentes_sin_respaldo
FROM e;
