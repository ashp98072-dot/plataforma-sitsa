-- Solo lectura. Cada SELECT devuelve una fila (verificacion, resultado); cualquier 'DETENER' impide instalar.
-- Lo ejecuta ejecutar-simplificacion-controlado.mjs antes del DDL; también puede ejecutarse a mano.
SELECT 'version 11.8.9' AS verificacion, IF(VERSION() LIKE '11.8.9-MariaDB%', 'OK', 'DETENER') AS resultado;
SELECT 'canecas_ventas, canecas_productos y empresas existen' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_productos','empresas'))=3, 'OK', 'DETENER') AS resultado;
SELECT 'canecas_secuencias no existe' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias')=0, 'OK', 'DETENER') AS resultado;
SELECT 'direccion_entrega no existe' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega')=0, 'OK', 'DETENER') AS resultado;
SELECT 'chk_can_venta_direccion no existe' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND CONSTRAINT_NAME='chk_can_venta_direccion')=0, 'OK', 'DETENER') AS resultado;
SELECT 'activo_unico no existe' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=0, 'OK', 'DETENER') AS resultado;
SELECT 'uq_can_producto_activo_unico no existe' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND INDEX_NAME='uq_can_producto_activo_unico')=0, 'OK', 'DETENER') AS resultado;
SELECT 'triggers de ventas anteriores presentes' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd'))=2, 'OK', 'DETENER') AS resultado;
SELECT 'trigger de actualización aún sin direccion_entrega' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_can_venta_bu' AND ACTION_STATEMENT LIKE '%direccion_entrega%')=0, 'OK', 'DETENER') AS resultado;
-- El índice único exige a lo sumo una caneca activa por empresa. Si hay empresas con varias activas, resolverlo antes (decisión de negocio).
SELECT 'ninguna empresa con más de una caneca activa' AS verificacion, IF((SELECT COUNT(*) FROM (SELECT empresa_id FROM canecas_productos WHERE activo=1 GROUP BY empresa_id HAVING COUNT(*)>1) t)=0, 'OK', 'DETENER') AS resultado;
-- Informativo: filas existentes que la migración NO modifica (se comparan de nuevo tras instalar).
SELECT 'recuento canecas_ventas' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM canecas_ventas;
SELECT 'recuento canecas_productos' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM canecas_productos;
