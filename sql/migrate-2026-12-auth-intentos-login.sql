-- A4 · Protección contra intentos de login (staff, portal de colaboradores, portal de clientes). MariaDB 11.8.9.
-- Aplicación MANUAL por el propietario (phpMyAdmin o cliente SQL), con la base de la aplicación seleccionada. NO la ejecuta la aplicación.
-- Orden obligatorio: 1) preflight-2026-12-auth-intentos-login.sql  2) este archivo  3) postcheck-2026-12-auth-intentos-login.sql  4) activar AUTH_INTENTOS_PROTECCION=1 (ver docs/seguridad/A4-INTENTOS-LOGIN.md).
-- Aditiva e IDEMPOTENTE: solo CREATE TABLE IF NOT EXISTS. No toca ninguna tabla existente ni datos. Reversión: rollback-2026-12-auth-intentos-login.sql.
-- Contenido: SOLO hashes HMAC-SHA256 (con secreto de la aplicación) del identificador normalizado y de la IP; ningún usuario, correo ni IP en texto claro.

CREATE TABLE IF NOT EXISTS auth_intentos_login (
  alcance          VARCHAR(16) NOT NULL,                 -- staff | colaborador | cliente
  tipo             ENUM('ID','IP') NOT NULL,             -- ID = identificador normalizado; IP = origen
  clave            CHAR(64) NOT NULL,                    -- HMAC-SHA256 hex (64)
  fallos           SMALLINT UNSIGNED NOT NULL DEFAULT 0, -- fallos dentro de la ventana vigente
  ventana_inicio   DATETIME(6) NOT NULL,                 -- inicio de la ventana (reloj UTC de la base)
  bloqueos         SMALLINT UNSIGNED NOT NULL DEFAULT 0, -- bloqueos sufridos (bloqueo progresivo del identificador)
  bloqueado_hasta  DATETIME(6) NULL,                     -- NULL = sin bloqueo
  actualizado      DATETIME(6) NOT NULL,                 -- última actividad (limpieza)
  PRIMARY KEY (alcance, tipo, clave),
  KEY idx_authint_actualizado (actualizado),
  CONSTRAINT ck_authint_alcance CHECK (alcance IN ('staff', 'colaborador', 'cliente')),
  CONSTRAINT ck_authint_clave CHECK (clave REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;

-- Verificación inmediata (solo lectura): tabla 1, columnas 8, índices 2 (PRIMARY + idx_authint_actualizado).
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login' AND ENGINE = 'InnoDB') AS tabla_esperada_1,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login') AS columnas_esperadas_8,
  (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_intentos_login') AS indices_esperados_2;
