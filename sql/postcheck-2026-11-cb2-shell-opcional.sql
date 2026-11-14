-- SOLO SELECT. Auditar antes de autorizar cualquier ejecucion; no aplicar migraciones desde este archivo.
-- Esperados: tres CHECK de piloto/unidad, una tabla InnoDB, tres FK y tabla nueva vacia al instalar.
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos'
 AND CONSTRAINT_NAME IN('ck_cb2_piloto_unico','ck_cb2c_unidad_tipo','ck_cb2_piloto_reportado') ORDER BY CONSTRAINT_NAME;
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos';
SELECT CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos' ORDER BY CONSTRAINT_NAME;
SELECT COUNT(*) vinculos_manuales FROM flota_cb2_fondos_vinculos;
-- Cero filas; las FK compuestas tambien protegen el aislamiento por empresa/proveedor.
SELECT v.consumo_id FROM flota_cb2_fondos_vinculos v
 LEFT JOIN flota_cb2_consumos c ON c.empresa_id=v.empresa_id AND c.proveedor_id=v.proveedor_id AND c.id=v.consumo_id
 LEFT JOIN tms_solicitud_fondo_lineas l ON l.empresa_id=v.empresa_id AND l.id=v.linea_id
 WHERE c.id IS NULL OR l.id IS NULL;
-- Exportar antes y despues para comparar definiciones, orden y metadatos completos de los triggers previos.
SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_ORDER,DEFINER,SQL_MODE,
 CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION,
 SHA2(REPLACE(ACTION_STATEMENT,CHAR(13,10),CHAR(10)),256) cuerpo_sha256
 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_ORDER,TRIGGER_NAME;

-- Esperado fk_cb2fv_linea -> uq_fondolin_c2a_empresa_id; tres filas en total.
SELECT CONSTRAINT_NAME,UNIQUE_CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE
 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
 AND TABLE_NAME='flota_cb2_fondos_vinculos' ORDER BY CONSTRAINT_NAME;
-- Esperado cero filas: no debe crearse un índice redundante por esta migración.
SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tms_solicitud_fondo_lineas' AND INDEX_NAME='uq_cb2_fondolin_ambito';
-- Los dos CHECK de la tabla de vínculos deben permanecer presentes.
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos' ORDER BY CONSTRAINT_NAME;
