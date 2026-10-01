-- SOLO LECTURA, compatible con phpMyAdmin sin information_schema.
-- Seleccionar explícitamente la BD del tenant antes de ejecutar.
-- APLICAR: tabla nueva ausente; padres InnoDB; id de los tres padres INT signed;
-- empresa_id de empleados y tms_planes_viaje INT signed; PK id presente.
-- Índices padre UNIQUE BTREE completos (empresa_id, id), en ese orden:
-- empleados: producción uq_multas_empleado_empresa_id;
-- schema.sql usa uq_ruta_personal_empresa_id (nombre distinto, misma clave).
-- tms_planes_viaje: uq_tmsplanes_empresa_id. No crear índices de padres aquí.
-- Confirmar tablas no particionadas y collation TMS utf8mb4_uca1400_ai_ci.
-- foreign_key_checks y check_constraint_checks deben estar ON.
-- En MariaDB 11.8 los nombres de FK son únicos por BD: verificar que
-- fk_tpc_empresa / fk_tpc_plan / fk_tpc_empleado no pertenezcan a otra tabla
-- con SHOW CREATE TABLE de cualquier tabla previamente existente con ese prefijo.
-- Si no se ha comprobado su ausencia, la verificación de nombres queda pendiente;
-- no inferir ausencia global solamente porque tms_plan_cuadrilla no exista.
-- NOOP: tabla existente coincide exactamente con el DDL canónico (columnas,
-- nullability, checks, índices y tres FKs). Comparar SHOW CREATE TABLE.
-- FKs plan/empleado deben ser COMPUESTAS por empresa, no solo por id.
-- Empresa/plan ON DELETE CASCADE; empleado ON DELETE RESTRICT;
-- todas ON UPDATE RESTRICT. ENGINE InnoDB y COLLATE utf8mb4_uca1400_ai_ci.
-- DETENER: padres incompatibles, tabla parcial o cualquier diferencia.
-- No convertir tipos ni recrear tablas para resolver diferencias.
SELECT VERSION(), DATABASE();
SHOW VARIABLES LIKE 'foreign_key_checks';
SHOW VARIABLES LIKE 'check_constraint_checks';
-- UCA puede mostrarse como uca1400_ai_ci con Charset NULL (varios charsets);
-- no declarar DETENER solo porque SHOW no use el prefijo utf8mb4.
SHOW COLLATION WHERE Collation IN ('utf8mb4_uca1400_ai_ci', 'uca1400_ai_ci');
SHOW TABLES LIKE 'tms_plan_cuadrilla';
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE empleados;
SHOW CREATE TABLE tms_planes_viaje;
SHOW INDEX FROM empleados;
SHOW INDEX FROM tms_planes_viaje;
SHOW TABLE STATUS WHERE Name IN ('empresas', 'empleados', 'tms_planes_viaje');
-- Solo si SHOW TABLES devuelve una fila: ejecutar los dos bloques siguientes.
SHOW CREATE TABLE tms_plan_cuadrilla;
SHOW INDEX FROM tms_plan_cuadrilla;
