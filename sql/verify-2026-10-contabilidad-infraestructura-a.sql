-- SOLO LECTURA; comparar columnas, UNIQUE, FK, CHECK y engine con migrate.
SELECT DATABASE() AS esquema_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE cont_cuentas_rol;
SHOW CREATE TABLE cont_eventos;
SHOW FULL COLUMNS FROM cont_cuentas_rol;
SHOW FULL COLUMNS FROM cont_eventos;
SHOW INDEX FROM cont_cuentas_rol;
SHOW INDEX FROM cont_eventos;
SHOW TABLE STATUS WHERE Name IN ('cont_cuentas_rol','cont_eventos');
SELECT COUNT(*) AS configuraciones FROM cont_cuentas_rol;
SELECT COUNT(*) AS eventos FROM cont_eventos;
-- Comparar TODAS las filas/campos con SELECT preflight, no solo conteos (producción previa = 14).
SELECT * FROM cont_cuentas_rol ORDER BY id;
SELECT rol, COUNT(*) AS cantidad FROM cont_cuentas_rol GROUP BY rol ORDER BY rol;
SELECT COUNT(*) AS ventas_bienes_configuradas FROM cont_cuentas_rol WHERE rol='VENTAS_BIENES';
-- Esperado en este rollout: 14 filas intactas; ventas_bienes_configuradas=0; eventos=0.
-- Instalación inicialmente vacía: ambos conteos deben ser 0. Si ya existía configuración,
-- comparar con conteos/DDL previos: la migración NO debe añadir filas ni reinterpretarlas.
SELECT r.id FROM cont_cuentas_rol r LEFT JOIN cont_cuentas c ON c.empresa_id=r.empresa_id AND c.entidad_id=r.entidad_id AND c.id=r.cuenta_id WHERE c.id IS NULL;
SELECT ev.id FROM cont_eventos ev LEFT JOIN fact_facturas f ON f.id=ev.factura_id AND f.empresa_id=ev.empresa_id AND f.entidad_id=ev.entidad_id WHERE f.id IS NULL;
