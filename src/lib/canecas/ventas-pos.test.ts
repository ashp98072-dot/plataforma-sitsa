import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ salida: vi.fn(), reverso: vi.fn(), producto: vi.fn(), numero: vi.fn(), asegurar: vi.fn() }));
vi.mock('./salidas-fifo', () => ({ ejecutarSalidaFifo: mocks.salida, ejecutarReversoSalidaFifo: mocks.reverso }));
vi.mock('./simplificacion', async orig => ({ ...(await orig<typeof import('./simplificacion')>()), productoUnico: mocks.producto, siguienteNumero: mocks.numero, asegurarSecuencias: mocks.asegurar }));
import { registrarVenta } from './ventas';

const K = '00000000-0000-4000-8000-000000000001';
const dato = { clienteId: 2, ubicacionId: 4, direccionEntrega: ' Zona 4, Ciudad ', cantidad: 8, precio: '95.00', claveOperacion: K };
function pool(previa?: Record<string, unknown>, clienteActivo = 1) {
  let previas = previa ? [previa] : [];
  const conn = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM canecas_ventas WHERE empresa_id=? AND clave_operacion')) return [previas, []];
      if (sql.includes('FROM canecas_clientes')) return [[{ activo: clienteActivo }], []];
      return [[], []];
    }),
    execute: vi.fn(async () => [{ insertId: 77 }, []]),
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  return { pool: { getConnection: async () => conn } as never, conn, fijar: (p: Record<string, unknown>[]) => { previas = p; } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.producto.mockResolvedValue(7); mocks.numero.mockResolvedValue('VTA-000012'); mocks.salida.mockResolvedValue({ id: '5', costoCentavos: '64000', moneda: 'GTQ', yaRegistrada: false }); });

describe('venta POS (registrarVenta)', () => {
  it('usa el producto único, número VTA automático, fecha de hoy y guarda la dirección de entrega; costo FIFO de la salida', async () => {
    const { pool: p, conn } = pool();
    const v = await registrarVenta(p, 1, 9, dato, '2026-11-24');
    expect(v).toMatchObject({ id: '77', documento: 'VTA-000012', total: 'Q 760.00', costo: 'Q 640.00', utilidad: 'Q 120.00', yaRegistrada: false });
    expect(mocks.salida).toHaveBeenCalledWith(conn, 1, 9, { productoId: 7, ubicacionId: 4, cantidad: 8, documento: 'VTA-000012', claveOperacion: K });
    const [sql, params] = conn.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('direccion_entrega');
    expect(params.slice(0, 8)).toEqual([1, 2, 7, 4, 'Zona 4, Ciudad', '2026-11-24', 'VTA-000012', 8]);
    expect(conn.commit).toHaveBeenCalled();
  });
  it('el número se genera antes del bloqueo de inventario y dentro de la misma transacción (mismo orden en toda venta)', async () => {
    const orden: string[] = [];
    mocks.numero.mockImplementation(async () => { orden.push('numero'); return 'VTA-000001'; });
    mocks.salida.mockImplementation(async () => { orden.push('fifo'); return { id: '5', costoCentavos: '0', moneda: 'GTQ', yaRegistrada: false }; });
    await registrarVenta(pool().pool, 1, 9, dato, '2026-11-24');
    expect(orden).toEqual(['numero', 'fifo']);
    expect(mocks.asegurar).toHaveBeenCalledTimes(1);
  });
  it('el código anterior (producto, fecha y documento explícitos, sin dirección) no usa contadores ni la columna nueva', async () => {
    const { pool: p, conn } = pool();
    const v = await registrarVenta(p, 1, 9, { clienteId: 2, productoId: 3, ubicacionId: 4, fechaVenta: '2026-11-10', documento: 'FAC-1', cantidad: 8, precio: '95.00', claveOperacion: K }, '2026-11-24');
    expect(v).toMatchObject({ documento: 'FAC-1', yaRegistrada: false });
    expect(mocks.asegurar).not.toHaveBeenCalled(); expect(mocks.numero).not.toHaveBeenCalled(); expect(mocks.producto).not.toHaveBeenCalled();
    const [sql, params] = conn.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toContain('direccion_entrega');
    expect(params.slice(0, 7)).toEqual([1, 2, 3, 4, '2026-11-10', 'FAC-1', 8]);
    const consultaPrevia = conn.query.mock.calls.map(c => String(c[0])).find(q => q.includes('FROM canecas_ventas WHERE'))!;
    expect(consultaPrevia).not.toContain('direccion_entrega');
  });
  it('un reintento con la misma clave devuelve la misma venta y número sin descontar de nuevo', async () => {
    const { pool: p } = pool({ id: 77, cliente_id: 2, producto_id: 7, ubicacion_id: 4, fecha: '2026-11-24', documento: 'VTA-000012', direccion_entrega: 'Zona 4, Ciudad', cantidad: 8, precio: '9500', total: '76000', costo: '64000' });
    const v = await registrarVenta(p, 1, 9, dato, '2026-11-25');
    expect(v).toMatchObject({ id: '77', documento: 'VTA-000012', yaRegistrada: true });
    expect(mocks.salida).not.toHaveBeenCalled(); expect(mocks.numero).not.toHaveBeenCalled();
  });
  it.each([{ cantidad: 9 }, { direccionEntrega: 'Otra dirección' }, { precio: '96.00' }, { ubicacionId: 5 }, { clienteId: 3 }])('la misma clave con otros datos se rechaza: %j', async cambio => {
    const { pool: p } = pool({ id: 77, cliente_id: 2, producto_id: 7, ubicacion_id: 4, fecha: '2026-11-24', documento: 'VTA-000012', direccion_entrega: 'Zona 4, Ciudad', cantidad: 8, precio: '9500', total: '76000', costo: '64000' });
    await expect(registrarVenta(p, 1, 9, { ...dato, ...cambio }, '2026-11-24')).rejects.toThrow('CLAVE_REUTILIZADA');
  });
  it('si la salida ya existía por una carrera, revierte sin consumir el número y devuelve la venta del ganador', async () => {
    const { pool: p, conn, fijar } = pool();
    mocks.salida.mockImplementation(async () => { fijar([{ id: 88, cliente_id: 2, producto_id: 7, ubicacion_id: 4, fecha: '2026-11-24', documento: 'VTA-000011', direccion_entrega: 'Zona 4, Ciudad', cantidad: 8, precio: '9500', total: '76000', costo: '64000' }]); return { id: '5', costoCentavos: '0', moneda: 'GTQ', yaRegistrada: true }; });
    const v = await registrarVenta(p, 1, 9, dato, '2026-11-24');
    expect(v).toMatchObject({ id: '88', documento: 'VTA-000011', yaRegistrada: true });
    expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
  });
  it.each([{ direccionEntrega: '' }, { direccionEntrega: '   ' }, { direccionEntrega: 'x'.repeat(501) }, { precio: '0' }, { cantidad: 0 }, { claveOperacion: 'x' }])('exige dirección y datos válidos antes de tocar la base: %j', async cambio => {
    const { pool: p, conn } = pool();
    await expect(registrarVenta(p, 1, 9, { ...dato, ...cambio })).rejects.toThrow('VENTA_INVALIDA');
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it('cliente inactivo o de otra empresa: no descuenta inventario ni genera número', async () => {
    const { pool: p, conn } = pool(undefined, 0);
    await expect(registrarVenta(p, 1, 9, dato, '2026-11-24')).rejects.toThrow('CLIENTE_INVALIDO');
    expect(mocks.salida).not.toHaveBeenCalled(); expect(mocks.numero).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalled();
  });
  it('si el FIFO falla (saldo insuficiente) la venta no se inserta y se revierte todo', async () => {
    mocks.salida.mockRejectedValue(new Error('SALDO_INSUFICIENTE'));
    const { pool: p, conn } = pool();
    await expect(registrarVenta(p, 1, 9, dato, '2026-11-24')).rejects.toThrow('SALDO_INSUFICIENTE');
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalled();
  });
});
