-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — piloto EXTRA por viaje: tabla tms_plan_pilotos_adicionales
-- Archivo: sql/preflight-2026-09-tms-plan-pilotos-adicionales.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de sql/migrate-2026-09-tms-plan-pilotos-adicionales.sql.
-- La migración solo CREA una tabla nueva: no toca tms_planes_viaje.piloto_id (sigue siendo el piloto PRINCIPAL) ni ninguna otra tabla.
-- =====================================================================

-- 1) Entorno y estado actual (informativo; detecta una ejecución previa)
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_pilotos_adicionales') AS tabla_nueva_existe,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje') AS tms_planes_viaje_existe,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_personal') AS tms_personal_existe,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas') AS empresas_existe;

-- 2) Tipos de las columnas a referenciar (las FK exigen el MISMO tipo: INT con signo, PRIMARY KEY)
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'tms_planes_viaje' AND COLUMN_NAME = 'id')
    OR (TABLE_NAME = 'tms_personal'     AND COLUMN_NAME = 'id')
    OR (TABLE_NAME = 'empresas'         AND COLUMN_NAME = 'id'));

-- 3) Motor y colación de las tablas referenciadas (la nueva tabla usa InnoDB / utf8mb4)
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tms_planes_viaje', 'tms_personal', 'tms_plan_auxiliares', 'tms_viaticos', 'empresas');

-- 4) Referencia: la tabla hermana de auxiliares (para comparar estructura e índices)
SHOW CREATE TABLE tms_plan_auxiliares;

-- 5) Volumen de referencia (no bloqueante)
SELECT (SELECT COUNT(*) FROM tms_planes_viaje) AS planes,
       (SELECT COUNT(*) FROM tms_plan_auxiliares) AS filas_auxiliares,
       (SELECT COUNT(*) FROM tms_personal WHERE tipo = 'Piloto' AND estado = 'Activo') AS pilotos_activos;

-- =====================================================================
-- CRITERIO: tabla_nueva_existe = 0, las 4 tablas de referencia existen y los `id` son INT (sin UNSIGNED) con PRIMARY KEY
-- -> se puede ejecutar la migración. Si tabla_nueva_existe = 1 (ejecución previa), la migración es idempotente (IF NOT EXISTS) y
-- solo verifica.
-- ORDEN DE DESPLIEGUE: la migración solo CREA una tabla nueva, por lo que es compatible con la app anterior: ejecutarla ANTES del
-- merge/deploy (la app nueva consulta esta tabla en los cálculos de disponibilidad).
-- =====================================================================
