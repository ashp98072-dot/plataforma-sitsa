import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
import { consultarCapasFifo, ORDEN_FIFO, ORDEN_FIFO_ANTERIOR } from './orden-fifo';

const conexion = (query: ReturnType<typeof vi.fn>) => ({ query }) as unknown as PoolConnection;

describe('consultarCapasFifo', () => {
  it('usa el criterio con orden_fifo cuando la columna existe', async () => {
    const query = vi.fn().mockResolvedValue([[{ id: 1 }]]);
    expect(await consultarCapasFifo(conexion(query), o => `SELECT ... ORDER BY ${o}`, [1])).toEqual([{ id: 1 }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toBe(`SELECT ... ORDER BY ${ORDEN_FIFO}`);
  });
  it('cae al criterio anterior solo ante ER_BAD_FIELD_ERROR (esquema sin la migración)', async () => {
    const query = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Unknown column'), { errno: 1054 })).mockResolvedValueOnce([[{ id: 2 }]]);
    expect(await consultarCapasFifo(conexion(query), o => `SELECT ... ORDER BY ${o}`, [1])).toEqual([{ id: 2 }]);
    expect(query.mock.calls[1][0]).toBe(`SELECT ... ORDER BY ${ORDEN_FIFO_ANTERIOR}`);
  });
  it('no oculta otros errores (bloqueos, conexión, sintaxis)', async () => {
    const query = vi.fn().mockRejectedValue(Object.assign(new Error('Deadlock'), { errno: 1213 }));
    await expect(consultarCapasFifo(conexion(query), o => `SELECT ${o}`, [])).rejects.toThrow('Deadlock');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('ambos criterios coinciden mientras no existan capas redistribuidas', () => {
    expect(ORDEN_FIFO).toBe('creado_en,COALESCE(orden_fifo,id),id');
    expect(ORDEN_FIFO_ANTERIOR).toBe('creado_en,id');
  });
});
