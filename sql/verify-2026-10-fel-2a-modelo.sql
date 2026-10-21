-- SOLO LECTURA, después de migrar. FEL-2A no inserta filas: todas las tablas deben estar VACÍAS.
SHOW CREATE TABLE fel_emisores;
SHOW CREATE TABLE fel_emisor_ambientes;
SHOW CREATE TABLE fel_documentos;
SHOW CREATE TABLE fel_intentos;
SHOW INDEX FROM fact_facturas;
SELECT 'fel_emisores' AS tabla, COUNT(*) AS filas FROM fel_emisores
UNION ALL SELECT 'fel_emisor_ambientes', COUNT(*) FROM fel_emisor_ambientes
UNION ALL SELECT 'fel_documentos', COUNT(*) FROM fel_documentos
UNION ALL SELECT 'fel_intentos', COUNT(*) FROM fel_intentos;
-- Esperado en este rollout: las cuatro en 0 (sin emisores, credenciales, documentos ni backfill).
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'fel\_%' ORDER BY TABLE_NAME, CONSTRAINT_NAME;
-- La asociación a tabla proviene de TABLE_CONSTRAINTS, nunca de cc.TABLE_NAME (Hostinger).
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
 FROM information_schema.TABLE_CONSTRAINTS tc
 JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME LIKE 'fel\_%' AND tc.CONSTRAINT_TYPE='CHECK'
 ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'fel\_%';
-- Auditoría de invariantes (todas deben devolver 0 filas):
SELECT id FROM fel_documentos WHERE documento_origen_id = id;
SELECT d.id FROM fel_documentos d JOIN fel_emisor_ambientes a ON a.empresa_id=d.empresa_id AND a.emisor_id=d.emisor_id AND a.ambiente=d.ambiente WHERE a.proveedor='MOCK' AND d.ambiente='PROD';
SELECT id FROM fel_documentos WHERE estado='CERTIFICADO' AND (autorizacion IS NULL OR serie IS NULL OR numero IS NULL OR fecha_certificacion IS NULL);
SELECT i.id FROM fel_intentos i LEFT JOIN fel_documentos d ON d.empresa_id=i.empresa_id AND d.id=i.documento_id WHERE d.id IS NULL;
