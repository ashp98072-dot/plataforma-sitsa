import { readFileSync } from 'node:fs';

// Contrato del estado POSTERIOR a migrate-2026-11-canecas-catalogos-wip.sql, obtenido en MariaDB 11.8.9.
// Incluye canecas_compras completa (la migración la modifica) y las dos tablas nuevas del catálogo propio.
const tablas = "'canecas_proveedores','canecas_clientes','canecas_compras'";
const nombres = ['tablas', 'columnas', 'indices', 'foraneas', 'checks'];
const queries = {
  tablas: `SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME`,
  columnas: `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,ORDINAL_POSITION`,
  indices: `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,COLLATION,NULLABLE,IGNORED FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,BINARY INDEX_NAME,SEQ_IN_INDEX`,
  foraneas: `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${tablas}) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
  checks: `SELECT t.TABLE_NAME,t.CONSTRAINT_NAME,c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME IN (${tablas}) ORDER BY BINARY t.TABLE_NAME,BINARY t.CONSTRAINT_NAME`,
};
export async function obtenerContratoCatalogos(connection) {
  const resultado = {};
  for (const [nombre, sql] of Object.entries(queries)) {
    const [rows] = await connection.query(sql);
    resultado[nombre] = JSON.parse(JSON.stringify(rows));
  }
  return resultado;
}

export function leerContratoCatalogosEsperado() {
  return JSON.parse(readFileSync(new URL('./contrato-catalogos-mariadb-11.8.9.json', import.meta.url), 'utf8'));
}

export async function verificarContratoCatalogos(connection) {
  const esperado = leerContratoCatalogosEsperado();
  const actual = await obtenerContratoCatalogos(connection);
  for (const nombre of nombres) if (JSON.stringify(actual[nombre]) !== JSON.stringify(esperado[nombre])) throw Error(`DETENER: contrato de catálogos incompatible en ${nombre}`);
}

/**
 * Compuerta para cualquier migración futura que contraiga la relación con compras_proveedores (por ejemplo, retirar
 * la FK o exigir canecas_proveedor_id): se detiene mientras existan compras sin proveedor de Canecas mapeado.
 * Nunca reasigna ni modifica registros: el mapeo es una acción manual y explícita por compra.
 */
export async function verificarMapeoProveedoresCompleto(connection) {
  const [rows] = await connection.query('SELECT COUNT(*) AS sin_mapear FROM canecas_compras WHERE canecas_proveedor_id IS NULL');
  const sinMapear = Number(rows[0]?.sin_mapear);
  if (!Number.isInteger(sinMapear)) throw Error('DETENER: no se pudo contar las compras sin mapear');
  if (sinMapear > 0) throw Error(`DETENER: ${sinMapear} compras históricas sin proveedor de Canecas; requiere mapeo manual antes de continuar`);
}
