import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataContract } from './build-phpmyadmin-import.mjs';
const dir = new URL('../../../sql/', import.meta.url);
export const postcheckOutput = new URL('postcheck-phpmyadmin-2026-10-combustibles-pr2.sql', dir);
export function metadataContract() {
 const source = readFileSync(new URL('postcheck-2026-10-combustibles-pr2-consumos-facturas.sql', dir), 'utf8').replace(/\r\n/g, '\n');
 const match = source.match(/-- BEGIN CB2_METADATA_CANONICO[\s\S]*?INTO @cb2_base_ok, @cb2_estado FROM resumen;/);
 if (!match) throw new Error('Contrato metadata no reconocido');
 return match[0];
}
export function buildPostcheck(schema = 'u611730801_Plataforma') {
 if (!/^[A-Za-z0-9_]{1,64}$/.test(schema) || ['mysql','sys','information_schema','performance_schema'].includes(schema.toLowerCase())) throw new Error('Esquema explicito invalido');
 return `USE \`${schema}\`;
SET @cb2_pc_done = 0;
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
 SET @cb2_pc_connection = CONNECTION_ID();
 SET @cb2_base_ok = NULL, @cb2_estado = NULL;
 SET @cb2_pc_data = NULL, @cb2_pc_count = NULL, @cb2_pc_sum = NULL, @cb2_pc_nonnull = NULL;
 SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0,
  @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES'));
 SET SESSION innodb_strict_mode = ON;
 IF COALESCE(CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin =
    CONVERT(@cb2_schema USING utf8mb4) COLLATE utf8mb4_bin, 0) <> 1 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CB2: contexto de postcheck incorrecto';
 END IF;
${metadataContract()}
 IF @cb2_estado = 'FINAL' AND @cb2_base_ok = 1 THEN
${dataContract()}
SELECT JSON_OBJECTAGG(comprobacion, incidencias), COUNT(*), COALESCE(SUM(incidencias), 1), COUNT(incidencias)
INTO @cb2_pc_data, @cb2_pc_count, @cb2_pc_sum, @cb2_pc_nonnull
FROM incidencias;
 END IF;
 SET SESSION sql_mode = v_cb2_mode;
 SET SESSION innodb_strict_mode = v_cb2_innodb;
 SET @cb2_pc_done = 1;
END$$
DELIMITER ;
SELECT CASE WHEN COALESCE(@cb2_pc_done, 0) <> 1 THEN 'SIN_CERTIFICAR'
 WHEN @cb2_estado = 'FINAL' AND @cb2_base_ok = 1 AND @cb2_pc_count = 15
      AND @cb2_pc_nonnull = 15 AND @cb2_pc_sum = 0 THEN 'CB2_POSTCHECK_FINAL'
 ELSE 'DIVERGENTE' END AS resultado,
 @cb2_estado AS estado_metadata, @cb2_pc_count AS validaciones, @cb2_pc_sum AS incidencias,
 @cb2_pc_data AS detalle_datos, @cb2_schema AS esquema_objetivo,
 CONNECTION_ID() = @cb2_pc_connection AS misma_conexion,
 @@SESSION.sql_mode AS sql_mode_restaurado, @@SESSION.innodb_strict_mode AS innodb_restaurado;
`;
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
 const bytes = Buffer.from(buildPostcheck(), 'utf8');
 if (process.argv[2] === '--write' && process.argv.length === 3) writeFileSync(postcheckOutput, bytes);
 else if (process.argv[2] === '--check' && process.argv.length === 3) {
  if (!readFileSync(postcheckOutput).equals(bytes)) throw new Error('Postcheck publicado distinto de fuentes/generador');
  console.log('PASS: postcheck exacto, sin BOM, metadata e incidencias canonicas.');
 } else throw new Error('Uso: node build-phpmyadmin-postcheck.mjs --write|--check');
}
