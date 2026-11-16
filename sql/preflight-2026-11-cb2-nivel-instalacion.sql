-- SOLO LECTURA. Detector del NIVEL de instalación de la cadena CB2 de identidades externas. NO ejecutado en producción: lo ejecuta el operador, con la base ya seleccionada.
-- La cadena (cada paso exige el anterior y NO es idempotente: repetirlo falla por columna/restricción duplicada):
--   nivel 1 = sql/migrate-2026-11-cb2-terceros.sql                   (tablas flota_cb2_externos_* + columnas asociacion_externa_id/identidad_externa + ck_cb2c_unidad_tipo v1)
--   nivel 2 = sql/migrate-2026-11-cb2-terceros-directos.sql          (piloto_externo_id/unidad_externa_id + FK + ck_cb2c_unidad_tipo v2)
--   nivel 3 = sql/migrate-2026-11-cb2-identidades-independientes.sql (ck_cb2_piloto_unico + ck_cb2c_unidad_tipo v3: INDEPENDIENTE_V1)
--   nivel 4 = sql/migrate-2026-11-cb2-piloto-reportado.sql           (ck_cb2_piloto_reportado + ck_cb2c_unidad_tipo v4: REPORTADO_V1 sobre unidad externa)  [OPCIONAL]
-- Resultado 1: una fila con los hechos, el nivel detectado y el siguiente paso. `INCONSISTENTE` = combinación imposible por instalación parcial o manual: DETENER y auditar, no continuar.
-- Resultado 2: prerrequisitos de la cadena y de los vínculos con fondos / tablas Shell (cada columna 1 = presente).
-- Resultado 3: definición vigente de los CHECK de consumos (guardar antes de cualquier ALTER).
SELECT f.t_externos, f.col_asociacion, f.col_directos, f.fk_asociacion, f.fk_directos, f.ck_unico, f.ck_tipo_v3, f.ck_reportado, f.ck_tipo_v4,
 CASE
  WHEN f.t_externos=0 AND f.col_asociacion=0 AND f.col_directos=0 AND f.ck_unico=0 AND f.ck_reportado=0 THEN '0'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=0 AND f.ck_unico=0 AND f.ck_reportado=0 THEN '1'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=2 AND f.fk_directos=2 AND f.ck_unico=0 AND f.ck_reportado=0 THEN '2'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=2 AND f.fk_directos=2 AND f.ck_unico=1 AND f.ck_tipo_v3=1 AND f.ck_reportado=0 THEN '3'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=2 AND f.fk_directos=2 AND f.ck_unico=1 AND f.ck_tipo_v3=1 AND f.ck_reportado=1 AND f.ck_tipo_v4=1 THEN '4'
  ELSE 'INCONSISTENTE' END AS nivel_detectado,
 CASE
  WHEN f.t_externos=0 AND f.col_asociacion=0 AND f.col_directos=0 AND f.ck_unico=0 AND f.ck_reportado=0 THEN 'migrate-2026-11-cb2-terceros.sql'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=0 AND f.ck_unico=0 AND f.ck_reportado=0 THEN 'migrate-2026-11-cb2-terceros-directos.sql'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=2 AND f.fk_directos=2 AND f.ck_unico=0 AND f.ck_reportado=0 THEN 'migrate-2026-11-cb2-identidades-independientes.sql'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=2 AND f.fk_directos=2 AND f.ck_unico=1 AND f.ck_tipo_v3=1 AND f.ck_reportado=0 THEN 'OPCIONAL: migrate-2026-11-cb2-piloto-reportado.sql (nombre reportado sobre unidad externa)'
  WHEN f.t_externos=3 AND f.col_asociacion=2 AND f.fk_asociacion=1 AND f.col_directos=2 AND f.fk_directos=2 AND f.ck_unico=1 AND f.ck_tipo_v3=1 AND f.ck_reportado=1 AND f.ck_tipo_v4=1 THEN 'NINGUNO: cadena completa'
  ELSE 'DETENER Y AUDITAR' END AS siguiente_paso
FROM (SELECT
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_externos_pilotos','flota_cb2_externos_unidades','flota_cb2_externos_asociaciones')) AS t_externos,
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('asociacion_externa_id','identidad_externa')) AS col_asociacion,
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('piloto_externo_id','unidad_externa_id')) AS col_directos,
 (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_TYPE='FOREIGN KEY' AND CONSTRAINT_NAME='fk_cb2c_externo') AS fk_asociacion,
 (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_TYPE='FOREIGN KEY' AND CONSTRAINT_NAME IN ('fk_cb2c_piloto_directo','fk_cb2c_unidad_directa')) AS fk_directos,
 (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_unico') AS ck_unico,
 (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_unidad_tipo' AND CHECK_CLAUSE LIKE '%INDEPENDIENTE\_V1%') AS ck_tipo_v3,
 (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_reportado') AS ck_reportado,
 (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_unidad_tipo' AND CHECK_CLAUSE LIKE '%REPORTADO\_V1%') AS ck_tipo_v4
) f;

-- Resultado 2: prerrequisitos (1 = presente).
SELECT
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND ENGINE='InnoDB') AS consumos_innodb,
 (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND INDEX_NAME='uq_cb2c_ambito' AND NON_UNIQUE=0) AS uq_cb2c_ambito,
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('empleado_id','revision_asignacion','producto_clasificado')) AS cols_asignacion_de_3,
 (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tms_solicitud_fondo_lineas' AND INDEX_NAME='uq_fondolin_c2a_empresa_id' AND NON_UNIQUE=0) AS uq_fondolin_c2a_empresa_id,
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias')) AS tablas_shell_de_3,
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos') AS fondos_vinculos;

-- Resultado 3: definiciones vigentes de CHECK (guardarlas antes de cambiar nada).
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME;
