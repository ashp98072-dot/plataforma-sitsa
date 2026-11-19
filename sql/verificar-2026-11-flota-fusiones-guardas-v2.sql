-- =====================================================================
-- VERIFICACIÓN DE SOLO LECTURA — ¿están instaladas las migraciones SQL de Flota / guardas v2 (PR #647)?
-- Solo SELECT sobre information_schema (no toca datos, no crea ni elimina objetos, no ejecuta migraciones ni rollback).
-- Opera sobre DATABASE(): elegir la base en phpMyAdmin (panel izquierdo) antes de ejecutar. Usar el usuario de instalación para ver TODOS los triggers.
-- Resultado 1: tablero (migración · objeto · esperado · encontrado). Resultado 2: veredicto de v2. Resultado 3: advertencias.
-- La consulta de contenido del respaldo (opcional) está al final: ejecutarla SOLO si el tablero muestra que la tabla de respaldo existe.
--
-- Archivo: sql/verificar-2026-11-flota-fusiones-guardas-v2.sql (verificación previa y posterior; no es migración, preflight ni postcheck).
-- Scripts relacionados (PR #647):  preflight-…-guardas-v2.sql (solo lectura) → migrate-…-guardas-v2.sql → postcheck-…-guardas-v2.sql (solo lectura);
--   deshacer: rollback-…-guardas-v2.sql. Base requerida: migrate-2026-11-flota-fusiones.sql (M1). Documento: docs/flota/consolidacion-vehiculos-lectores-alcance.md.
-- Cómo leerlo: M2 PENDIENTE = M1 instalada, sin respaldo v2 y con las 2 guardas del falso positivo (tms_planes_viaje.vehiculo_solicitado_perfil_id) activas.
-- =====================================================================

-- 1) TABLERO
SELECT * FROM (
 SELECT 1 AS orden, 'M1 fusiones base (migrate-2026-11-flota-fusiones)' AS migracion, 'tabla flota_vehiculos_fusiones' AS objeto, '1' AS esperado,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones') AS encontrado
 UNION ALL SELECT 2, 'M1 fusiones base', 'triggers principales (flota_fusion_identidad / inmutable / no_borrar / no_reactivar)', '4',
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('flota_fusion_identidad','flota_fusion_inmutable','flota_fusion_no_borrar','flota_fusion_no_reactivar'))
 UNION ALL SELECT 3, 'M1 fusiones base', 'guardas ffi_/ffu_ instaladas (2 por columna de vehículo; informativo)', '>0',
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND (TRIGGER_NAME LIKE 'ffi\_%' OR TRIGGER_NAME LIKE 'ffu\_%'))
 UNION ALL SELECT 4, 'M1 fusiones base', 'procedimiento residual instalar_guardas_fusion (instalación interrumpida)', '0',
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME='instalar_guardas_fusion')
 UNION ALL SELECT 5, 'M1 fusiones base', 'fusiones registradas (alias; informativo — v2 NO las modifica)', 'n/a',
  IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones')=0, NULL,
     (SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'))
 UNION ALL SELECT 6, 'M2 guardas v2 (PR #647)', 'tabla de respaldo flota_fusion_guardas_v2_respaldo (1 = v2 aplicada o aplicándose)', '1 tras v2',
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo')
 UNION ALL SELECT 7, 'M2 guardas v2', 'guardas de FALSO POSITIVO aún presentes (columna con nombre de vehículo y FK a otra tabla)', '0 tras v2',
  (SELECT COUNT(*) FROM information_schema.TRIGGERS t WHERE t.TRIGGER_SCHEMA=DATABASE() AND (t.TRIGGER_NAME LIKE 'ffi\_%' OR t.TRIGGER_NAME LIKE 'ffu\_%')
    AND EXISTS(SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=t.TRIGGER_SCHEMA AND c.TABLE_NAME=t.EVENT_OBJECT_TABLE
      AND c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' AND c.COLUMN_NAME NOT IN ('vehiculo_id','unidad_recurrente_id')
      AND t.TRIGGER_NAME IN (CONCAT('ffi_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)),CONCAT('ffu_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)))
      AND EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.REFERENCED_TABLE_NAME<>'flota_vehiculos')
      AND NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos')))
 UNION ALL SELECT 8, 'M2 guardas v2', 'procedimientos auxiliares residuales (respaldar/retirar/corregir/revertir_guarda(s)_v2: ejecución interrumpida)', '0',
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME IN ('respaldar_guarda_v2','retirar_guarda_v2','corregir_guardas_fusion_v2','revertir_guardas_fusion_v2'))
 UNION ALL SELECT 9, 'M3 identidad física (migrate-2026-11-flota-identidad-fisica; opcional)', 'tablas flota_identidades_fisicas / identidad_miembros / identidad_empresas / identidad_aprobaciones', '4 o 0',
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones'))
 UNION ALL SELECT 10, 'M3 identidad física', 'guardas ffi_/ffu_2abd… que la aplicación EXIGE (estadoEsquemaFisico) — v2 no las toca', '2 si M3 instalada',
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('ffi_2abd957034829d58fcc789b21f6ed7e4','ffu_2abd957034829d58fcc789b21f6ed7e4'))
 UNION ALL SELECT 11, 'Soporte (acceso compartido)', 'tabla flota_vehiculo_acceso (la usan las guardas de la aplicación)', '1',
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculo_acceso')
 UNION ALL SELECT 12, 'CB2 terceros (migrate-2026-11-cb2-terceros; lo usa #648 en runtime)', 'tablas flota_cb2_externos_pilotos / unidades / asociaciones', '3',
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_externos_pilotos','flota_cb2_externos_unidades','flota_cb2_externos_asociaciones'))
) tablero ORDER BY orden;

-- 2) VEREDICTO DE v2 (lectura de los indicadores 6, 7 y 8)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones')=0
   THEN 'NO APLICABLE: la migración base de fusiones (M1) no está instalada; v2 depende de ella'
  WHEN (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME IN ('respaldar_guarda_v2','retirar_guarda_v2','corregir_guardas_fusion_v2'))>0
   THEN 'INTERRUMPIDA: quedaron procedimientos auxiliares de v2; revisar antes de reejecutar'
  WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo')=1
   AND (SELECT COUNT(*) FROM information_schema.TRIGGERS t WHERE t.TRIGGER_SCHEMA=DATABASE() AND (t.TRIGGER_NAME LIKE 'ffi\_%' OR t.TRIGGER_NAME LIKE 'ffu\_%')
        AND t.TRIGGER_NAME IN (CONCAT('ffi_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32)),CONCAT('ffu_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32))))=0
   THEN 'APLICADA: respaldo presente y las 2 guardas del falso positivo conocido ya no existen'
  WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo')=1
   THEN 'PARCIAL: hay respaldo pero aún existe alguna guarda del falso positivo; revisar con el postcheck v2'
  WHEN (SELECT COUNT(*) FROM information_schema.TRIGGERS t WHERE t.TRIGGER_SCHEMA=DATABASE()
        AND t.TRIGGER_NAME IN (CONCAT('ffi_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32)),CONCAT('ffu_',LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32))))>0
   THEN 'PENDIENTE: M1 instalada, sin respaldo v2 y con las guardas del falso positivo conocido (tms_planes_viaje.vehiculo_solicitado_perfil_id) activas'
  ELSE 'NO CONCLUYENTE: sin respaldo v2 y sin esas guardas (p. ej. v2 revertida con rollback o la columna no existe); revisar con el postcheck v2'
 END AS veredicto_v2;

-- 3) ADVERTENCIAS (debe devolver 0 filas en un entorno sano)
SELECT 'La aplicación exige las guardas ffi_/ffu_2abd… (identidad física) y faltan' AS advertencia
 WHERE (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones'))=4
   AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('ffi_2abd957034829d58fcc789b21f6ed7e4','ffu_2abd957034829d58fcc789b21f6ed7e4'))<2
UNION ALL
SELECT 'Tablas de identidad física parcialmente instaladas (1 a 3 de 4): la aplicación responde 503'
 WHERE (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones')) BETWEEN 1 AND 3
UNION ALL
SELECT 'Tablas de la fusión que no son InnoDB (las guardas exigen InnoDB)'
 WHERE EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_vehiculos','flota_vehiculos_fusiones') AND ENGINE<>'InnoDB');

-- 4) OPCIONAL — contenido del respaldo (ejecutar SOLO si el indicador 6 del tablero es 1; si la tabla no existe, esta consulta falla sin cambiar nada):
-- SELECT tabla, campo, trigger_nombre, evento, creado_en FROM flota_fusion_guardas_v2_respaldo ORDER BY id;
