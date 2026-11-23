import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { confirmarRecepcion } from './confirmar';

function laboratorio({ confirmada = false, fallaCapa = false } = {}) {
  const conn = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SET ')) return [[]];
      if (sql.startsWith('SELECT compra_id')) return [[{ compra_id: 10 }]];
      if (sql.includes('FROM canecas_compras')) return [[{ id: 10, producto_id: 5, cantidad: 3, referencia: 'X', moneda: 'GTQ', precio_unitario_centavos: '1000', gastos_centavos: '10' }]];
      if (sql.includes('FROM canecas_recepciones') && sql.includes('FOR UPDATE')) return [[{ id: 20, compra_id: 10, ubicacion_id: 7, cantidad: 2, estado: confirmada ? 'CONFIRMADA' : 'BORRADOR' }]];
      if (sql.includes('SUM(cantidad)')) return [[{ total: 0 }]];
      if (sql.includes('FROM canecas_saldos')) return [[{ fisico: 0 }]];
      throw new Error('CONSULTA_INESPERADA');
    }),
    execute: vi.fn(async (sql: string) => {
      if (fallaCapa && sql.includes('INSERT INTO canecas_capas_costo')) throw new Error('FALLO_CAPA');
      return [{}];
    }),
    beginTransaction: vi.fn(async () => undefined), commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined), release: vi.fn(),
  };
  return { conn, pool: { getConnection: async () => conn } as unknown as Pool };
}

describe('confirmar recepción y capas', () => {
  it('registra movimiento y capas en la misma transacción', async () => {
    const { conn, pool } = laboratorio();
    expect(await confirmarRecepcion(pool, 1, 20, 9)).toEqual({ yaConfirmada: false });
    const escrituras = conn.execute.mock.calls.map(([sql]) => sql);
    expect(escrituras.filter(sql => sql.includes('INSERT INTO canecas_movimientos'))).toHaveLength(1);
    expect(escrituras.filter(sql => sql.includes('INSERT INTO canecas_capas_costo'))).toHaveLength(2);
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
  });
  it('no vuelve a registrar saldo ni capas en un reintento confirmado', async () => {
    const { conn, pool } = laboratorio({ confirmada: true });
    expect(await confirmarRecepcion(pool, 1, 20, 9)).toEqual({ yaConfirmada: true });
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it('revierte toda la operación cuando falla la escritura de una capa', async () => {
    const { conn, pool } = laboratorio({ fallaCapa: true });
    await expect(confirmarRecepcion(pool, 1, 20, 9)).rejects.toThrow('FALLO_CAPA');
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
