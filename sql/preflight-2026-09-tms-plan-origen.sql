-- TMS-PROGRAMACION-LOTE-1 (PR A) — PREFLIGHT (SOLO LECTURA; NO ejecutado por este PR).
-- Verifica dependencias de sql/migrate-2026-09-tms-plan-origen.sql. Ejecutar completo.
SET @po_schema = 'u611730801_Plataforma';
SELECT VERSION() AS version_servidor, @po_schema AS base_destino, DATABASE() AS contexto_activo;

-- 1) Dependencias: InnoDB, id INT no unsigned.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @po_schema AND TABLE_NAME IN ('empresas', 'tms_planes_viaje');
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @po_schema AND COLUMN_NAME = 'id' AND TABLE_NAME IN ('empresas', 'tms_planes_viaje');

-- 2) ¿Ya existe la tabla nueva? (0 filas = APLICAR; 1 fila = ya aplicada, la migración es NOOP).
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = @po_schema AND TABLE_NAME = 'tms_plan_origen';

-- 3) Decisión.
SELECT CASE WHEN
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @po_schema
     AND TABLE_NAME IN ('empresas', 'tms_planes_viaje') AND ENGINE = 'InnoDB') = 2
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @po_schema
     AND TABLE_NAME IN ('empresas', 'tms_planes_viaje') AND COLUMN_NAME = 'id'
     AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%') = 2
  THEN 'OK' ELSE 'DETENER' END AS decision;
