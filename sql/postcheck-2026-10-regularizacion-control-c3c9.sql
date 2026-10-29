-- Solo lectura; también tras reejecutar la migración. No presupone tablas vacías.
SELECT 'tablas_c3c9_innodb' control,2-COUNT(*) errores FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND ENGINE='InnoDB' AND TABLE_NAME IN ('cont_asientos_origen','cont_regularizacion_borradores');
SELECT 'columnas_c3c9' control,23-COUNT(*) errores FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND
 ((TABLE_NAME='cont_asientos_origen' AND COLUMN_NAME IN ('empresa_id','entidad_id','asiento_id','ejercicio_id','clase','fuente','referencia','huella_asiento','registrado_por','creado_en')) OR
 (TABLE_NAME='cont_regularizacion_borradores' AND COLUMN_NAME IN ('id','empresa_id','entidad_id','ejercicio_id','version','estado','clave_idempotencia','huella_solicitud','huella_condiciones','politica_json','nota','creado_por','creado_en')));
SELECT 'restricciones_c3c9' control,7-COUNT(*) errores FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('cont_asientos_origen','cont_regularizacion_borradores') AND CONSTRAINT_NAME IN ('fk_c9_origen_asiento','fk_c9_origen_ejercicio','fk_c9_origen_usuario','ck_c9_origen','fk_c9_borrador_ejercicio','fk_c9_borrador_usuario','ck_c9_borrador');
SELECT 'unicidad_c3c9' control,3-COUNT(*) errores FROM (
 SELECT TABLE_NAME t,INDEX_NAME n,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND NON_UNIQUE=0 AND TABLE_NAME IN ('cont_asientos_origen','cont_regularizacion_borradores') GROUP BY TABLE_NAME,INDEX_NAME
) i WHERE (t='cont_asientos_origen' AND n='uq_c9_origen_referencia' AND cols='empresa_id,entidad_id,fuente,referencia') OR
 (t='cont_regularizacion_borradores' AND n='uq_c9_borrador_version' AND cols='empresa_id,entidad_id,ejercicio_id,version') OR
 (t='cont_regularizacion_borradores' AND n='uq_c9_borrador_clave' AND cols='empresa_id,entidad_id,clave_idempotencia');
