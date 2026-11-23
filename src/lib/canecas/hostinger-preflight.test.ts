import { describe, expect, it, vi } from 'vitest';
import { ejecutarOperacionesDDL, verificarContratoBaseReal } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

describe('protecciones del instalador FIFO', () => {
  it('bloquea el contrato base aún no evidenciado', () => {
    expect(() => verificarContratoBaseReal()).toThrow('contrato real completo del esquema base pendiente');
  });
  it('conserva causa, código y SQLSTATE e identifica la operación', async () => {
    const cause = Object.assign(new Error('mensaje original'), { code: 'ER_TEST', errno: 1234, sqlState: 'HY000' });
    const query = vi.fn().mockRejectedValue(cause);
    try {
      await ejecutarOperacionesDDL({ query }, ['ALTER TABLE canecas_compras ADD COLUMN x INT']);
      throw Error('debió fallar');
    } catch (error) {
      expect(error).toMatchObject({ cause, code: 'ER_TEST', errno: 1234, sqlState: 'HY000' });
      expect((error as Error).message).toContain('DDL 1/1 (ALTER TABLE canecas_compras): código ER_TEST; SQLSTATE HY000; mensaje original');
      expect((error as Error).message).toContain('instalación parcial');
    }
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('registra advertencias sintéticas y detiene las operaciones siguientes', async () => {
    const query = vi.fn().mockResolvedValueOnce([{}, []]).mockResolvedValueOnce([[{ Level: 'Warning', Code: 123, Message: 'advertencia simulada' }], []]);
    await expect(ejecutarOperacionesDDL({ query }, ['CREATE TABLE ejemplo (id INT)', 'CREATE TABLE otra (id INT)'])).rejects.toThrow('advertencia simulada');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
