-- Propuesta de ensayo: solo lectura. Cada control errores=0; no basta ejecutar SELECT.
SELECT 'destino_aislado' control, IF(DATABASE() REGEXP '^c3c1_lab_[a-f0-9]{32}$',0,1) errores;
SELECT 'motor' control, IF((VERSION() LIKE '11.8.%' AND VERSION() LIKE '%MariaDB%') OR (VERSION() LIKE '8.0.%' AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(),'-',1),'.',-1) AS UNSIGNED)>=16),0,1) errores;
SELECT 'fk' control, IF(@@foreign_key_checks=1,0,1) errores;
SELECT 'padres' control, 8-COUNT(*) errores FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN('empresas','usuarios','usuario_empresa','usuario_modulo','cont_entidades','auditoria','cont_asientos','cont_asiento_detalle') AND ENGINE='InnoDB';
SELECT 'cuentas' control, 1-COUNT(*) errores FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas' AND ENGINE='InnoDB';
SELECT 'control_ausente' control, COUNT(*) errores FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN('cont_control_libro','cont_periodos_operadores','cont_control_diagnosticos','cont_periodos_solicitudes','cont_periodos_historial','cont_periodos_cierres');
SELECT 'calendario_c3c1' control, 2-COUNT(*) errores FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN('cont_ejercicios','cont_periodos') AND ENGINE='InnoDB';
SELECT 'version_ausente' control, COUNT(*) errores FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_periodos' AND COLUMN_NAME IN('version','revision_cierre');
SELECT 'sin_estados_anticipados' control, COUNT(*) errores FROM cont_periodos WHERE estado<>'CONFIGURADO';
