import { readFileSync } from 'node:fs';

// Solo genera texto SQL para revision manual. No usa cliente, red, .env ni credenciales.
const preflight = readFileSync(new URL('../../../sql/preflight-2026-10-combustibles-pr2-consumos-facturas.sql', import.meta.url), 'utf8');
const prefix = `-- PR #507: SOLO LECTURAS DE METADATA Y ESTADO DE SESION; no ejecuta migracion.
-- Revisar y autorizar antes de enviar TODO este archivo en una sola ejecucion.
-- Cliente detenido ante el primer error; no enviar sentencias por separado.
SELECT 'ANTES' AS fase, CONNECTION_ID() AS conexion,
 DATABASE() AS esquema, @@SESSION.sql_mode AS sql_mode;
USE \`u611730801_Plataforma\`;
SET @cb2_audit_sql_mode_before = @@SESSION.sql_mode,
    @cb2_audit_connection = CONNECTION_ID();
SET SESSION sql_mode = IF(
 FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0,
 @@SESSION.sql_mode,
 CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES')
);
SELECT 'PREFLIGHT_INICIO' AS fase, CONNECTION_ID() AS conexion,
 DATABASE() AS esquema,
 CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin =
  _utf8mb4'u611730801_Plataforma' COLLATE utf8mb4_bin AS esquema_correcto,
 @@SESSION.sql_mode AS sql_mode,
 FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0 AS estricto,
 @@SESSION.foreign_key_checks AS foreign_key_checks,
 @@SESSION.check_constraint_checks AS check_constraint_checks,
 @@SESSION.innodb_strict_mode AS innodb_strict_mode,
 @@GLOBAL.innodb_page_size AS innodb_page_size,
 @@SESSION.group_concat_max_len AS group_concat_max_len,
 @@SESSION.sql_mode NOT LIKE '%NO_BACKSLASH_ESCAPES%' AS escapes_compatibles,
 VERSION() AS version;
SELECT TABLE_SCHEMA, TABLE_NAME, COUNT(*) AS columnas_visibles
FROM information_schema.COLUMNS
WHERE CONVERT(TABLE_SCHEMA USING utf8mb4) COLLATE utf8mb4_bin =
 _utf8mb4'u611730801_Plataforma' COLLATE utf8mb4_bin
 AND TABLE_NAME IN ('empresas', 'usuarios')
GROUP BY TABLE_SCHEMA, TABLE_NAME;
-- A continuacion, preflight completo sin modificar:
`;
const suffix = `
SELECT 'PREFLIGHT_FIN' AS fase, CONNECTION_ID() AS conexion,
 CONNECTION_ID() = @cb2_audit_connection AS misma_conexion,
 DATABASE() AS esquema,
 CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin =
  _utf8mb4'u611730801_Plataforma' COLLATE utf8mb4_bin AS esquema_correcto,
 @@SESSION.sql_mode AS sql_mode,
 FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0 AS estricto;
-- Restaurar solo al terminar todas las lecturas. Si hay error, cerrar la conexion.
SET SESSION sql_mode = @cb2_audit_sql_mode_before;
SELECT 'RESTAURADO' AS fase, CONNECTION_ID() AS conexion,
 DATABASE() AS esquema, @@SESSION.sql_mode AS sql_mode;
`;
process.stdout.write(prefix + preflight + suffix);
