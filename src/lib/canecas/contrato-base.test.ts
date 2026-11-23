import { describe, expect, it } from 'vitest';
import { compararContratoBase, obtenerContratoBase } from '../../../scripts/ci/canecas/contrato-base.mjs';

const tables = ['empresas', 'usuarios', 'canecas_productos', 'canecas_ubicaciones', 'canecas_saldos', 'canecas_compras', 'canecas_recepciones', 'canecas_movimientos'];
const fixture = () => ({
  tablas: tables.map(TABLE_NAME => ({ TABLE_NAME, TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_unicode_ci', CREATE_OPTIONS: '' })),
  columnas: tables.map(TABLE_NAME => ({ TABLE_NAME, ORDINAL_POSITION: 1, COLUMN_NAME: 'id', COLUMN_TYPE: 'int unsigned', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '', CHARACTER_SET_NAME: null, COLLATION_NAME: null, GENERATION_EXPRESSION: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0, DATETIME_PRECISION: null, CHARACTER_MAXIMUM_LENGTH: null })),
  indices: tables.map(TABLE_NAME => ({ TABLE_NAME, INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: 'id', SUB_PART: null, INDEX_TYPE: 'BTREE', COLLATION: 'A', NULLABLE: '', IGNORED: 'NO' })),
  foraneas: [{ TABLE_NAME: 'usuarios', CONSTRAINT_NAME: 'fk', ORDINAL_POSITION: 1, POSITION_IN_UNIQUE_CONSTRAINT: 1, COLUMN_NAME: 'id', REFERENCED_TABLE_SCHEMA: 'base', REFERENCED_TABLE_NAME: 'empresas', REFERENCED_COLUMN_NAME: 'id', UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' }],
  checks: [{ TABLE_NAME: 'usuarios', CONSTRAINT_NAME: 'chk', CHECK_CLAUSE: 'id > 0' }],
});
describe('comparación estricta del contrato base', () => {
  it('acepta únicamente secciones completas e idénticas', () => {
    const expected = fixture();
    expect(compararContratoBase(expected, structuredClone(expected))).toBe(true);
    const actual = structuredClone(expected);
    actual.columnas[0].COLUMN_TYPE = 'int';
    expect(() => compararContratoBase(expected, actual)).toThrow('columnas');
    actual.columnas.pop();
    expect(() => compararContratoBase(expected, actual)).toThrow('incompletas');
    expect(() => compararContratoBase(null, expected)).toThrow('incompleto');
  });
  it('rechaza FK sin acciones y checks sin definición', () => {
    const expected = fixture();
    const actual = structuredClone(expected);
    (actual.checks[0] as { CHECK_CLAUSE: string | null }).CHECK_CLAUSE = null;
    expect(() => compararContratoBase(expected, actual)).toThrow('incompletos');
  });
  it('rechaza secciones vacias, indices parciales y FK contradictorias', () => {
    const expected = fixture();
    const empty = structuredClone(expected); empty.indices = [];
    expect(() => compararContratoBase(expected, empty)).toThrow('DETENER');
    const missing = structuredClone(expected); missing.indices.pop();
    expect(() => compararContratoBase(expected, missing)).toThrow('DETENER');
    const contradiction = structuredClone(expected); contradiction.foraneas[0].COLUMN_NAME = 'desconocida';
    expect(() => compararContratoBase(expected, contradiction)).toThrow('FK contradictoria');
  });
  it('propaga errores de visibilidad o consulta sin aceptar un contrato parcial', async () => {
    await expect(obtenerContratoBase({ query: async () => { throw Error('sin visibilidad'); } })).rejects.toThrow('sin visibilidad');
  });
  it('detecta cambios en índices, FK y CHECK', () => {
    const expected = fixture();
    for (const [section, key, value] of [['indices', 'SEQ_IN_INDEX', 2], ['foraneas', 'DELETE_RULE', 'CASCADE'], ['checks', 'CHECK_CLAUSE', 'id >= 0']] as const) {
      const actual = structuredClone(expected);
      (actual[section][0] as Record<string, unknown>)[key] = value;
      expect(() => compararContratoBase(expected, actual)).toThrow('DETENER');
    }
  });
});

