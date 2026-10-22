import { readFileSync, writeFileSync } from 'node:fs';

// Solo genera texto SQL para revision manual. No usa cliente, red, .env ni credenciales.
const preflight = readFileSync(new URL('../../../sql/preflight-2026-10-combustibles-pr2-consumos-facturas.sql', import.meta.url), 'utf8');
const prefix = `SELECT 'ANTES' AS fase, CONNECTION_ID() AS conexion,
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
const generated = Buffer.from(prefix + preflight + suffix, 'utf8');
const [mode, filename, ...extra] = process.argv.slice(2);
if (extra.length || (mode && (!['--output', '--check'].includes(mode) || !filename))) {
  throw new Error('Uso: node build-session-preflight.mjs [--output archivo.sql | --check archivo.sql]');
}
if (mode === '--output') {
  // Escritura directa: evita BOM y recodificacion de pipelines de Windows PowerShell.
  writeFileSync(filename, generated);
} else if (mode === '--check') {
  const bytes = readFileSync(filename);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    throw new Error('BOM UTF-8 detectado: regenerar con --output, sin Set-Content');
  }
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!bytes.subarray(0, 6).equals(Buffer.from('SELECT'))) {
    throw new Error('El archivo debe empezar directamente con SELECT, sin BOM ni comentarios');
  }
  if (!bytes.equals(generated)) {
    throw new Error('El archivo no coincide con el lote generado y el preflight actual');
  }
  console.log('PASS: UTF-8 sin BOM, inicio SELECT y lote completo identico al generador actual.');
} else {
  process.stdout.write(generated);
}
