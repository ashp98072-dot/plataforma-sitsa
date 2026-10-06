-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — SOLICITUDES DE FONDO / GASTOS: VEHICULOS COMPARTIDOS
-- Para revisar ANTES de aplicar sql/migrate-2026-10-fondos-vehiculos-compartidos.sql.
-- No ejecutado por Claude. Solo SELECT / SHOW: no modifica nada.
-- =====================================================================

-- 1) Foreign keys vigentes sobre vehiculo_id. Antes de migrar se espera la compuesta fk_*_vehiculo_ambito;
--    si ya existe fk_gasto_vehiculo / fk_fondolin_vehiculo la migracion es no-op.
SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME,
       GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS columnas,
       kcu.REFERENCED_TABLE_NAME,
       GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS columnas_ref
FROM information_schema.KEY_COLUMN_USAGE kcu
WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
  AND kcu.TABLE_NAME IN ('tms_gastos_operativos', 'tms_solicitud_fondo_lineas')
  AND kcu.REFERENCED_TABLE_NAME = 'flota_vehiculos'
GROUP BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.REFERENCED_TABLE_NAME;

-- 2) Filas con vehiculo_id que NO existe en flota_vehiculos (esperado: 0 en ambas; hoy rige la FK compuesta).
--    La FK simple nueva fallaria si hubiera huerfanos.
SELECT 'tms_gastos_operativos' AS tabla, COUNT(*) AS huerfanos
FROM tms_gastos_operativos g
LEFT JOIN flota_vehiculos v ON v.id = g.vehiculo_id
WHERE g.vehiculo_id IS NOT NULL AND v.id IS NULL
UNION ALL
SELECT 'tms_solicitud_fondo_lineas', COUNT(*)
FROM tms_solicitud_fondo_lineas l
LEFT JOIN flota_vehiculos v ON v.id = l.vehiculo_id
WHERE l.vehiculo_id IS NOT NULL AND v.id IS NULL;

-- 3) Referencias a vehiculos de OTRA empresa (esperado: 0 antes de migrar, porque la FK compuesta lo impide;
--    despues del despliegue apareceran solo las que pasaron por flota_vehiculo_acceso).
SELECT 'tms_gastos_operativos' AS tabla, COUNT(*) AS filas_vehiculo_de_otra_empresa
FROM tms_gastos_operativos g JOIN flota_vehiculos v ON v.id = g.vehiculo_id AND v.empresa_id <> g.empresa_id
UNION ALL
SELECT 'tms_solicitud_fondo_lineas', COUNT(*)
FROM tms_solicitud_fondo_lineas l JOIN flota_vehiculos v ON v.id = l.vehiculo_id AND v.empresa_id <> l.empresa_id;

-- 4) Unidades compartidas hoy (referencia para la prueba manual: p. ej. C-091BXF de Frescofresh con Monaco).
SELECT v.id, v.placa, ed.nombre AS empresa_duena, ea.nombre AS compartida_con
FROM flota_vehiculo_acceso a
JOIN flota_vehiculos v ON v.id = a.vehiculo_id
JOIN empresas ed ON ed.id = v.empresa_id
JOIN empresas ea ON ea.id = a.empresa_id
ORDER BY v.placa, ea.nombre;

-- 5) Indices disponibles (la FK simple necesita un indice cuya primera columna sea vehiculo_id).
SHOW INDEX FROM tms_gastos_operativos WHERE Column_name = 'vehiculo_id';
SHOW INDEX FROM tms_solicitud_fondo_lineas WHERE Column_name = 'vehiculo_id';
