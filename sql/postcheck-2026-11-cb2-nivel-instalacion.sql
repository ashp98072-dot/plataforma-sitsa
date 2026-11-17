-- SOLO LECTURA. Postcheck de un paso de la cadena CB2 (terceros → terceros-directos → identidades-independientes → piloto-reportado). Ejecutarlo DESPUÉS de cada migración y comparar con la captura previa.
-- 1) OBLIGATORIO: repetir el detector `sql/preflight-2026-11-cb2-nivel-instalacion.sql` y exigir que `nivel_detectado` sea EXACTAMENTE el nivel esperado del paso recién aplicado (1, 2, 3 o 4). El detector compara la estructura
--    completa por firma SHA-256 (no por nombres ni subcadenas): cualquier `INCONSISTENTE` = detener y auditar.
-- 2) Este archivo es solo una vista complementaria por nombre y motor. Indicar el nivel esperado en la línea siguiente; cada consulta debe devolver CERO filas (excepto las de listado informativo).
SET @nivel_esperado = 1;   -- ← cambiar a 1, 2, 3 o 4 según el paso aplicado

SELECT e.nivel_minimo, e.tipo, e.nombre, 'FALTA_RESTRICCION' AS problema FROM (
 SELECT 1 nivel_minimo,'FOREIGN KEY' tipo,'fk_cb2c_externo' nombre
 UNION ALL SELECT 2,'FOREIGN KEY','fk_cb2c_piloto_directo' UNION ALL SELECT 2,'FOREIGN KEY','fk_cb2c_unidad_directa'
 UNION ALL SELECT 1,'CHECK','ck_cb2c_unidad_tipo' UNION ALL SELECT 3,'CHECK','ck_cb2_piloto_unico' UNION ALL SELECT 4,'CHECK','ck_cb2_piloto_reportado'
) e WHERE e.nivel_minimo <= @nivel_esperado
 AND NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS c WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND c.TABLE_NAME='flota_cb2_consumos' AND c.CONSTRAINT_NAME=e.nombre AND c.CONSTRAINT_TYPE=e.tipo);
-- Debe estar ausente lo que corresponde a niveles superiores al esperado (un objeto de un nivel posterior = instalación fuera de orden).
SELECT e.nivel_minimo, e.tipo, e.nombre, 'OBJETO_DE_NIVEL_SUPERIOR_PRESENTE' AS problema FROM (
 SELECT 2 nivel_minimo,'FOREIGN KEY' tipo,'fk_cb2c_piloto_directo' nombre UNION ALL SELECT 2,'FOREIGN KEY','fk_cb2c_unidad_directa'
 UNION ALL SELECT 3,'CHECK','ck_cb2_piloto_unico' UNION ALL SELECT 4,'CHECK','ck_cb2_piloto_reportado'
) e WHERE e.nivel_minimo > @nivel_esperado
 AND EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS c WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND c.TABLE_NAME='flota_cb2_consumos' AND c.CONSTRAINT_NAME=e.nombre AND c.CONSTRAINT_TYPE=e.tipo);
SELECT TABLE_NAME, ENGINE, 'MOTOR_NO_INNODB' AS problema FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_cb2_consumos','flota_cb2_externos_pilotos','flota_cb2_externos_unidades','flota_cb2_externos_asociaciones') AND ENGINE<>'InnoDB';
-- Definición vigente de los CHECK (comparar con la captura previa: solo debe cambiar `ck_cb2c_unidad_tipo` y aparecer el CHECK nuevo del paso).
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME;
-- Conteo de filas de consumos: debe ser IGUAL al anotado antes del paso (ninguna migración de esta cadena modifica ni borra filas).
SELECT COUNT(*) AS filas_consumos FROM flota_cb2_consumos;
