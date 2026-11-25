-- Solo lectura. Úsese tras un error de ejecutar-simplificacion-controlado.mjs. No reintentar sin este diagnóstico ni sin respaldo restaurable.
-- Un resultado vacío no prueba ausencia si la cuenta no tiene visibilidad.
SELECT DATABASE() AS base, VERSION() AS version;
-- 1) Qué pasos del DDL llegaron a aplicarse (cada fila = 1 paso; esperado al terminar: los 5 en 'presente').
SELECT 'paso 1: tabla canecas_secuencias' AS paso, IF(COUNT(*)=1,'presente','ausente') AS estado FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias'
UNION ALL SELECT 'paso 2: columna canecas_ventas.direccion_entrega', IF(COUNT(*)=1,'presente','ausente') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega'
UNION ALL SELECT 'paso 2: check chk_can_venta_direccion', IF(COUNT(*)=1,'presente','ausente') FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND CONSTRAINT_NAME='chk_can_venta_direccion'
UNION ALL SELECT 'paso 3: columna canecas_productos.activo_unico', IF(COUNT(*)=1,'presente','ausente') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico'
UNION ALL SELECT 'paso 3: índice uq_can_producto_activo_unico', IF(COUNT(*)>0,'presente','ausente') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND INDEX_NAME='uq_can_producto_activo_unico'
UNION ALL SELECT 'paso 4: trigger actualizado (protege direccion_entrega)', IF(COUNT(*)=1,'presente','ausente') FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_can_venta_bu' AND ACTION_STATEMENT LIKE '%direccion_entrega%';
-- 2) Triggers de ventas: deben existir SIEMPRE los dos (bu y bd). CREATE OR REPLACE es atómico; si falta alguno, restaurar desde sql/migrate-2026-11-canecas-ventas-wip.sql.
SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='canecas_ventas' ORDER BY TRIGGER_NAME;
-- 3) Estructura de lo nuevo.
SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='canecas_secuencias') OR (TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega') OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')) ORDER BY TABLE_NAME,ORDINAL_POSITION;
-- 4) Integridad de datos (no debe cambiar respecto del preflight): recuentos.
SELECT (SELECT COUNT(*) FROM canecas_ventas) AS ventas, (SELECT COUNT(*) FROM canecas_productos) AS productos, (SELECT COUNT(*) FROM canecas_compras) AS compras;
--
-- RECUPERACIÓN (SOLO con autorización expresa, respaldo verificado y escrituras de Canecas detenidas; MariaDB no revierte DDL):
--   Caso A (ningún paso aplicado): no hay nada que revertir; corregir la causa y reintentar el instalador.
--   Caso B (instalación parcial): completar o revertir manualmente EN ESTE ORDEN, revisando cada paso con el diagnóstico anterior:
--     reversión (únicamente si aún no hay compras/ventas nuevas que dependan de lo agregado):
--       paso 4: restaurar el trigger anterior con el CREATE OR REPLACE TRIGGER trg_can_venta_bu de sql/migrate-2026-11-canecas-ventas-wip.sql
--       paso 3: ALTER TABLE canecas_productos DROP INDEX uq_can_producto_activo_unico, DROP COLUMN activo_unico;
--       paso 2: ALTER TABLE canecas_ventas DROP CONSTRAINT chk_can_venta_direccion, DROP COLUMN direccion_entrega;   (solo si ninguna venta nueva tiene dirección)
--       paso 1: DROP TABLE canecas_secuencias;   (solo si está vacía o sus números no se usan en registros)
--   Caso C (instalación completa con datos nuevos): NO revertir; el código antiguo de ventas sigue funcionando sin dirección.
--   En cualquier caso, comprobar al final con sql/postcheck-2026-11-canecas-simplificacion-wip.sql o con el estado anterior verificado por contrato.
