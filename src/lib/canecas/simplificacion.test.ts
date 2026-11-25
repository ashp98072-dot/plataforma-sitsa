import { describe, expect, it, vi } from 'vitest';
import { claveDerivada, fechaHoyGuatemala, productoUnico, siguienteNumero } from './simplificacion';

type Fn = (sql: string, params?: unknown[]) => unknown;
const conexion = (handler: Fn) => ({ query: vi.fn(async (s: string, p?: unknown[]) => handler(s, p)), execute: vi.fn(async (s: string, p?: unknown[]) => handler(s, p)) }) as never;

describe('fechaHoyGuatemala', () => {
  it('usa la fecha de Guatemala (UTC-6) y no la de UTC', () => {
    expect(fechaHoyGuatemala(new Date('2026-11-25T03:30:00Z'))).toBe('2026-11-24'); // 21:30 del 24 en Guatemala
    expect(fechaHoyGuatemala(new Date('2026-11-25T06:00:00Z'))).toBe('2026-11-25');
  });
});

describe('claveDerivada', () => {
  const k = '00000000-0000-4000-8000-000000000001';
  it('es determinista, distinta por sufijo y con formato UUID', () => {
    expect(claveDerivada(k, 'recepcion')).toBe(claveDerivada(k, 'recepcion'));
    expect(claveDerivada(k, 'recepcion')).not.toBe(claveDerivada(k, 'otra'));
    expect(claveDerivada(k, 'recepcion')).not.toBe(claveDerivada('00000000-0000-4000-8000-000000000002', 'recepcion'));
    expect(claveDerivada(k, 'recepcion')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('siguienteNumero', () => {
  it('incrementa el contador de la empresa en una sola sentencia atómica y da formato con prefijo', async () => {
    const c = conexion(s => s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: '7' }], []] : [{}, []]);
    expect(await siguienteNumero(c, 3, 'VENTA')).toBe('VTA-000007');
    const sentencia = (c as unknown as { execute: { mock: { calls: [string, unknown[]][] } } }).execute.mock.calls[0];
    expect(sentencia[0]).toMatch(/ON DUPLICATE KEY UPDATE ultimo=LAST_INSERT_ID\(ultimo\+1\)/);
    expect(sentencia[1]).toEqual([3, 'VENTA']);
  });
  it('usa prefijos distintos por tipo y rechaza entradas inválidas', async () => {
    const c = conexion(s => s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: 1 }], []] : [{}, []]);
    expect(await siguienteNumero(c, 1, 'COMPRA')).toBe('COMP-000001');
    expect(await siguienteNumero(c, 1, 'PRODUCTO')).toBe('CAN-000001');
    await expect(siguienteNumero(c, 0, 'VENTA')).rejects.toThrow('SECUENCIA_INVALIDA');
    await expect(siguienteNumero(c, 1, 'OTRO' as never)).rejects.toThrow('SECUENCIA_INVALIDA');
    await expect(siguienteNumero(conexion(s => s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: 0 }], []] : [{}, []]), 1, 'VENTA')).rejects.toThrow('SECUENCIA_INVALIDA');
  });
});

describe('productoUnico', () => {
  it('devuelve el único producto activo sin crear nada', async () => {
    const c = conexion(() => [[{ id: 9, activo: 1 }], []]);
    expect(await productoUnico(c, 1)).toBe(9);
    expect((c as unknown as { execute: { mock: { calls: unknown[] } } }).execute.mock.calls).toHaveLength(0);
  });
  it('se detiene con varios activos o solo inactivos: no elige por el usuario', async () => {
    await expect(productoUnico(conexion(() => [[{ id: 1, activo: 1 }, { id: 2, activo: 1 }], []]), 1)).rejects.toThrow('PRODUCTO_AMBIGUO');
    await expect(productoUnico(conexion(() => [[{ id: 1, activo: 0 }], []]), 1)).rejects.toThrow('PRODUCTO_INACTIVO');
  });
  it('si la empresa no tiene caneca la crea con código automático', async () => {
    const c = conexion(s => s.startsWith('SELECT id,activo') ? [[], []] : s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: 1 }], []] : s.startsWith('INSERT INTO canecas_productos') ? [{ insertId: 55 }, []] : [{}, []]);
    expect(await productoUnico(c, 4)).toBe(55);
    const insert = (c as unknown as { execute: { mock: { calls: [string, unknown[]][] } } }).execute.mock.calls.find(x => x[0].startsWith('INSERT INTO canecas_productos'))!;
    expect(insert[1]).toEqual([4, 'CAN-000001']);
  });
  it('ante una creación concurrente duplicada reutiliza la caneca ya creada', async () => {
    let selects = 0;
    const c = conexion(s => {
      if (s.startsWith('SELECT id,activo')) { selects++; return [[], []]; }
      if (s.startsWith('SELECT LAST_INSERT_ID')) return [[{ n: 2 }], []];
      if (s.startsWith('INSERT INTO canecas_productos')) throw Object.assign(Error('dup'), { code: 'ER_DUP_ENTRY' });
      if (s.startsWith('SELECT id FROM canecas_productos')) return [[{ id: 31 }], []];
      return [{}, []];
    });
    expect(await productoUnico(c, 1)).toBe(31);
    expect(selects).toBe(1);
  });
});
