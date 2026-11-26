-- POSTCHECK (solo lectura) — migrate-2026-11-tms-cliente-usuarios-solo-lectura.sql. No modifica nada.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_cliente_usuarios' AND COLUMN_NAME = 'solo_lectura';   -- esperado: tinyint(1), NO, 0
SELECT COUNT(*) AS no_solo_lectura_previos FROM tms_cliente_usuarios WHERE solo_lectura <> 0;   -- esperado: 0 justo después de aplicar (las cuentas previas no cambian)
