-- A4 · POSTCHECK (SOLO LECTURA) después de migrate-2026-12-auth-intentos-login.sql. No modifica nada.
-- Todos los valores deben coincidir con el esperado del alias antes de activar AUTH_INTENTOS_PROTECCION=1.

SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login' AND ENGINE = 'InnoDB') AS tabla_innodb_esperado_1,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login'
     AND COLUMN_NAME IN ('alcance','tipo','clave','fallos','ventana_inicio','bloqueos','bloqueado_hasta','actualizado')) AS columnas_esperado_8,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login' AND INDEX_NAME = 'PRIMARY') AS columnas_pk_esperado_3,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login' AND INDEX_NAME = 'idx_authint_actualizado') AS indice_limpieza_esperado_1,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login' AND CONSTRAINT_TYPE = 'CHECK') AS checks_esperado_2;

-- Contenido: recién creada debe estar vacía (0). Después de activar, solo hay hashes de 64 hex (la consulta de abajo debe dar 0 filas inválidas).
SELECT COUNT(*) AS filas, SUM(clave NOT REGEXP '^[0-9a-f]{64}$') AS claves_invalidas_esperado_0_o_null FROM auth_intentos_login;
