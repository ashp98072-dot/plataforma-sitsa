import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ obtener: vi.fn(), comparar: vi.fn() }));
vi.mock('../../../scripts/ci/canecas/contrato-base.mjs', () => ({ obtenerContratoBase: mocks.obtener, compararContratoBase: mocks.comparar }));
import { diagnosticar } from '../../../scripts/ci/canecas/diagnostico-contrato-lectura.mjs';

describe('captura FIFO de solo lectura', () => {
  it('recoge identidad, grants y ocho definiciones y compara con el esperado', async () => {
    const contrato = { tablas: [] };
    mocks.obtener.mockResolvedValue(contrato);
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT DATABASE()')) return [[{ base: 'base', sql_mode: 'STRICT_TRANS_TABLES', innodb_strict_mode: 1, foreign_key_checks: 1, check_constraint_checks: 1 }]];
      if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [[{ grant: 'GRANT ALL PRIVILEGES ON `base`.* TO usuario' }]];
      if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': 'CREATE TABLE ejemplo (id int)' }]];
      throw Error('consulta inesperada');
    });
    const esperado = { formato: 1, base: 'base', contrato };
    const result = await diagnosticar({ query }, esperado);
    expect(result.comparacion).toBe('COINCIDE_REQUIERE_REVISION');
    expect(result.comprobaciones).toMatchObject({ privilegios_directos_faltantes: [], restricciones_activas: true, sql_estricto_actual: true, innodb_estricto_actual: true });
    expect(result.definiciones_visibles).toBe(8);
    expect(JSON.stringify(result)).not.toContain('GRANT ALL PRIVILEGES');
    expect(JSON.stringify(result)).not.toContain('CREATE TABLE ejemplo');
    expect(mocks.comparar).toHaveBeenCalledWith(contrato, contrato);
    expect(query.mock.calls.every(([sql]) => /^(SELECT|SHOW)\b/.test(sql))).toBe(true);
  });
  it('rechaza otra base y propaga incompatibilidad', async () => {
    mocks.obtener.mockResolvedValue({});
    const query = vi.fn(async (sql: string) => sql.startsWith('SELECT') ? [[{ base: 'real' }]] : sql.startsWith('SHOW GRANTS') ? [[{ grant: 'GRANT SELECT ON `real`.* TO usuario' }]] : [[{ 'Create Table': 'CREATE TABLE ejemplo (id int)' }]]);
    await expect(diagnosticar({ query }, { formato: 1, base: 'otra', contrato: {} })).rejects.toThrow('base distinta');
    mocks.comparar.mockImplementationOnce(() => { throw Error('DETENER: contrato incompatible'); });
    await expect(diagnosticar({ query }, { formato: 1, base: 'real', contrato: {} })).rejects.toThrow('incompatible');
  });
});
