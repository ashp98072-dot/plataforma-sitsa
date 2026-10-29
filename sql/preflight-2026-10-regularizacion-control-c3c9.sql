-- Solo lectura. Detener si cualquier errores es distinto de cero.
SELECT 'dependencias_innodb_c3c1_c3c2_c3c7' control,13-COUNT(*) errores FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND ENGINE='InnoDB' AND TABLE_NAME IN ('usuarios','empresas','usuario_empresa','usuario_modulo','auditoria','cont_entidades','cont_cuentas','cont_asientos','cont_asiento_detalle','cont_ejercicios','cont_periodos','cont_control_libro','cont_cuentas_rol');
SELECT 'permiso_editar_existente' control,1-COUNT(*) errores FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuario_modulo' AND COLUMN_NAME='puede_editar';
SELECT 'rol_resultado_c3c7' control,1-COUNT(*) errores FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_cont_rol_valido' AND CHECK_CLAUSE LIKE '%RESULTADO_EJERCICIO%';
SELECT 'indices_padres_compuestos' control,2-COUNT(DISTINCT t) errores FROM (
 SELECT TABLE_NAME t,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cont_asientos','cont_ejercicios') AND NON_UNIQUE=0 GROUP BY TABLE_NAME,INDEX_NAME
) i WHERE cols='empresa_id,entidad_id,id';
