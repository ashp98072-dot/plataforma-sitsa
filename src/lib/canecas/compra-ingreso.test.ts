import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ confirmar: vi.fn(), producto: vi.fn(), numero: vi.fn(), asegurar: vi.fn() }));
vi.mock('./confirmar', () => ({ confirmarRecepcionEnTransaccion: mocks.confirmar }));
vi.mock('./simplificacion', async orig => ({ ...(await orig<typeof import('./simplificacion')>()), productoUnico: mocks.producto, siguienteNumero: mocks.numero, asegurarSecuencias: mocks.asegurar }));
import { registrarCompraConIngreso } from './compra-ingreso';
import { claveDerivada } from './simplificacion';

const K = '00000000-0000-4000-8000-000000000001';
const datos = { proveedorId: 2, ubicacionId: 3, recibidoPorEmpleadoId: 4, cantidad: 10, precio: '80.50', claveOperacion: K };
type Estado = { compra?: Record<string, unknown>; recepcion?: Record<string, unknown>; activos?: boolean; dupEnInsert?: boolean };
const RECEPCION_OK = { id: 200, compra_id: 100, ubicacion_id: 3, recibido_por_empleado_id: 4, cantidad: 10, estado: 'CONFIRMADA' };
const COMPRA_OK = { id: 100, referencia: 'COMP-000001', canecas_proveedor_id: 2, cantidad: 10, precio: '8050' };
function pool(e: Estado) {
  const conn = {
    query: vi.fn(async (...args: unknown[]) => {
      const sql = String(args[0]);
      if (sql.includes('FROM canecas_compras WHERE empresa_id=? AND clave_operacion')) return [e.compra ? [e.compra] : [], []];
      if (sql.includes('FROM canecas_recepciones WHERE empresa_id=? AND clave_operacion')) return [e.recepcion ? [e.recepcion] : [], []];
      if (/LOCK IN SHARE MODE/.test(sql)) return [e.activos === false ? [] : [{ id: 1 }], []];
      return [[], []];
    }),
    execute: vi.fn(async (...args: unknown[]) => {
      const sql = String(args[0]);
      if (e.dupEnInsert && sql.includes('INSERT INTO canecas_compras')) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      return [{ insertId: sql.includes('canecas_compras') ? 100 : 200 }, []];
    }),
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  return { pool: { getConnection: async () => conn } as never, conn };
}
beforeEach(() => { vi.clearAllMocks(); mocks.producto.mockResolvedValue(7); mocks.numero.mockResolvedValue('COMP-000001'); mocks.confirmar.mockResolvedValue({ yaConfirmada: false }); });

describe('registrarCompraConIngreso (una sola transacción)', () => {
  it('crea compra con número automático y costo GTQ, recepción con bodega y receptor explícitos y confirma, todo en una transacción', async () => {
    const { pool: p, conn } = pool({});
    const r = await registrarCompraConIngreso(p, 1, 9, datos);
    expect(r).toMatchObject({ id: 100, referencia: 'COMP-000001', recepcionId: 200, total: 'Q 805.00', yaRegistrada: false });
    expect(mocks.asegurar).toHaveBeenCalledWith(p, 1);
    const compra = conn.execute.mock.calls.find(c => String(c[0]).includes('INSERT INTO canecas_compras'))!;
    expect(compra[1]).toEqual([1, 2, 7, 10, 'COMP-000001', K, 9, '8050']);
    expect(String(compra[0])).toContain("0,'GTQ'");
    const rec = conn.execute.mock.calls.find(c => String(c[0]).includes('INSERT INTO canecas_recepciones'))!;
    expect(rec[1]).toEqual([1, 100, 3, 4, 10, claveDerivada(K, 'recepcion'), 9]);
    expect(mocks.confirmar).toHaveBeenCalledWith(conn, 1, 200, 9); // la confirmación usa la MISMA conexión/transacción
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });
  it('si la confirmación falla se revierte todo: no queda compra ni recepción a medias', async () => {
    mocks.confirmar.mockRejectedValue(new Error('SALDO_EXCEDE_LIMITE'));
    const { pool: p, conn } = pool({});
    await expect(registrarCompraConIngreso(p, 1, 9, datos)).rejects.toThrow('SALDO_EXCEDE_LIMITE');
    expect(conn.commit).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it('un reintento idéntico devuelve la compra ya confirmada sin insertar ni confirmar de nuevo', async () => {
    const { pool: p, conn } = pool({ compra: COMPRA_OK, recepcion: RECEPCION_OK });
    const r = await registrarCompraConIngreso(p, 1, 9, datos);
    expect(r).toMatchObject({ id: 100, referencia: 'COMP-000001', recepcionId: 200, yaRegistrada: true });
    expect(conn.execute).not.toHaveBeenCalled(); expect(mocks.numero).not.toHaveBeenCalled(); expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it.each([
    ['proveedor', { ...COMPRA_OK, canecas_proveedor_id: 9 }, RECEPCION_OK], ['cantidad', { ...COMPRA_OK, cantidad: 11 }, RECEPCION_OK], ['precio', { ...COMPRA_OK, precio: '9999' }, RECEPCION_OK],
    ['bodega', COMPRA_OK, { ...RECEPCION_OK, ubicacion_id: 99 }], ['receptor', COMPRA_OK, { ...RECEPCION_OK, recibido_por_empleado_id: 99 }], ['cantidad recibida', COMPRA_OK, { ...RECEPCION_OK, cantidad: 9 }],
    ['recepción ajena', COMPRA_OK, { ...RECEPCION_OK, compra_id: 555 }], ['recepción sin confirmar', COMPRA_OK, { ...RECEPCION_OK, estado: 'BORRADOR' }], ['compra sin recepción (histórica)', COMPRA_OK, undefined],
  ])('la misma clave con otra identidad se rechaza: %s', async (_n, compra, recepcion) => {
    await expect(registrarCompraConIngreso(pool({ compra, recepcion }).pool, 1, 9, datos)).rejects.toThrow('CLAVE_REUTILIZADA');
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it('una carrera por la misma clave (clave duplicada al insertar) se resuelve como reintento idempotente', async () => {
    const { pool: p, conn } = pool({ dupEnInsert: true });
    // Tras perder la carrera, la compra ganadora ya es visible: el reintento la encuentra y la devuelve sin duplicar.
    let intentos = 0;
    conn.query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0]);
      if (sql.includes('FROM canecas_compras WHERE empresa_id=? AND clave_operacion')) return [intentos++ > 0 ? [COMPRA_OK] : [], []];
      if (sql.includes('FROM canecas_recepciones WHERE empresa_id=? AND clave_operacion')) return [[RECEPCION_OK], []];
      if (/LOCK IN SHARE MODE/.test(sql)) return [[{ id: 1 }], []];
      return [[], []];
    });
    const r = await registrarCompraConIngreso(p, 1, 9, datos);
    expect(r).toMatchObject({ id: 100, yaRegistrada: true });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it('si la clave duplicada persiste no se reintenta indefinidamente: se propaga el error', async () => {
    const { pool: p, conn } = pool({ dupEnInsert: true });
    await expect(registrarCompraConIngreso(p, 1, 9, datos)).rejects.toThrow('dup');
    expect(conn.beginTransaction).toHaveBeenCalledTimes(2); // intento original + un único reintento
  });
  it('rechaza proveedor, bodega o empleado inactivos o de otra empresa sin crear nada', async () => {
    const { pool: p, conn } = pool({ activos: false });
    await expect(registrarCompraConIngreso(p, 1, 9, datos)).rejects.toThrow('REFERENCIA_INVALIDA');
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalled(); expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it.each([{ precio: '0' }, { precio: '-1' }, { precio: 'abc' }, { precio: '1.234' }, { cantidad: 0 }, { cantidad: 1.5 }, { proveedorId: 0 }, { ubicacionId: 0 }, { recibidoPorEmpleadoId: 0 }, { claveOperacion: 'no' }])('valida la entrada antes de tocar la base: %j', async cambio => {
    const { pool: p, conn } = pool({});
    await expect(registrarCompraConIngreso(p, 1, 9, { ...datos, ...cambio })).rejects.toThrow(/COMPRA_INVALIDA|VENTA_INVALIDA/);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it('una falla en el producto único revierte y no confirma nada', async () => {
    mocks.producto.mockRejectedValue(new Error('PRODUCTO_AMBIGUO'));
    const { pool: p, conn } = pool({});
    await expect(registrarCompraConIngreso(p, 1, 9, datos)).rejects.toThrow('PRODUCTO_AMBIGUO');
    expect(conn.rollback).toHaveBeenCalled(); expect(mocks.confirmar).not.toHaveBeenCalled();
  });
});
