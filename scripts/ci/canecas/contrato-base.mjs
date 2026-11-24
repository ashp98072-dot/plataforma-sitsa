import { readFileSync } from 'node:fs';
import { checksEquivalentes } from './check-equivalente.mjs';

// La comparación no proporciona ni aprueba un contrato de Hostinger.
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
  if (names.some(name => contract[name].length === 0)) throw Error('DETENER: sección vacía o visibilidad no confirmada');
  for (const table of tables) {
    const columns = contract.columnas.filter(row => row.TABLE_NAME === table);
    if (columns.some((row, i) => Number(row.ORDINAL_POSITION) !== i + 1) || new Set(columns.map(row => row.COLUMN_NAME)).size !== columns.length) throw Error('DETENER: columnas incompletas o contradictorias');
    const indexes = contract.indices.filter(row => row.TABLE_NAME === table);
    if (!indexes.length) throw Error('DETENER: índices incompletos o sin visibilidad');
    for (const name of new Set(indexes.map(row => row.INDEX_NAME))) {
      const parts = indexes.filter(row => row.INDEX_NAME === name);
      if (parts.some((row, i) => Number(row.SEQ_IN_INDEX) !== i + 1 || !columns.some(col => col.COLUMN_NAME === row.COLUMN_NAME) || row.NON_UNIQUE !== parts[0].NON_UNIQUE)) throw Error('DETENER: índice incompleto o contradictorio');
    }
  }
  for (const row of contract.foraneas) {
    if (!contract.columnas.some(col => col.TABLE_NAME === row.TABLE_NAME && col.COLUMN_NAME === row.COLUMN_NAME)) throw Error('DETENER: FK contradictoria con columnas');
  }
  for (const table of tables) {
    const fkRows = contract.foraneas.filter(row => row.TABLE_NAME === table);
    for (const name of new Set(fkRows.map(row => row.CONSTRAINT_NAME))) {
      const parts = fkRows.filter(row => row.CONSTRAINT_NAME === name);
      if (parts.some((row, i) => Number(row.ORDINAL_POSITION) !== i + 1 || ['REFERENCED_TABLE_SCHEMA', 'REFERENCED_TABLE_NAME', 'UPDATE_RULE', 'DELETE_RULE'].some(key => row[key] !== parts[0][key]))) throw Error('DETENER: FK incompleta o contradictoria');
    }
  }
  if (new Set(contract.checks.map(row => JSON.stringify([row.TABLE_NAME, row.CONSTRAINT_NAME]))).size !== contract.checks.length) throw Error('DETENER: CHECK contradictorios');
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
    if (name === 'checks') {
      if (expected.checks.length !== actual.checks.length || expected.checks.some((row, i) => row.TABLE_NAME !== actual.checks[i].TABLE_NAME || row.CONSTRAINT_NAME !== actual.checks[i].CONSTRAINT_NAME || !checksEquivalentes(row.CHECK_CLAUSE, actual.checks[i].CHECK_CLAUSE))) throw Error('DETENER: contrato base incompatible en checks');
      continue;
    }
    // Comparación estricta independiente del orden de propiedades, pero no de filas.
    const canonical = rows => rows.map(row => fields[name].map(key => row[key]));
    if (JSON.stringify(canonical(expected[name])) !== JSON.stringify(canonical(actual[name]))) throw Error(`DETENER: contrato base incompatible en ${name}`);
  }
  return true;
}


