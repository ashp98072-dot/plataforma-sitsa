-- PREFLIGHT (solo lectura) — migrate-2026-11-tms-cliente-usuarios-solo-lectura.sql. No modifica nada.
SELECT COUNT(*) AS existe_tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_cliente_usuarios';   -- esperado: 1
SELECT COUNT(*) AS ya_tiene_columna FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_cliente_usuarios' AND COLUMN_NAME = 'solo_lectura';   -- 0 antes; 1 si ya se aplicó
SELECT COUNT(*) AS usuarios_existentes FROM tms_cliente_usuarios;   -- informativo: todos quedarán con solo_lectura = 0
