import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ acceso: vi.fn(), compra: vi.fn(), producto: vi.fn(), asegurar: vi.fn(), pool: { getConnection: vi.fn() } }));
vi.mock('@/lib/canecas/acceso', () => ({ accesoCanecas: mocks.acceso }));
vi.mock('@/lib/db', () => ({ getPool: () => ({ marca: 'pool', getConnection: mocks.pool.getConnection }), query: vi.fn() }));
vi.mock('@/lib/canecas/simplificacion', () => ({ productoUnico: mocks.producto, asegurarSecuencias: mocks.asegurar }));
vi.mock('@/lib/canecas/compra-ingreso', () => ({ registrarCompraConIngreso: mocks.compra }));
import { POST } from '@/app/api/empresas/[slug]/canecas/[recurso]/route';
const ctx = (recurso: string) => ({ params: Promise.resolve({ slug: 'uno', recurso }) });
const sesion = { empresa: { id: 5 }, session: { id: 7, username: 'u' } };
const k = 'a0000000-0000-4000-8000-000000000001';
const compra = { proveedor_id: 2, ubicacion_id: 3, recibido_por_empleado_id: 4, cantidad: 10, precio_compra: '80.50', clave_operacion: k };
const post = (cuerpo: unknown, recurso = 'compras_ingreso') => POST(new Request('http://local', { method: 'POST', body: JSON.stringify(cuerpo) }), ctx(recurso));

describe('API de compras con ingreso (recurso nuevo compras_ingreso)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.acceso.mockResolvedValue(sesion); mocks.compra.mockResolvedValue({ id: 100, referencia: 'COMP-000001', total: 'Q 805.00', yaRegistrada: false }); });
  it('registra con empresa y usuario de la sesión y devuelve número automático', async () => {
    const res = await post(compra);
    expect(res.status).toBe(201);
    expect(mocks.compra).toHaveBeenCalledWith(expect.objectContaining({ marca: 'pool' }), 5, 7, { proveedorId: 2, ubicacionId: 3, recibidoPorEmpleadoId: 4, cantidad: 10, precio: '80.50', claveOperacion: k });
    expect(await res.json()).toMatchObject({ id: 100, referencia: 'COMP-000001', total: 'Q 805.00' });
  });
  it('exige permisos de compras, recepción y confirmación (mover inventario no se concede solo con compras)', async () => {
    await post(compra);
    expect(mocks.acceso.mock.calls.map(c => c[1])).toEqual(['compras', 'recepciones', 'confirmar']);
    mocks.compra.mockClear();
    mocks.acceso.mockReset().mockResolvedValueOnce(sesion).mockResolvedValueOnce(sesion).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) });
    expect((await post(compra)).status).toBe(403);
    expect(mocks.compra).toHaveBeenCalledTimes(0);
  });
  it.each([{ referencia: 'X' }, { producto_id: 3 }, { gastos_adquisicion: '1' }, { empresa_id: 9 }, { moneda: 'USD' }, { precio_compra: '' }, { cantidad: 0 }, { ubicacion_id: undefined }])('rechaza campos que no corresponden o inválidos: %j', async extra => {
    expect((await post({ ...compra, ...extra })).status).toBe(400);
    expect(mocks.compra).not.toHaveBeenCalled();
  });
  it('la ruta histórica compras conserva su contrato (no la reemplaza el recurso nuevo)', async () => {
    const historica = { proveedor_id: 2, producto_id: 3, cantidad: 10, referencia: 'FAC-1', clave_operacion: k, precio_compra: '80.50' };
    // El esquema nuevo rechaza el histórico y el histórico rechaza el nuevo: cada recurso valida lo suyo.
    expect((await post(historica)).status).toBe(400);
    expect((await post(compra, 'compras')).status).toBe(400);
    expect(mocks.compra).not.toHaveBeenCalled();
  });
  it('la caneca única se crea una sola vez desde caneca_unica y la ruta histórica productos conserva su esquema', async () => {
    const conn = { query: vi.fn().mockResolvedValue([[], []]), execute: vi.fn().mockResolvedValue([{}, []]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    mocks.pool.getConnection.mockResolvedValue(conn); mocks.producto.mockResolvedValue(12);
    const res = await post({ precio_venta_referencia: '150.00' }, 'caneca_unica');
    expect(res.status).toBe(201); expect(await res.json()).toEqual({ id: 12 });
    expect(mocks.asegurar).toHaveBeenCalled(); expect(conn.commit).toHaveBeenCalled();
    conn.query.mockResolvedValueOnce([[{ id: 1 }], []]).mockResolvedValueOnce([[{ id: 1 }], []]);
    conn.commit.mockClear();
    expect((await post({ precio_venta_referencia: '' }, 'caneca_unica')).status).toBe(409);
    expect(conn.commit).not.toHaveBeenCalled();
    expect((await post({ codigo: 'A', nombre: 'Aceite' }, 'caneca_unica')).status).toBe(400);
  });
  it('un reintento ya registrado responde 200 y los errores internos no se exponen', async () => {
    mocks.compra.mockResolvedValueOnce({ id: 100, referencia: 'COMP-000001', total: 'Q 805.00', yaRegistrada: true });
    expect((await post(compra)).status).toBe(200);
    mocks.compra.mockRejectedValueOnce(new Error('ER_SECRETO'));
    const res = await post(compra);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('ER_SECRETO');
  });
});
