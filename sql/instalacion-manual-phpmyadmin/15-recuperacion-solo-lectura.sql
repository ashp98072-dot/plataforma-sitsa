-- RECUPERACION (solo lectura): estado por etapa de la instalacion manual
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- VERIFICACION DE SOLO LECTURA: no modifica nada. Cada fila debe decir OK (o ser informativa). Cualquier DETENER: no continuar.
-- Usese tras CUALQUIER error en una etapa de escritura y antes de decidir. Todas las tablas y filtros llevan el esquema explicito: funciona con information_schema seleccionada.
-- Un resultado vacio no prueba ausencia si la cuenta no tiene visibilidad.
--
SELECT 'u611730801_Plataforma' AS base, VERSION() AS version, @@SESSION.sql_mode AS sql_mode, @@SESSION.innodb_strict_mode AS innodb_strict_mode;
-- 1) Estado por etapa (solo information_schema). Esperado al terminar la instalacion: las 6 filas en 'presente'.
SELECT 'etapa 1: tabla canecas_secuencias' AS etapa, IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_secuencias')=1, 'presente', 'ausente') AS estado
UNION ALL SELECT 'etapa 3: canecas_ventas.direccion_entrega + chk_can_venta_direccion + doc_auto + uq_can_venta_doc_auto' AS etapa, IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND INDEX_NAME='uq_can_venta_doc_auto')>0 AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND CONSTRAINT_NAME='chk_can_venta_direccion')=1, 'presente', 'ausente') AS estado
UNION ALL SELECT 'etapa 4: canecas_productos.activo_unico + uq_can_producto_activo_unico' AS etapa, IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND INDEX_NAME='uq_can_producto_activo_unico')>0, 'presente', 'ausente') AS estado
UNION ALL SELECT 'etapa 5: canecas_compras.ref_auto + uq_can_compra_ref_auto' AS etapa, IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras' AND INDEX_NAME='uq_can_compra_ref_auto')>0, 'presente', 'ausente') AS estado
UNION ALL SELECT 'etapa 6: trg_can_venta_bu protege direccion_entrega' AS etapa, IF((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME='trg_can_venta_bu' AND ACTION_STATEMENT LIKE '%direccion_entrega%')=1, 'presente', 'ausente') AS estado;
-- 2) Triggers de ventas: deben existir SIEMPRE los dos (bu y bd). CREATE OR REPLACE es atomico; si falta alguno, restaurar desde sql/migrate-2026-11-canecas-ventas-wip.sql.
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND EVENT_OBJECT_TABLE='canecas_ventas' ORDER BY TRIGGER_NAME;
-- 3) Estructura de lo nuevo.
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND (TABLE_NAME='canecas_secuencias' OR (TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('direccion_entrega','doc_auto')) OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico') OR (TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto')) ORDER BY TABLE_NAME, ORDINAL_POSITION;
-- 4) Integridad de datos (no debe cambiar respecto del preflight): recuentos.
SELECT (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_ventas) AS ventas, (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_productos) AS productos, (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_compras) AS compras;
-- 5) Etapa 2 (contadores): se consulta AL FINAL porque falla con 1146 si la etapa 1 no existe (es lo esperado en ese caso).
SELECT 'etapa 2: filas de canecas_secuencias (esperado: 3 por empresa)' AS etapa, (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_secuencias) AS filas, (SELECT COUNT(*)*3 FROM `u611730801_Plataforma`.empresas) AS esperado;
--
-- RECUPERACION (SOLO con autorizacion expresa, respaldo verificado y escrituras de Canecas detenidas; MariaDB no revierte DDL). Mapa etapa -> reversion, en ORDEN INVERSO:
--   Etapa 6 (trigger): restaurar el trigger anterior con el CREATE OR REPLACE TRIGGER trg_can_venta_bu de sql/migrate-2026-11-canecas-ventas-wip.sql (con `u611730801_Plataforma`. en trigger y tabla y delimitador //).
--   Etapa 5: ALTER TABLE `u611730801_Plataforma`.canecas_compras DROP INDEX uq_can_compra_ref_auto, DROP COLUMN ref_auto;
--   Etapa 4: ALTER TABLE `u611730801_Plataforma`.canecas_productos DROP INDEX uq_can_producto_activo_unico, DROP COLUMN activo_unico;
--   Etapa 3: ALTER TABLE `u611730801_Plataforma`.canecas_ventas DROP INDEX uq_can_venta_doc_auto, DROP COLUMN doc_auto, DROP CONSTRAINT chk_can_venta_direccion, DROP COLUMN direccion_entrega;   (solo si ninguna venta nueva tiene direccion)
--   Etapa 2: no requiere reversion propia (solo inserta en la tabla nueva): se elimina junto con la etapa 1.
--   Etapa 1: DROP TABLE `u611730801_Plataforma`.canecas_secuencias;   (solo si esta vacia o sus numeros no se usan en registros)
-- Cada reversion es DDL y debe ejecutarse como una etapa de escritura: una sentencia por peticion, verificando el estado despues con este mismo archivo.
-- Si falla una etapa 4 o 5 con error 1062 o 1834 es porque hay mas de una caneca activa o documentos duplicados del formato generado: no hay nada que revertir, corrija los datos (decision del propietario) y reintente la etapa.
-- Caso instalacion completa con datos nuevos: NO revertir; el codigo antiguo de ventas sigue funcionando sin direccion.
