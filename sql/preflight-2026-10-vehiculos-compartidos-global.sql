-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — VEHICULOS COMPARTIDOS EN TODOS LOS MODULOS OPERATIVOS
-- Se uso ANTES de aplicar sql/migrate-2026-10-vehiculos-compartidos-global.sql (ya aplicada en produccion el 2026-10-06;
-- resultado del preflight: 0 huerfanos, 0 referencias cruzadas, FK compuesta antigua confirmada).
-- No ejecutado por Claude. Solo SELECT / SHOW: no modifica nada.
-- (tms_gastos_operativos y tms_solicitud_fondo_lineas ya se migraron con
--  sql/migrate-2026-10-fondos-vehiculos-compartidos.sql: no se tocan aqui.)
-- =====================================================================

-- 1) TODAS las foreign keys que apuntan a flota_vehiculos, con sus columnas.
--    Clasificacion esperada:
--      * compuestas (empresa_id, vehiculo_id) -> flota_vehiculos(empresa_id, id):
--          compras_requerimiento_lineas.fk_cb_requerimiento_lineas_vehiculo  -> CAMBIA (esta migracion)
--          ops_multas_revisiones.fk_omr_vehiculo                              -> NO CAMBIA (Multas es solo de la empresa propietaria)
--      * simples (vehiculo_id -> flota_vehiculos(id)): ya aceptan unidades compartidas.
SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME,
       GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS columnas,
       GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS columnas_ref,
       IF(COUNT(*) > 1, 'COMPUESTA (impide compartidas)', 'simple') AS tipo
FROM information_schema.KEY_COLUMN_USAGE kcu
WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
  AND kcu.REFERENCED_TABLE_NAME = 'flota_vehiculos'
GROUP BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME
ORDER BY tipo DESC, kcu.TABLE_NAME;

-- 2) Estado actual de la tabla a migrar.
SHOW CREATE TABLE compras_requerimiento_lineas;
SHOW INDEX FROM compras_requerimiento_lineas WHERE Column_name = 'vehiculo_id';

-- 3) Integridad: lineas con vehiculo_id que NO existe en flota_vehiculos (esperado 0; la FK simple nueva fallaria con huerfanos).
SELECT COUNT(*) AS huerfanos
FROM compras_requerimiento_lineas l
LEFT JOIN flota_vehiculos v ON v.id = l.vehiculo_id
WHERE l.vehiculo_id IS NOT NULL AND v.id IS NULL;

-- 4) Lineas que ya referencian un vehiculo de OTRA empresa (esperado 0 antes de migrar: la FK compuesta lo impide).
SELECT COUNT(*) AS lineas_con_vehiculo_de_otra_empresa
FROM compras_requerimiento_lineas l
JOIN flota_vehiculos v ON v.id = l.vehiculo_id AND v.empresa_id <> l.empresa_id;

-- 5) Unidades compartidas hoy (referencia para la prueba manual: p. ej. C-091BXF de Frescofresh con Monaco).
SELECT v.id, v.placa, ed.nombre AS empresa_duena, ea.nombre AS compartida_con
FROM flota_vehiculo_acceso a
JOIN flota_vehiculos v ON v.id = a.vehiculo_id
JOIN empresas ed ON ed.id = v.empresa_id
JOIN empresas ea ON ea.id = a.empresa_id
ORDER BY v.placa, ea.nombre;
