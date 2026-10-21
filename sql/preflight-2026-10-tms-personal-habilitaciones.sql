-- SOLO LECTURA, compatible con phpMyAdmin sin information_schema.
-- Seleccionar explícitamente la BD del tenant antes de ejecutar.
-- APLICAR: tabla nueva ausente; padres empresas/empleados InnoDB; empresa_id/empleado_id INT signed; PK id presente.
-- Índice padre UNIQUE BTREE completo (empresa_id, id) en empleados, en ese orden — en producción puede
-- llamarse distinto al nombre de schema.sql (ver preflight-2026-10-tms-plan-cuadrilla.sql, que ya detectó
-- que producción usa uq_multas_empleado_empresa_id donde schema.sql dice uq_ruta_personal_empresa_id):
-- confirmar con SHOW INDEX, nunca asumir el nombre por el nombre documentado en schema.sql.
-- Confirmar tabla no particionada y collation TMS utf8mb4_uca1400_ai_ci (mismo criterio ya usado y
-- confirmado en preflight-2026-10-tms-plan-cuadrilla.sql, la migración aditiva más reciente de este
-- mismo módulo TMS contra el mismo padre `empleados`).
-- foreign_key_checks y check_constraint_checks deben estar ON.
-- En MariaDB 11.8 los nombres de FK/constraint son únicos por BD: verificar que
-- fk_tph_empresa / fk_tph_empleado / chk_tph_rol / chk_tph_estado no pertenezcan a otra tabla
-- (SHOW CREATE TABLE de cualquier tabla previamente existente con ese prefijo "tph").
-- Si no se ha comprobado su ausencia, la verificación de nombres queda pendiente; no inferir
-- ausencia global solamente porque tms_personal_habilitaciones no exista.
-- NOOP: tabla existente coincide exactamente con el DDL canónico (columnas, nullability, checks,
-- índices y las dos FKs). Comparar SHOW CREATE TABLE.
-- FK a empleados debe ser COMPUESTA por empresa, no solo por id (aislamiento multiempresa).
-- empresa_id ON DELETE CASCADE; empleado_id ON DELETE RESTRICT; ambas ON UPDATE RESTRICT.
-- ENGINE InnoDB y COLLATE utf8mb4_uca1400_ai_ci.
-- DETENER: padres incompatibles, tabla parcial o cualquier diferencia respecto al DDL propuesto en
-- migrate-2026-10-tms-personal-habilitaciones.sql. No convertir tipos ni recrear tablas para resolver
-- diferencias.
SELECT VERSION(), DATABASE();
SHOW VARIABLES LIKE 'foreign_key_checks';
SHOW VARIABLES LIKE 'check_constraint_checks';
SHOW COLLATION WHERE Collation IN ('utf8mb4_uca1400_ai_ci', 'uca1400_ai_ci');
SHOW TABLES LIKE 'tms_personal_habilitaciones';
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE empleados;
SHOW INDEX FROM empleados;
SHOW TABLE STATUS WHERE Name IN ('empresas', 'empleados');
-- Confirmar también que tms_personal (catálogo operativo existente, NO se toca) sigue como está —
-- documental, para comparar antes/después de aplicar esta migración aditiva.
SHOW CREATE TABLE tms_personal;
-- Solo si SHOW TABLES (línea de arriba) devuelve una fila para tms_personal_habilitaciones:
-- ejecutar los dos bloques siguientes.
SHOW CREATE TABLE tms_personal_habilitaciones;
SHOW INDEX FROM tms_personal_habilitaciones;
