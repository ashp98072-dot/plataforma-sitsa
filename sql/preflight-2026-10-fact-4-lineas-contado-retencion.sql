-- SOLO LECTURA. Preflight de sql/migrate-2026-10-fact-4-lineas-contado-retencion.sql. No modifica nada.
-- Revisar cada resultado ANTES de aplicar la migración. NO ejecutado en Hostinger/producción.

-- 1) Las tablas base que se referencian existen y son InnoDB (las nuevas FKs apuntan a ellas).
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('fact_facturas', 'fact_cliente_perfil', 'tms_planes_viaje', 'cont_entidades', 'cont_cuentas');

-- 2) Las claves únicas que usan las FKs compuestas por entidad deben existir:
--    cont_entidades(empresa_id, id) y cont_cuentas(empresa_id, entidad_id, id)  → 2 filas.
SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
   AND INDEX_NAME IN ('uq_cont_entidad_empresa_id', 'uq_cont_cuenta_ambito')
 GROUP BY TABLE_NAME, INDEX_NAME;

-- 3) ANTES de migrar, las tablas nuevas NO deben existir (0 filas). Si existen, la migración ya se aplicó: es idempotente.
SHOW TABLES LIKE 'fact_factura_lineas';
SHOW TABLES LIKE 'fact_factura_linea_viajes';
SHOW TABLES LIKE 'cont_cuentas_bancarias';
SHOW TABLES LIKE 'fact_entidad_config';

-- 4) ANTES de migrar, las columnas nuevas NO deben existir (0 filas en cada consulta).
SHOW COLUMNS FROM fact_facturas WHERE Field IN
  ('entidad_id', 'modelo_lineas', 'condicion_pago', 'cuenta_bancaria_id', 'cuenta_bancaria_snapshot',
   'retencion_iva_pct', 'retencion_iva_cliente_pct', 'retencion_iva_monto');
SHOW COLUMNS FROM fact_cliente_perfil WHERE Field = 'retencion_iva_pct';

-- 5) La garantía anti doble facturación NO se toca: UNIQUE uq_factviaje_plan sigue vigente (1 fila).
SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0;

-- 6) Contexto: facturas por estado (todas quedarán con modelo_lineas = 0; se leen como antes, sin líneas guardadas).
SELECT estado_admin, COUNT(*) AS facturas FROM fact_facturas GROUP BY estado_admin;

-- 7) Contexto contable: entidades y cuentas disponibles (las cuentas bancarias de abajo se darán de alta A MANO por entidad).
SELECT id, empresa_id, codigo, nombre, activa FROM cont_entidades ORDER BY empresa_id, codigo;
SELECT empresa_id, entidad_id, COUNT(*) AS cuentas FROM cont_cuentas GROUP BY empresa_id, entidad_id;

-- 8) Perfiles de cliente existentes (recibirán retencion_iva_pct = 0, «no aplica»).
SELECT COUNT(*) AS perfiles FROM fact_cliente_perfil;
