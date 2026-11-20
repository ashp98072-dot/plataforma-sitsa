import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Contrato obtenido de la migración ensayada en MariaDB 11.8.9. Se limita a
// objetos de esta fase; no incorpora datos ni definiciones de otros módulos.
const tables = "'canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores'";
const checks = "'chk_can_compra_costos','chk_can_precio_venta','chk_can_val_cantidad','chk_can_val_costo','chk_can_capa_fuente','chk_can_capa_cant','chk_can_capa_costo','chk_can_capa_moneda','chk_can_gasto_positivo','chk_can_gasto_estado'";
const names = ['tablas', 'columnas', 'indices', 'foraneas', 'checks'];
const queries = [
  `SELECT TABLE_NAME,TABLE_TYPE,ENGINE,ROW_FORMAT,TABLE_COLLATION,CREATE_OPTIONS,TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables}) ORDER BY TABLE_NAME`,
  `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,CHARACTER_MAXIMUM_LENGTH,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME IN (${tables}) OR (TABLE_NAME='canecas_compras' AND COLUMN_NAME IN ('precio_unitario_centavos','gastos_centavos','moneda')) OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME IN ('precio_venta_referencia_centavos','precio_venta_referencia_moneda'))) ORDER BY TABLE_NAME,ORDINAL_POSITION`,
  `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,COLLATION,NULLABLE,INDEX_COMMENT,IGNORED FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables}) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
  `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${tables}) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
  `SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN (${checks}) ORDER BY CONSTRAINT_NAME`,
];
export async function obtenerContrato(connection) {
  const result = {};
  for (let i = 0; i < queries.length; i++) {
    const [rows] = await connection.query(queries[i]);
    result[names[i]] = JSON.parse(JSON.stringify(rows));
  }
  return result;
}
export async function verificarContrato(connection) {
  const expected = JSON.parse(readFileSync(fileURLToPath(new URL('./contrato-costos-mariadb-11.8.9.json', import.meta.url)), 'utf8'));
  const actual = await obtenerContrato(connection);
  for (const key of names) if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) throw Error(`DETENER: definición incompatible de ${key}`);
}
