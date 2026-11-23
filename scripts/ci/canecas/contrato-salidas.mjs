import { readFileSync } from 'node:fs';

const tablas = "'canecas_salidas_fifo','canecas_salidas_fifo_capas'";
const queries = {
  tablas: `SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME`,
  columnas: `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,ORDINAL_POSITION`,
  indices: `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,COLLATION,NULLABLE,IGNORED FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,BINARY INDEX_NAME,SEQ_IN_INDEX`,
  foraneas: `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${tablas}) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
  checks: `SELECT t.TABLE_NAME,t.CONSTRAINT_NAME,c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME IN (${tablas}) AND t.CONSTRAINT_TYPE='CHECK' ORDER BY BINARY t.TABLE_NAME,BINARY t.CONSTRAINT_NAME`,
};
export async function obtenerContratoSalidas(connection) {
  const resultado = {};
  for (const [nombre, sql] of Object.entries(queries)) {
    const [rows] = await connection.query(sql);
    resultado[nombre] = JSON.parse(JSON.stringify(rows));
  }
  return resultado;
}
export async function verificarContratoSalidas(connection) {
  const esperado = JSON.parse(readFileSync(new URL('./contrato-salidas-mariadb-11.8.9.json', import.meta.url), 'utf8'));
  const actual = await obtenerContratoSalidas(connection);
  for (const nombre of Object.keys(queries)) if (JSON.stringify(actual[nombre]) !== JSON.stringify(esperado[nombre])) throw Error(`DETENER: contrato de salidas incompatible en ${nombre}`);
}
