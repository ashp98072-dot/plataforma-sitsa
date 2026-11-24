import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ acceso: vi.fn(), salida: vi.fn(), reverso: vi.fn() }));
vi.mock('@/lib/canecas/acceso', () => ({ accesoCanecas: m.acceso }));
vi.mock('@/lib/canecas/salidas-fifo', () => ({ registrarSalidaFifo: m.salida, reversarSalidaFifo: m.reverso }));
vi.mock('@/lib/db', () => ({ getPool: () => ({}), query: vi.fn() }));
import { POST } from '@/app/api/empresas/[slug]/canecas/[recurso]/route';
const ctx = (recurso: string) => ({ params: Promise.resolve({ slug: 'uno', recurso }) });
describe('permisos de salida FIFO', () => {
  beforeEach(() => { vi.clearAllMocks(); m.acceso.mockResolvedValue({ empresa: { id: 5 }, session: { id: 7 } }); });
  it('exige permisos de confirmar y costos y entrega identidad al servicio', async () => {
    m.salida.mockResolvedValue({ id: '1', costoCentavos: '400', moneda: 'GTQ' });
    const req = new Request('http://local', { method: 'POST', body: JSON.stringify({ producto_id: 2, ubicacion_id: 3, cantidad: 3, documento: 'S', clave_operacion: '00000000-0000-4000-8000-000000000001' }) });
    expect((await POST(req, ctx('salidas'))).status).toBe(200);
    expect(m.acceso.mock.calls.map(x => x[1])).toEqual(['confirmar', 'compras']);
    expect(m.salida).toHaveBeenCalledWith({}, 5, 7, expect.objectContaining({ productoId: 2, cantidad: 3 }));
  });
  it('rechaza antes de escribir si falta permiso de costos', async () => {
    m.acceso.mockResolvedValueOnce({ empresa: { id: 5 }, session: { id: 7 } }).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) });
    const req = new Request('http://local', { method: 'POST', body: '{}' });
    expect((await POST(req, ctx('reversar_salida'))).status).toBe(403);
    expect(m.reverso).not.toHaveBeenCalled();
  });
});
