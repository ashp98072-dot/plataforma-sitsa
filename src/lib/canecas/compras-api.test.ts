import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ acceso: vi.fn(), compra: vi.fn() }));
vi.mock('@/lib/canecas/acceso', () => ({ accesoCanecas: mocks.acceso }));
vi.mock('@/lib/db', () => ({ getPool: () => ({ marca: 'pool' }), query: vi.fn() }));
vi.mock('@/lib/canecas/compra-ingreso', () => ({ registrarCompraConIngreso: mocks.compra }));
import { POST } from '@/app/api/empresas/[slug]/canecas/[recurso]/route';
const ctx = (recurso: string) => ({ params: Promise.resolve({ slug: 'uno', recurso }) });
const sesion = { empresa: { id: 5 }, session: { id: 7, username: 'u' } };
const k = 'a0000000-0000-4000-8000-000000000001';
const compra = { proveedor_id: 2, ubicacion_id: 3, recibido_por_empleado_id: 4, cantidad: 10, precio_compra: '80.50', clave_operacion: k };
const post = (cuerpo: unknown) => POST(new Request('http://local', { method: 'POST', body: JSON.stringify(cuerpo) }), ctx('compras'));

describe('API de compras con ingreso', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.acceso.mockResolvedValue(sesion); mocks.compra.mockResolvedValue({ id: 100, referencia: 'COMP-000001', total: 'Q 805.00', yaRegistrada: false }); });
  it('registra con empresa y usuario de la sesión y devuelve número automático', async () => {
    const res = await post(compra);
    expect(res.status).toBe(201);
    expect(mocks.compra).toHaveBeenCalledWith({ marca: 'pool' }, 5, 7, { proveedorId: 2, ubicacionId: 3, recibidoPorEmpleadoId: 4, cantidad: 10, precio: '80.50', claveOperacion: k });
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
  it('un reintento ya registrado responde 200 y los errores internos no se exponen', async () => {
    mocks.compra.mockResolvedValueOnce({ id: 100, referencia: 'COMP-000001', total: 'Q 805.00', yaRegistrada: true });
    expect((await post(compra)).status).toBe(200);
    mocks.compra.mockRejectedValueOnce(new Error('ER_SECRETO'));
    const res = await post(compra);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('ER_SECRETO');
  });
});
