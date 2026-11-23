import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ evidence: null as string | null }));
vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, readFileSync: (...args: Parameters<typeof original.readFileSync>) => {
    if (String(args[0]).includes('contrato-base-hostinger-validado.json')) {
      if (state.evidence === null) throw Object.assign(new Error('ausente'), { code: 'ENOENT' });
      return state.evidence;
    }
    return original.readFileSync(...args);
  } };
});
import { ejecutarCostosControlado, verificarContratoBaseReal } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

const tables = ['empresas', 'usuarios', 'canecas_productos', 'canecas_ubicaciones', 'canecas_saldos', 'canecas_compras', 'canecas_recepciones', 'canecas_movimientos'];
function fixture() {
  return {
    tablas: tables.map(TABLE_NAME => ({ TABLE_NAME, TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_unicode_ci', CREATE_OPTIONS: '' })),
    columnas: tables.map(TABLE_NAME => ({ TABLE_NAME, ORDINAL_POSITION: 1, COLUMN_NAME: 'id', COLUMN_TYPE: 'int unsigned', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '', CHARACTER_SET_NAME: null, COLLATION_NAME: null, GENERATION_EXPRESSION: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0, DATETIME_PRECISION: null, CHARACTER_MAXIMUM_LENGTH: null })),
    indices: tables.map(TABLE_NAME => ({ TABLE_NAME, INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: 'id', SUB_PART: null, INDEX_TYPE: 'BTREE', COLLATION: 'A', NULLABLE: '', IGNORED: 'NO' })),
    foraneas: [{ TABLE_NAME: 'usuarios', CONSTRAINT_NAME: 'fk', ORDINAL_POSITION: 1, POSITION_IN_UNIQUE_CONSTRAINT: 1, COLUMN_NAME: 'id', REFERENCED_TABLE_SCHEMA: 'lab', REFERENCED_TABLE_NAME: 'empresas', REFERENCED_COLUMN_NAME: 'id', UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' }],
    checks: [{ TABLE_NAME: 'usuarios', CONSTRAINT_NAME: 'chk', CHECK_CLAUSE: 'id > 0' }],
  };
}
function connection(actual = fixture(), base = 'lab') {
  const responses = [[{ base }], actual.tablas, actual.columnas, actual.indices, actual.foraneas, actual.checks];
  return { query: vi.fn(async (sql: string) => { void sql; return [responses.shift(), []]; }) };
}
describe('contrato real antes de DDL', () => {
  it('rechaza evidencia ausente o inválida antes de consultar metadatos', async () => {
    const c = connection();
    state.evidence = null;
    await expect(verificarContratoBaseReal(c)).rejects.toThrow('pendiente o inválido');
    state.evidence = '{';
    await expect(verificarContratoBaseReal(c)).rejects.toThrow('pendiente o inválido');
    expect(c.query).not.toHaveBeenCalled();
  });
  it('compara todas las secciones en la misma conexión para la base exacta', async () => {
    state.evidence = JSON.stringify({ formato: 1, base: 'lab', contrato: fixture() });
    const c = connection();
    await expect(verificarContratoBaseReal(c)).resolves.toBeUndefined();
    expect(c.query).toHaveBeenCalledTimes(6);
    expect(c.query.mock.calls.every(([sql]) => String(sql).trimStart().startsWith('SELECT'))).toBe(true);
  });
  it('rechaza base distinta y divergencias aunque los conteos coincidan', async () => {
    state.evidence = JSON.stringify({ formato: 1, base: 'lab', contrato: fixture() });
    const wrong = connection(fixture(), 'otra');
    await expect(verificarContratoBaseReal(wrong)).rejects.toThrow('base distinta');
    expect(wrong.query).toHaveBeenCalledTimes(1);
    const actual = fixture();
    actual.columnas[0].COLUMN_TYPE = 'int';
    await expect(verificarContratoBaseReal(connection(actual))).rejects.toThrow('columnas');
    actual.columnas.pop();
    await expect(verificarContratoBaseReal(connection(actual))).rejects.toThrow('incompletas');
  });
  it('detiene el instalador antes del DDL si el contrato difiere', async () => {
    state.evidence = JSON.stringify({ formato: 1, base: 'lab', contrato: fixture() });
    const actual = fixture();
    actual.columnas[0].COLUMN_TYPE = 'int';
    const sections = [actual.tablas, actual.columnas, actual.indices, actual.foraneas, actual.checks];
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SELECT DATABASE() AS base') return [[{ base: 'lab' }], []];
      if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [[{ grant: 'GRANT ALL PRIVILEGES ON `lab`.* TO `test`@`localhost`' }], []];
      if (sql.includes('GET_LOCK')) return [[{ adquirido: 1 }], []];
      if (sql.includes('RELEASE_LOCK')) return [[{ liberado: 1 }], []];
      if (sql.includes('AS modo, @@SESSION.innodb_strict_mode')) return [[{ modo: 'STRICT_TRANS_TABLES', innodb: 1 }], []];
      if (sql === 'SELECT @@SESSION.sql_mode AS modo') return [[{ modo: 'STRICT_TRANS_TABLES' }], []];
      if (sql === 'SELECT @@SESSION.innodb_strict_mode AS activo') return [[{ activo: 1 }], []];
      if (sql.startsWith('SET SESSION')) return [[], []];
      if (sql.startsWith('-- BORRADOR SOLO LECTURA')) return [[Array.from({ length: 20 }, () => ({ resultado: 'REVISAR' })), ...Array.from({ length: 7 }, () => [])], []];
      if (sql.startsWith('SELECT ') && sql.includes('information_schema.')) return [sections.shift(), []];
      throw Error('Consulta inesperada');
    });
    await expect(ejecutarCostosControlado({ query })).rejects.toThrow('columnas');
    expect(query.mock.calls.some(([sql]) => /^\s*(ALTER|CREATE|DROP)\b/i.test(sql))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('RELEASE_LOCK'))).toBe(true);
  });
});

