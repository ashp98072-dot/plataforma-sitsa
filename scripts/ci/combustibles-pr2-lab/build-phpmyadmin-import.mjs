import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const sqlDir = new URL('../../../sql/', import.meta.url);
export const importOutput = new URL('import-phpmyadmin-2026-10-combustibles-pr2.sql', sqlDir);
const read = name => readFileSync(new URL(`${name}-2026-10-combustibles-pr2-consumos-facturas.sql`, sqlDir), 'utf8').replace(/\r\n/g, '\n');
export function compoundBody(sql) {
 return sql.replace(/^DELIMITER \$\$\n/gm, '').replace(/^DELIMITER ;\n?/gm, '')
  .replace(/^BEGIN NOT ATOMIC$/gm, 'BEGIN').replace(/^END\$\$$/gm, 'END;');
}
export function silentMigration() {
 const original = compoundBody(read('migrate'));
 const report = " SELECT 'APLICADA_PENDIENTE_POSTCHECK' AS resultado_migracion,\n        @cb2_estado AS estado_esquema_cb2;";
 if (original.split(report).length !== 2) throw new Error('Salida de migrate no reconocida');
 return original.replace(report, " SELECT 'APLICADA_PENDIENTE_POSTCHECK', @cb2_estado\n INTO @cb2_import_resultado, @cb2_import_estado;");
}
export function dataContract() {
 const match = read('postcheck').match(/SELECT '(WITH incidencias AS \([\s\S]*?)' INTO @cb2_postcheck_select;/);
 if (!match) throw new Error('Contrato de datos no reconocido');
 const sql = match[1].replaceAll("''", "'");
 const boundary = "\nSELECT 'DATO' AS ambito";
 if (sql.split(boundary).length !== 2) throw new Error('Proyeccion de datos no reconocida');
 return sql.split(boundary)[0]; // Las 15 incidencias EXACTAS, incluidos todos sus predicados.
}
export function buildImport(schema = 'u611730801_Plataforma') {
 if (!/^[A-Za-z0-9_]{1,64}$/.test(schema) || ['mysql','sys','information_schema','performance_schema'].includes(schema.toLowerCase())) throw new Error('Esquema explicito invalido');
 return `USE \`${schema}\`;
SET @cb2_import_ok = 0;
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
 SET @cb2_datos = NULL, @cb2_total_validaciones = NULL, @cb2_total_incidencias = NULL;
 SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0,
  @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES'));
 SET SESSION innodb_strict_mode = ON;
 IF COALESCE(CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin =
    CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin, 0) <> 1 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CB2: contexto de importacion incorrecto';
 END IF;
${silentMigration()}
${dataContract()}
SELECT JSON_OBJECTAGG(comprobacion, incidencias), COUNT(*), COALESCE(SUM(incidencias), 1), COUNT(incidencias)
INTO @cb2_datos, @cb2_total_validaciones, @cb2_total_incidencias, @cb2_validaciones_no_nulas
FROM incidencias;
 IF COALESCE(@cb2_total_validaciones, 0) <> 15 OR COALESCE(@cb2_validaciones_no_nulas, 0) <> 15
    OR COALESCE(@cb2_total_incidencias, 1) <> 0 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CB2: postcheck de datos no FINAL';
 END IF;
 SET SESSION sql_mode = v_cb2_mode;
 SET SESSION innodb_strict_mode = v_cb2_innodb;
 SET @cb2_import_ok = 1;
END$$
DELIMITER ;
SELECT CASE WHEN COALESCE(@cb2_import_ok, 0) = 1 THEN 'CB2_IMPORT_FINAL' ELSE 'SIN_CERTIFICAR' END AS resultado, @cb2_estado AS estado_metadata,
 @cb2_total_validaciones AS validaciones, @cb2_total_incidencias AS incidencias,
 @cb2_datos AS detalle_datos, @cb2_schema AS esquema_objetivo,
 CONNECTION_ID() = @cb2_import_connection AS misma_conexion,
 @@SESSION.sql_mode AS sql_mode_restaurado, @@SESSION.innodb_strict_mode AS innodb_restaurado;
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
