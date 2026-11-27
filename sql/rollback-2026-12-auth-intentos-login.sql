-- A4 · REVERSIÓN de migrate-2026-12-auth-intentos-login.sql. Aplicación MANUAL.
-- ANTES de ejecutarla: poner AUTH_INTENTOS_PROTECCION=0 (o quitarla) y reiniciar la aplicación; con la protección activa y la tabla ausente, el login responde 503 a propósito.
-- La tabla solo contiene contadores temporales (hashes HMAC); borrarla no afecta usuarios, contraseñas ni sesiones.
DROP TABLE IF EXISTS auth_intentos_login;
