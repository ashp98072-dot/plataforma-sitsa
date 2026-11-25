import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ confirmar: vi.fn(), producto: vi.fn(), numero: vi.fn() }));
vi.mock('./confirmar', () => ({ confirmarRecepcion: mocks.confirmar }));
vi.mock('./simplificacion', async orig => ({ ...(await orig<typeof import('./simplificacion')>()), productoUnico: mocks.producto, siguienteNumero: mocks.numero }));
import { registrarCompraConIngreso } from './compra-ingreso';
import { claveDerivada } from './simplificacion';

const K = '00000000-0000-4000-8000-000000000001';
const datos = { proveedorId: 2, ubicacionId: 3, recibidoPorEmpleadoId: 4, cantidad: 10, precio: '80.50', claveOperacion: K };
type Estado = { compra?: Record<string, unknown>; recepcion?: Record<string, unknown>; activos?: boolean };
function pool(e: Estado) {
  const log: string[] = [];
  const conn = {
    query: vi.fn(async (...args: unknown[]) => {
      const sql = String(args[0]);
      log.push(sql.split(' ').slice(0, 4).join(' '));
      if (sql.includes('FROM canecas_compras WHERE empresa_id=? AND clave_operacion')) return [e.compra ? [e.compra] : [], []];
      if (sql.includes('FROM canecas_recepciones WHERE empresa_id=? AND clave_operacion')) return [e.recepcion ? [e.recepcion] : [], []];
      if (/LOCK IN SHARE MODE/.test(sql)) return [e.activos === false ? [] : [{ id: 1 }], []];
      return [[], []];
    }),
    execute: vi.fn(async (...args: unknown[]) => { const sql = String(args[0]); log.push(sql.split(' ').slice(0, 3).join(' ')); return [{ insertId: sql.includes('canecas_compras') ? 100 : 200 }, []]; }),
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  return { pool: { getConnection: async () => conn } as never, conn, log };
}
beforeEach(() => { vi.clearAllMocks(); mocks.producto.mockResolvedValue(7); mocks.numero.mockResolvedValue('COMP-000001'); mocks.confirmar.mockResolvedValue({ yaConfirmada: false }); });

describe('registrarCompraConIngreso', () => {
  it('crea compra con número automático y costo GTQ, la recepción total y confirma una vez (único paso que mueve inventario)', async () => {
    const { pool: p, conn } = pool({});
    const r = await registrarCompraConIngreso(p, 1, 9, datos);
    expect(r).toMatchObject({ id: 100, referencia: 'COMP-000001', recepcionId: 200, total: 'Q 805.00', yaRegistrada: false });
    const compra = conn.execute.mock.calls.find(c => String(c[0]).includes('INSERT INTO canecas_compras'))!;
    expect(compra[1]).toEqual([1, 2, 7, 10, 'COMP-000001', K, 9, '8050']); // empresa, proveedor, producto único, cantidad, número, clave, usuario, precio en centavos
    expect(String(compra[0])).toContain("0,'GTQ'");
    const rec = conn.execute.mock.calls.find(c => String(c[0]).includes('INSERT INTO canecas_recepciones'))!;
    expect(rec[1]).toEqual([1, 100, 3, 4, 10, claveDerivada(K, 'recepcion'), 9]);
    expect(mocks.confirmar).toHaveBeenCalledTimes(1);
    expect(mocks.confirmar).toHaveBeenCalledWith(p, 1, 200, 9);
  });
  it('un reintento con la misma clave no duplica compra ni recepción y reutiliza el número', async () => {
    const { pool: p, conn } = pool({ compra: { id: 100, referencia: 'COMP-000001', canecas_proveedor_id: 2, cantidad: 10, precio: '8050' }, recepcion: { id: 200, compra_id: 100, ubicacion_id: 3, recibido_por_empleado_id: 4, cantidad: 10 } });
    mocks.confirmar.mockResolvedValue({ yaConfirmada: true });
    const r = await registrarCompraConIngreso(p, 1, 9, datos);
    expect(r).toMatchObject({ id: 100, referencia: 'COMP-000001', recepcionId: 200, yaRegistrada: true });
    expect(conn.execute).not.toHaveBeenCalled();
    expect(mocks.numero).not.toHaveBeenCalled();
  });
  it('si falló la confirmación, el reintento reutiliza la compra y la recepción y solo confirma', async () => {
    const { pool: p, conn } = pool({ compra: { id: 100, referencia: 'COMP-000001', canecas_proveedor_id: 2, cantidad: 10, precio: '8050' }, recepcion: { id: 200, compra_id: 100, ubicacion_id: 3, recibido_por_empleado_id: 4, cantidad: 10 } });
    await registrarCompraConIngreso(p, 1, 9, datos);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(mocks.confirmar).toHaveBeenCalledTimes(1);
  });
  it('la misma clave con otros datos se rechaza (compra y recepción)', async () => {
    await expect(registrarCompraConIngreso(pool({ compra: { id: 100, referencia: 'X', canecas_proveedor_id: 2, cantidad: 11, precio: '8050' } }).pool, 1, 9, datos)).rejects.toThrow('CLAVE_REUTILIZADA');
    await expect(registrarCompraConIngreso(pool({ compra: { id: 100, referencia: 'X', canecas_proveedor_id: 2, cantidad: 10, precio: '9999' } }).pool, 1, 9, datos)).rejects.toThrow('CLAVE_REUTILIZADA');
    await expect(registrarCompraConIngreso(pool({ compra: { id: 100, referencia: 'X', canecas_proveedor_id: 2, cantidad: 10, precio: '8050' }, recepcion: { id: 200, compra_id: 100, ubicacion_id: 99, recibido_por_empleado_id: 4, cantidad: 10 } }).pool, 1, 9, datos)).rejects.toThrow('CLAVE_REUTILIZADA');
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it('rechaza proveedor, bodega o empleado inactivos o de otra empresa sin crear nada', async () => {
    const { pool: p, conn } = pool({ activos: false });
    await expect(registrarCompraConIngreso(p, 1, 9, datos)).rejects.toThrow('REFERENCIA_INVALIDA');
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalled(); expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it.each([{ precio: '0' }, { precio: '-1' }, { precio: 'abc' }, { precio: '1.234' }, { cantidad: 0 }, { cantidad: 1.5 }, { proveedorId: 0 }, { claveOperacion: 'no' }])('valida la entrada antes de tocar la base: %j', async cambio => {
    const { pool: p, conn } = pool({});
    await expect(registrarCompraConIngreso(p, 1, 9, { ...datos, ...cambio })).rejects.toThrow(/COMPRA_INVALIDA|VENTA_INVALIDA/);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it('una falla en el producto único revierte y no crea recepción ni movimiento', async () => {
    mocks.producto.mockRejectedValue(new Error('PRODUCTO_AMBIGUO'));
    const { pool: p, conn } = pool({});
    await expect(registrarCompraConIngreso(p, 1, 9, datos)).rejects.toThrow('PRODUCTO_AMBIGUO');
    expect(conn.rollback).toHaveBeenCalled(); expect(mocks.confirmar).not.toHaveBeenCalled();
  });
});
