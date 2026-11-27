-- A4 · PREFLIGHT (SOLO LECTURA) antes de migrate-2026-12-auth-intentos-login.sql. No modifica nada: sin INSERT/UPDATE/DELETE/DDL.
-- Ejecutar con la base de la aplicación seleccionada. Resultado esperado en cada columna indicado en su alias.

-- 1) Motor y versión: se espera MariaDB 11.8.x (la migración usa CHECK, DATETIME(6) y REGEXP).
SELECT VERSION() AS version_esperada_11_8, @@innodb_default_row_format AS formato_filas, DATABASE() AS base_seleccionada_no_nula;

-- 2) La tabla NO debe existir todavía (0). Si da 1, la migración ya se aplicó: pasar directamente al postcheck.
SELECT COUNT(*) AS tabla_ya_existe_esperado_0 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login';

-- 3) Privilegios de la cuenta actual sobre la base (debe incluir CREATE para la migración; la aplicación necesita SELECT, INSERT, UPDATE y DELETE).
SHOW GRANTS FOR CURRENT_USER();

-- 4) Las tablas de login existentes siguen intactas (no se modifican): conteos informativos.
SELECT (SELECT COUNT(*) FROM usuarios) AS usuarios_staff,
       (SELECT COUNT(*) FROM colaborador_credenciales) AS credenciales_colaborador,
       (SELECT COUNT(*) FROM tms_cliente_usuarios) AS usuarios_cliente;
