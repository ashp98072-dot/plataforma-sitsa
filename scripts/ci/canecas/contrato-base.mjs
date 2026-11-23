import { readFileSync } from 'node:fs';

// Solo comparación; no proporciona ni aprueba un contrato de Hostinger y no
// cambia el bloqueo incondicional del instalador.
const names = ['tablas', 'columnas', 'indices', 'foraneas', 'checks'];
const tables = ['empresas', 'usuarios', 'canecas_productos', 'canecas_ubicaciones', 'canecas_saldos', 'canecas_compras', 'canecas_recepciones', 'canecas_movimientos'];
const fields = {
  tablas: ['TABLE_NAME', 'TABLE_TYPE', 'ENGINE', 'TABLE_COLLATION', 'CREATE_OPTIONS'],
  columnas: ['TABLE_NAME', 'ORDINAL_POSITION', 'COLUMN_NAME', 'COLUMN_TYPE', 'IS_NULLABLE', 'COLUMN_DEFAULT', 'EXTRA', 'CHARACTER_SET_NAME', 'COLLATION_NAME', 'GENERATION_EXPRESSION', 'NUMERIC_PRECISION', 'NUMERIC_SCALE', 'DATETIME_PRECISION', 'CHARACTER_MAXIMUM_LENGTH'],
  indices: ['TABLE_NAME', 'INDEX_NAME', 'NON_UNIQUE', 'SEQ_IN_INDEX', 'COLUMN_NAME', 'SUB_PART', 'INDEX_TYPE', 'COLLATION', 'NULLABLE', 'IGNORED'],
  foraneas: ['TABLE_NAME', 'CONSTRAINT_NAME', 'ORDINAL_POSITION', 'POSITION_IN_UNIQUE_CONSTRAINT', 'COLUMN_NAME', 'REFERENCED_TABLE_SCHEMA', 'REFERENCED_TABLE_NAME', 'REFERENCED_COLUMN_NAME', 'UPDATE_RULE', 'DELETE_RULE'],
  checks: ['TABLE_NAME', 'CONSTRAINT_NAME', 'CHECK_CLAUSE'],
};
const requiredNonNull = {
  tablas: ['TABLE_NAME', 'TABLE_TYPE', 'ENGINE', 'TABLE_COLLATION'],
  columnas: ['TABLE_NAME', 'ORDINAL_POSITION', 'COLUMN_NAME', 'COLUMN_TYPE', 'IS_NULLABLE'],
  indices: ['TABLE_NAME', 'INDEX_NAME', 'NON_UNIQUE', 'SEQ_IN_INDEX', 'COLUMN_NAME', 'INDEX_TYPE'],
  foraneas: fields.foraneas,
  checks: fields.checks,
};
const source = readFileSync(new URL('../../../sql/contrato-base-canecas-solo-lectura.sql', import.meta.url), 'utf8');
const sections = source.split(/^-- contract:(\w+)\s*$/m);
const queries = Object.fromEntries(Array.from({ length: (sections.length - 1) / 2 }, (_, i) => [sections[1 + i * 2], sections[2 + i * 2].trim()]));

function validar(contract) {
  if (!contract || Object.keys(contract).sort().join() !== [...names].sort().join()) throw Error('DETENER: contrato base incompleto');
  for (const name of names) {
    if (!Array.isArray(contract[name])) throw Error(`DETENER: sección ${name} ausente`);
    for (const row of contract[name]) {
      if (!row || Object.keys(row).sort().join() !== [...fields[name]].sort().join() || !tables.includes(row.TABLE_NAME) || requiredNonNull[name].some(key => row[key] == null)) throw Error(`DETENER: metadatos incompletos en ${name}`);
    }
  }
  if (contract.tablas.length !== tables.length || tables.some(t => contract.tablas.filter(row => row.TABLE_NAME === t).length !== 1 || !contract.columnas.some(row => row.TABLE_NAME === t))) throw Error('DETENER: tablas o columnas incompletas');
}
export async function obtenerContratoBase(connection) {
  const contract = {};
  for (const name of names) {
    if (!queries[name]) throw Error('DETENER: consulta de contrato ausente');
    const [rows] = await connection.query(queries[name]);
    contract[name] = JSON.parse(JSON.stringify(rows));
  }
  validar(contract);
  return contract;
}
export function compararContratoBase(expected, actual) {
  validar(expected);
  validar(actual);
  for (const name of names) {
    // Comparación estricta independiente del orden de propiedades, pero no de filas.
    const canonical = rows => rows.map(row => fields[name].map(key => row[key]));
    if (JSON.stringify(canonical(expected[name])) !== JSON.stringify(canonical(actual[name]))) throw Error(`DETENER: contrato base incompatible en ${name}`);
  }
  return true;
}
