import { describe, expect, it, vi } from 'vitest';
import { asegurarSecuencias, claveDerivada, fechaHoyGuatemala, productoUnico, siguienteNumero } from './simplificacion';

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
  const libre = (n: number | string) => (s: string) => s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n }], []] : s.startsWith('SELECT 1 AS x') ? [[], []] : [{ affectedRows: 1 }, []];
  it('incrementa el contador de la empresa con un UPDATE de bloqueo directo y da formato con prefijo', async () => {
    const c = conexion(libre('7'));
    expect(await siguienteNumero(c, 3, 'VENTA')).toBe('VTA-000007');
    const sentencia = (c as unknown as { execute: { mock: { calls: [string, unknown[]][] } } }).execute.mock.calls[0];
    expect(sentencia[0]).toMatch(/^UPDATE canecas_secuencias SET ultimo=LAST_INSERT_ID\(ultimo\+1\) WHERE empresa_id=\? AND tipo=\?/);
    expect(sentencia[1]).toEqual([3, 'VENTA']);
  });
  it('usa prefijos distintos por tipo y rechaza entradas inválidas o contadores sin inicializar', async () => {
    const c = conexion(libre(1));
    expect(await siguienteNumero(c, 1, 'COMPRA')).toBe('COMP-000001');
    expect(await siguienteNumero(c, 1, 'PRODUCTO')).toBe('CAN-000001');
    await expect(siguienteNumero(c, 0, 'VENTA')).rejects.toThrow('SECUENCIA_INVALIDA');
    await expect(siguienteNumero(c, 1, 'OTRO' as never)).rejects.toThrow('SECUENCIA_INVALIDA');
    await expect(siguienteNumero(conexion(() => [{ affectedRows: 0 }, []]), 1, 'VENTA')).rejects.toThrow('SECUENCIA_NO_INICIALIZADA');
    await expect(siguienteNumero(conexion(libre(0)), 1, 'VENTA')).rejects.toThrow('SECUENCIA_INVALIDA');
  });
  it('un número de más de 6 dígitos conserva todos sus dígitos', async () => {
    expect(await siguienteNumero(conexion(libre(1000000)), 1, 'COMPRA')).toBe('COMP-1000000');
  });
  it('si el candidato ya lo usa un documento de la empresa salta al siguiente y nunca lo repite', async () => {
    let n = 40;
    const consultas: [string, unknown[] | undefined][] = [];
    const c = conexion((s, p) => {
      if (s.startsWith('SELECT LAST_INSERT_ID')) return [[{ n: ++n }], []];
      if (s.startsWith('SELECT 1 AS x')) { consultas.push([s, p]); return [(p as unknown[])[1] === 'COMP-000041' || (p as unknown[])[1] === 'COMP-000042' ? [{ x: 1 }] : [], []]; }
      return [{ affectedRows: 1 }, []];
    });
    expect(await siguienteNumero(c, 9, 'COMPRA')).toBe('COMP-000043');
    expect(consultas.map(x => (x[1] as unknown[])[1])).toEqual(['COMP-000041', 'COMP-000042', 'COMP-000043']);
    expect(consultas[0][0]).toContain('FROM canecas_compras WHERE empresa_id=? AND referencia=?'); // por empresa
  });
  it('consulta la columna correcta de cada tipo', async () => {
    const sqls: string[] = [];
    const c = conexion(s => { if (s.startsWith('SELECT 1 AS x')) sqls.push(s); return s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: 1 }], []] : s.startsWith('SELECT 1 AS x') ? [[], []] : [{ affectedRows: 1 }, []]; });
    await siguienteNumero(c, 1, 'VENTA'); await siguienteNumero(c, 1, 'PRODUCTO');
    expect(sqls[0]).toContain('FROM canecas_ventas WHERE empresa_id=? AND documento=?');
    expect(sqls[1]).toContain('FROM canecas_productos WHERE empresa_id=? AND codigo=?');
  });
  it('se detiene (no entra en un ciclo) si no encuentra un número libre', async () => {
    const c = conexion(s => s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: 1 }], []] : s.startsWith('SELECT 1 AS x') ? [[{ x: 1 }], []] : [{ affectedRows: 1 }, []]);
    await expect(siguienteNumero(c, 1, 'VENTA')).rejects.toThrow('SECUENCIA_SATURADA');
  });
});

describe('asegurarSecuencias', () => {
  it('no hace nada si la empresa ya tiene sus tres contadores', async () => {
    const pool = { query: vi.fn(async () => [[{ n: 3 }], []]) };
    await asegurarSecuencias(pool as never, 5);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('siembra cada contador con el MÁXIMO histórico de la empresa (no con cero) y solo ignora la carrera por la misma fila', async () => {
    const maximos: Record<string, number | null> = { canecas_compras: 30, canecas_ventas: null, canecas_productos: 9 };
    const pool = { query: vi.fn(async (s: string) => {
      if (s.startsWith('SELECT COUNT')) return [[{ n: 0 }], []];
      const tabla = Object.keys(maximos).find(t => s.includes(`FROM ${t} WHERE`));
      return tabla ? [[{ maximo: maximos[tabla] }], []] : [{}, []];
    }) };
    await asegurarSecuencias(pool as never, 5);
    const lecturas = pool.query.mock.calls.filter(c => String(c[0]).startsWith('SELECT MAX')) as unknown as [string, unknown[]][];
    expect(lecturas).toHaveLength(3);
    for (const [sql, params] of lecturas) {
      expect(params).toEqual([5]); // máximo de ESA empresa
      expect(sql).toMatch(/MAX\(CAST\(REGEXP_REPLACE\(UPPER\(TRIM\(/);
      expect(sql).toMatch(/REGEXP '\^(COMP|VTA|CAN)\[ _-\]\?\[0-9\]\{1,15\}\$'/);
      expect(sql).toContain('WHERE empresa_id=?');
    }
    const inserts = pool.query.mock.calls.filter(c => String(c[0]).startsWith('INSERT IGNORE INTO canecas_secuencias')) as unknown as [string, unknown[]][];
    expect(inserts.map(i => i[1])).toEqual([[5, 'COMPRA', 30], [5, 'PRODUCTO', 9], [5, 'VENTA', 0]]); // sin historial = 0; con historial = máximo
    for (const [sql] of inserts) expect(sql).not.toMatch(/\b(SELECT|UPDATE|DELETE)\b/);
  });
  it('un máximo inválido detiene la siembra', async () => {
    const pool = { query: vi.fn(async (s: string) => s.startsWith('SELECT COUNT') ? [[{ n: 0 }], []] : s.startsWith('SELECT MAX') ? [[{ maximo: -1 }], []] : [{}, []]) };
    await expect(asegurarSecuencias(pool as never, 5)).rejects.toThrow('SECUENCIA_INVALIDA');
    expect(pool.query.mock.calls.some(c => String(c[0]).startsWith('INSERT'))).toBe(false);
  });
  it('valida la empresa', async () => {
    await expect(asegurarSecuencias({ query: vi.fn() } as never, 0)).rejects.toThrow('SECUENCIA_INVALIDA');
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
    const c = conexion(s => s.startsWith('SELECT id,activo') ? [[], []] : s.startsWith('SELECT LAST_INSERT_ID') ? [[{ n: 1 }], []] : s.startsWith('INSERT INTO canecas_productos') ? [{ insertId: 55 }, []] : [{ affectedRows: 1 }, []]);
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
      return [{ affectedRows: 1 }, []];
    });
    expect(await productoUnico(c, 1)).toBe(31);
    expect(selects).toBe(1);
  });
});
