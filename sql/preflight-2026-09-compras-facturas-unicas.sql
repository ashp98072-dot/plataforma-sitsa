-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — facturas duplicadas en Compras / Requerimientos
-- Archivo: sql/preflight-2026-09-compras-facturas-unicas.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de proponer cualquier índice UNIQUE.
--
-- IDENTIDAD de factura (misma regla que src/lib/compras/factura-compra.ts):
--   empresa_id + proveedor_id + serie normalizada + número normalizado
-- NORMALIZACIÓN: recorta extremos, colapsa espacios internos a UNO y compara sin distinguir mayúsculas
--   (colación utf8mb4_unicode_ci, que además ignora acentos). Guiones y ceros iniciales SON significativos
--   ("A-123" <> "A123", "000458" <> "458"). Serie NULL/vacía = serie vacía. Sin número (NULL o vacío) NO se controla.
-- El estado del requerimiento (Pendiente / Autorizada / Rechazada) NO importa: todas las facturas cuentan.
-- =====================================================================

-- 0) Entorno (informativo)
SELECT VERSION() AS version_bd,
       (SELECT TABLE_COLLATION FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_requerimiento_lineas') AS colacion_lineas;

-- 1) RESUMEN: grupos duplicados (si devuelve filas, HAY que resolverlos manualmente antes de cualquier UNIQUE)
SELECT l.empresa_id,
       l.proveedor_id,
       MAX(l.proveedor_nombre_snapshot) AS proveedor,
       TRIM(REGEXP_REPLACE(COALESCE(l.serie_factura, ''), '[[:space:]]+', ' ')) AS serie_normalizada,
       TRIM(REGEXP_REPLACE(l.numero_factura, '[[:space:]]+', ' '))              AS numero_normalizado,
       COUNT(*) AS cantidad,
       GROUP_CONCAT(CONCAT(r.codigo, ' (línea ', l.id, ', ', r.estado, ')') ORDER BY l.id SEPARATOR ' | ') AS requerimientos_y_lineas
FROM compras_requerimiento_lineas l
INNER JOIN compras_requerimientos r ON r.empresa_id = l.empresa_id AND r.id = l.requerimiento_id
WHERE l.numero_factura IS NOT NULL
  AND TRIM(REGEXP_REPLACE(l.numero_factura, '[[:space:]]+', ' ')) <> ''
GROUP BY l.empresa_id, l.proveedor_id,
         TRIM(REGEXP_REPLACE(COALESCE(l.serie_factura, ''), '[[:space:]]+', ' ')),
         TRIM(REGEXP_REPLACE(l.numero_factura, '[[:space:]]+', ' '))
HAVING COUNT(*) > 1
ORDER BY l.empresa_id, l.proveedor_id, serie_normalizada, numero_normalizado;

-- 2) DETALLE: una fila por línea involucrada en un duplicado (para corregir a mano)
SELECT l.empresa_id, l.proveedor_id, l.proveedor_nombre_snapshot AS proveedor,
       l.serie_factura, l.numero_factura,
       r.id AS requerimiento_id, r.codigo AS requerimiento, r.estado, l.id AS linea_id, DATE_FORMAT(l.fecha, '%Y-%m-%d') AS fecha, l.total
FROM compras_requerimiento_lineas l
INNER JOIN compras_requerimientos r ON r.empresa_id = l.empresa_id AND r.id = l.requerimiento_id
INNER JOIN (
  SELECT empresa_id, proveedor_id,
         TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''), '[[:space:]]+', ' ')) AS s,
         TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' '))              AS n
  FROM compras_requerimiento_lineas
  WHERE numero_factura IS NOT NULL AND TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' ')) <> ''
  GROUP BY empresa_id, proveedor_id,
           TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''), '[[:space:]]+', ' ')),
           TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' '))
  HAVING COUNT(*) > 1
) d ON d.empresa_id = l.empresa_id AND d.proveedor_id = l.proveedor_id
   AND d.s = TRIM(REGEXP_REPLACE(COALESCE(l.serie_factura, ''), '[[:space:]]+', ' '))
   AND d.n = TRIM(REGEXP_REPLACE(l.numero_factura, '[[:space:]]+', ' '))
ORDER BY l.empresa_id, l.proveedor_id, d.s, d.n, l.id;

-- 3) Líneas sin número de factura (INFORMATIVO: no se controlan y quedan permitidas)
SELECT COUNT(*) AS lineas_sin_numero_factura
FROM compras_requerimiento_lineas
WHERE numero_factura IS NULL OR TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' ')) = '';

-- =====================================================================
-- CRITERIO DE DECISIÓN
--   * Si (1) devuelve filas: DETENER. Resolver manualmente cada grupo (anular/corregir la línea equivocada) y repetir el preflight.
--   * Si (1) NO devuelve filas: se puede evaluar la migración, que requiere autorización aparte. PROPUESTA (NO ejecutar, NO es
--     migración todavía):
--       ALTER TABLE compras_requerimiento_lineas
--         ADD COLUMN factura_clave VARCHAR(220)
--           AS (CASE WHEN numero_factura IS NULL OR TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' ')) = '' THEN NULL
--                    ELSE CONCAT(TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''), '[[:space:]]+', ' ')), CHAR(1),
--                                TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' '))) END) PERSISTENT,
--         ADD UNIQUE KEY uq_compras_factura_proveedor (empresa_id, proveedor_id, factura_clave);
--     (varias líneas con factura_clave NULL están permitidas por UNIQUE; la colación utf8mb4_unicode_ci hace la comparación
--      insensible a mayúsculas y acentos, igual que factura-compra.ts). Requiere una columna generada => DETENER y pedir
--      autorización antes de crear sql/migrate-2026-09-compras-facturas-unicas.sql.
-- =====================================================================
