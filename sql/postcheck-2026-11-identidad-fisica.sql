-- SOLO LECTURA. Esperados: cuatro tablas InnoDB; 15 guardas; dos CHECK CB2.
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones') ORDER BY TABLE_NAME;
SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
 AND (TRIGGER_NAME IN ('fifi_nueva','fifm_validar','fifm_empresas','fifm_inmutable','fifm_no_borrar','fife_no_borrar','fife_inmutable','fifa_validar','fifa_inmutable','fifa_no_borrar','fifi_aprobar','fifi_no_borrar','fifv_identidad','ffi_2abd957034829d58fcc789b21f6ed7e4','ffu_2abd957034829d58fcc789b21f6ed7e4')) ORDER BY TRIGGER_NAME;
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
 AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME IN ('ck_cb2c_unidad_tipo','ck_cb2_piloto_unico');
-- Las migraciones NO crean propuestas ni aprueban pares: cero en instalacion inicial.
SELECT estado,COUNT(*) cantidad FROM flota_identidades_fisicas GROUP BY estado;
-- Siempre cero.
SELECT COUNT(*) aprobadas_incompletas FROM flota_identidades_fisicas f WHERE f.estado='APROBADA' AND
 ((SELECT COUNT(*) FROM flota_identidad_miembros m WHERE m.identidad_id=f.id)<2 OR EXISTS
 (SELECT 1 FROM flota_identidad_empresas e LEFT JOIN flota_identidad_aprobaciones a ON a.identidad_id=e.identidad_id AND a.empresa_id=e.empresa_id WHERE e.identidad_id=f.id AND a.identidad_id IS NULL));
-- Ejecutar tambien el postcheck de fusiones existente: debe seguir sin guardas faltantes.
