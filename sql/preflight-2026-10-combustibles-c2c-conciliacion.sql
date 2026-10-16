-- C-2C — PREFLIGHT (SOLO LECTURA). NO ejecutado por la rama. Revisar TODO antes de aplicar migrate-2026-10-combustibles-c2c-conciliacion.sql.
-- DETENER si algo no es lo esperado.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor,
       VERSION() LIKE '11.8.%MariaDB%' AS es_mariadb_11_8;
-- C-2B debe estar FINAL (columnas de importacion presentes) y las tablas ser InnoDB.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('flota_combustible_conciliaciones','flota_combustible_conciliacion_filas','flota_combustible_cargas','usuarios','empresas');
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_conciliacion_filas'
   AND COLUMN_NAME IN ('hoja_origen','estado_parseo','datos_importacion','fingerprint','duplicado_de_linea_id','carga_combustible_id');
-- Esperado: 6 filas. Menos = C-2B no esta aplicado: DETENER.
-- Ya existen las columnas de C-2C? (0 = limpio; 8 = ya aplicado; otro valor = parcial/divergente: DETENER).
SELECT COUNT(*) AS columnas_c2c_presentes FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_conciliacion_filas'
   AND COLUMN_NAME IN ('estado_c2c','modo_c2c','carga_vinculada_id','carga_sugerida_id','diferencias_c2c','calculado_en','confirmado_por_usuario_id','confirmado_en');
-- Tipos de las claves referenciadas (deben ser INT con signo, NOT NULL).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME='flota_combustible_cargas' AND COLUMN_NAME='id') OR (TABLE_NAME='usuarios' AND COLUMN_NAME='id'));
-- Datos existentes: las columnas nuevas nacen NULL, el UNIQUE nuevo no toca nada. Filas C-2B y su estado actual.
SELECT COUNT(*) AS filas_c2b, SUM(f.estado='DESCARTADA') AS con_estado_legacy_descartada, SUM(f.carga_combustible_id IS NOT NULL) AS con_carga_legacy
  FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_conciliaciones c ON c.empresa_id=f.empresa_id AND c.id=f.conciliacion_id
 WHERE c.perfil_parser = 'HALEL';
-- Orfandad: cargas referenciadas por filas legacy que ya no existen (informativo).
SELECT COUNT(*) AS cargas_legacy_huerfanas FROM flota_combustible_conciliacion_filas f
  LEFT JOIN flota_combustible_cargas c ON c.id = f.carga_combustible_id WHERE f.carga_combustible_id IS NOT NULL AND c.id IS NULL;
-- Un vale legacy conciliado muchas veces es NORMAL en la conciliacion historica: por eso C-2C NO reutiliza carga_combustible_id (no admite UNIQUE).
SELECT COUNT(*) AS cargas_con_mas_de_una_fila_legacy FROM (SELECT carga_combustible_id FROM flota_combustible_conciliacion_filas WHERE carga_combustible_id IS NOT NULL GROUP BY carga_combustible_id HAVING COUNT(*) > 1) x;
