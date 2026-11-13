-- SOLO SELECT. Propuesta para auditoria, NO ejecutada en produccion.
-- Preflight: cero filas en columnas/motores/faltantes; migraciones nuevas aun NO instaladas.
WITH requeridas AS (
 SELECT 'flota_cb2_consumos' tabla,'empresa_id' columna UNION ALL SELECT 'flota_cb2_consumos','proveedor_id'
 UNION ALL SELECT 'flota_cb2_consumos','id' UNION ALL SELECT 'flota_cb2_consumos','vehiculo_id'
 UNION ALL SELECT 'flota_cb2_consumos','revision_asignacion' UNION ALL SELECT 'flota_cb2_consumos','piloto_externo_id'
 UNION ALL SELECT 'flota_cb2_consumos','unidad_externa_id' UNION ALL SELECT 'flota_cb2_consumos','identidad_externa'
 UNION ALL SELECT 'flota_cb2_consumos','asociacion_externa_id' UNION ALL SELECT 'flota_cb2_consumos','empleado_id'
 UNION ALL SELECT 'flota_cb2_consumos','fecha_consumo' UNION ALL SELECT 'flota_cb2_consumos','piloto_informado'
 UNION ALL SELECT 'flota_cb2_consumos','monto' UNION ALL SELECT 'flota_cb2_consumos','moneda'
 UNION ALL SELECT 'tms_solicitud_fondo_lineas','id' UNION ALL SELECT 'tms_solicitud_fondo_lineas','empresa_id'
 UNION ALL SELECT 'tms_solicitud_fondo_lineas','solicitud_id' UNION ALL SELECT 'tms_solicitud_fondo_lineas','categoria'
 UNION ALL SELECT 'tms_solicitud_fondo_lineas','vehiculo_id' UNION ALL SELECT 'tms_solicitud_fondo_lineas','cantidad'
 UNION ALL SELECT 'tms_solicitud_fondo_lineas','monto' UNION ALL SELECT 'tms_solicitud_fondo_lineas','empleado_nombre'
 UNION ALL SELECT 'tms_solicitud_fondo_lineas','placa' UNION ALL SELECT 'tms_solicitudes_fondo','id'
 UNION ALL SELECT 'tms_solicitudes_fondo','empresa_id' UNION ALL SELECT 'tms_solicitudes_fondo','codigo'
 UNION ALL SELECT 'tms_solicitudes_fondo','estado' UNION ALL SELECT 'tms_solicitudes_fondo','fecha_requerimiento'
 UNION ALL SELECT 'usuarios','id'
)
SELECT r.*,'FALTA_COLUMNA' problema FROM requeridas r LEFT JOIN information_schema.COLUMNS c
 ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.tabla AND c.COLUMN_NAME=r.columna WHERE c.COLUMN_NAME IS NULL;
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN('flota_cb2_consumos','tms_solicitud_fondo_lineas','tms_solicitudes_fondo','usuarios') AND ENGINE<>'InnoDB';
SELECT e.nombre,'FALTA_CHECK_BASE' problema FROM (SELECT 'ck_cb2_piloto_unico' nombre UNION ALL SELECT 'ck_cb2c_unidad_tipo') e
 WHERE NOT EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS c WHERE c.CONSTRAINT_SCHEMA=DATABASE()
 AND c.TABLE_NAME='flota_cb2_consumos' AND c.CONSTRAINT_TYPE='CHECK' AND c.CONSTRAINT_NAME=e.nombre);
-- Guardar definiciones base y comparar posteriormente: solo cambia ck_cb2c_unidad_tipo.
SELECT TABLE_NAME,CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME;
-- Si cualquiera ya existe, detener: no repetir una instalacion parcial.
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos';
SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_cb2_piloto_reportado';
SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN('flota_cb2_consumos','tms_solicitud_fondo_lineas') AND INDEX_NAME IN('uq_cb2c_ambito','uq_cb2_fondolin_ambito') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
