import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const sqlDir = new URL('../../../sql/', import.meta.url);
export const importOutput = new URL('import-phpmyadmin-2026-10-combustibles-pr2.sql', sqlDir);
const read = name => readFileSync(new URL(`${name}-2026-10-combustibles-pr2-consumos-facturas.sql`, sqlDir), 'utf8').replace(/\r\n/g, '\n');
export function compoundBody(sql) {
  // Solo adaptar delimitadores del cliente y bloques anidados; DDL y guards intactos.
  return sql.replace(/^DELIMITER \$\$\n/gm, '').replace(/^DELIMITER ;\n?/gm, '')
    .replace(/^BEGIN NOT ATOMIC$/gm, 'BEGIN').replace(/^END\$\$$/gm, 'END;');
}
export function buildImport(schema = 'u611730801_Plataforma') {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(schema) || ['mysql','sys','information_schema','performance_schema'].includes(schema.toLowerCase())) throw new Error('Esquema explicito invalido');
  return `USE \`${schema}\`;
DELIMITER $$
BEGIN NOT ATOMIC
 DECLARE v_cb2_mode TEXT DEFAULT @@SESSION.sql_mode;
 DECLARE v_cb2_innodb BOOLEAN DEFAULT @@SESSION.innodb_strict_mode;
 DECLARE EXIT HANDLER FOR SQLEXCEPTION
 BEGIN
  SET SESSION sql_mode = v_cb2_mode;
  SET SESSION innodb_strict_mode = v_cb2_innodb;
  RESIGNAL;
 END;
 SET @cb2_schema = _utf8mb4'${schema}';
 SET @cb2_import_connection = CONNECTION_ID();
 SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0,
  @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES'));
 SET SESSION innodb_strict_mode = ON;
 SELECT 'IMPORT_INICIO' AS fase, CONNECTION_ID() AS conexion,
  DATABASE() AS esquema_actual, @cb2_schema AS esquema_objetivo,
  @@SESSION.sql_mode AS sql_mode, @@SESSION.innodb_strict_mode AS innodb_strict_mode,
  @@foreign_key_checks AS foreign_key_checks, @@check_constraint_checks AS check_constraint_checks,
  @@group_concat_max_len AS group_concat_max_len, @@innodb_page_size AS innodb_page_size;
 IF COALESCE(CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin =
    CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin, 0) <> 1 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CB2: contexto de importacion incorrecto';
 END IF;
${compoundBody(read('preflight'))}
${compoundBody(read('migrate'))}
${compoundBody(read('postcheck'))}
 SELECT 'IMPORT_FIN' AS fase, CONNECTION_ID() AS conexion,
  CONNECTION_ID() = @cb2_import_connection AS misma_conexion,
  DATABASE() AS esquema_actual, @cb2_schema AS esquema_objetivo,
  @cb2_migracion_completada AS migracion_completada, @cb2_estado AS estado_metadata;
 SET SESSION sql_mode = v_cb2_mode;
 SET SESSION innodb_strict_mode = v_cb2_innodb;
 SELECT 'IMPORT_RESTAURADO' AS fase, @@SESSION.sql_mode AS sql_mode,
  @@SESSION.innodb_strict_mode AS innodb_strict_mode;
END$$
DELIMITER ;
`;
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
 const content = Buffer.from(buildImport(), 'utf8');
 if (process.argv[2] === '--write' && process.argv.length === 3) writeFileSync(importOutput, content);
 else if (process.argv[2] === '--check' && process.argv.length === 3) {
  if (!readFileSync(importOutput).equals(content)) throw new Error('Import SQL distinto del generado o con BOM/recodificacion');
  console.log('PASS: import SQL exacto, UTF-8 sin BOM y fuentes canonicas preservadas.');
 } else throw new Error('Uso: node build-phpmyadmin-import.mjs --write|--check');
}
