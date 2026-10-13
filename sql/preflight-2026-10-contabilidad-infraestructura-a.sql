-- SOLO LECTURA. Seleccionar explícitamente la BD objetivo en phpMyAdmin.
-- NO requiere information_schema. No ejecutar migrate hasta revisar TODOS los bloques.
SELECT DATABASE() AS esquema_objetivo, VERSION() AS version_servidor,
       @@foreign_key_checks AS foreign_key_checks, @@check_constraint_checks AS check_constraint_checks;
SHOW TABLES;
SHOW TABLE STATUS WHERE Name IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas','cont_cuentas_rol','cont_eventos');
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
SHOW CREATE TABLE cont_entidades;
SHOW CREATE TABLE cont_cuentas;
SHOW CREATE TABLE cont_asientos;
SHOW CREATE TABLE fact_facturas;
SHOW INDEX FROM cont_entidades;
SHOW INDEX FROM cont_cuentas;
SHOW INDEX FROM cont_asientos;
SHOW FULL COLUMNS FROM cont_entidades;
SHOW FULL COLUMNS FROM cont_cuentas;
SHOW FULL COLUMNS FROM cont_asientos;
SHOW FULL COLUMNS FROM fact_facturas;
SHOW TABLES LIKE 'cont_cuentas_rol';
SHOW TABLES LIKE 'cont_eventos';
-- Detectar huérfanos/ámbitos incompatibles de padres. Deben devolver cero.
SELECT c.id FROM cont_cuentas c LEFT JOIN cont_entidades e ON e.empresa_id=c.empresa_id AND e.id=c.entidad_id WHERE c.entidad_id IS NOT NULL AND e.id IS NULL;
SELECT a.id FROM cont_asientos a LEFT JOIN cont_entidades e ON e.empresa_id=a.empresa_id AND e.id=a.entidad_id WHERE a.entidad_id IS NOT NULL AND e.id IS NULL;
SELECT f.id FROM fact_facturas f LEFT JOIN cont_entidades e ON e.empresa_id=f.empresa_id AND e.id=f.entidad_id WHERE f.entidad_id IS NOT NULL AND e.id IS NULL;
-- Bloques CONDICIONALES, ejecutar solo si SHOW TABLES confirmó existencia:
-- SHOW CREATE TABLE cont_cuentas_rol;
-- SELECT r.id FROM cont_cuentas_rol r LEFT JOIN cont_cuentas c ON c.empresa_id=r.empresa_id AND c.entidad_id=r.entidad_id AND c.id=r.cuenta_id WHERE c.id IS NULL OR r.rol NOT IN ('CLIENTES','IVA_POR_PAGAR','RETENCION_IVA','VENTAS_SERVICIOS','VENTAS_BIENES') OR r.activa NOT IN (0,1);
-- SHOW CREATE TABLE cont_eventos;
-- SELECT COUNT(*) AS eventos_previos FROM cont_eventos;
-- Nombres de constraint: SHOW TABLES y SHOW CREATE TABLE de tablas cont_* existentes.
-- En Hostinger sin metadatos globales NO inferir ausencia de colisiones: revisar esos DDL manualmente.
-- APTO/APLICAR: MariaDB compatible (objetivo 11.8.9), InnoDB, IDs INT signed,
-- anclas UNIQUE cont_entidades(empresa_id,id), cont_cuentas/cont_asientos(empresa_id,entidad_id,id),
-- collations compatibles, checks/FKs ON, sin colisiones ni huérfanos, nuevas tablas ausentes.
-- NOOP: ambas tablas presentes con DDL EXACTO de migrate y datos compatibles.
-- DETENER: tabla existente distinta (incluido CHECK antiguo sin VENTAS_BIENES o roles adicionales),
-- duda sobre colisiones, engine/tipos/índices incompatibles o metadatos inaccesibles/no revisados.
-- No reparar ni convertir tablas automáticamente. Preparar migración separada si hay drift.
