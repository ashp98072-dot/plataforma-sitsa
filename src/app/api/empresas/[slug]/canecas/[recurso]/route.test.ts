import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acceso: vi.fn(), query: vi.fn(), confirmar: vi.fn() }));
vi.mock("@/lib/canecas/acceso", () => ({ accesoCanecas: mocks.acceso }));
vi.mock("@/lib/canecas/confirmar", () => ({ confirmarRecepcion: mocks.confirmar }));
vi.mock("@/lib/db", () => ({ getPool: () => ({}), query: mocks.query }));
vi.mock("@/lib/compras/proveedores", () => ({ guardarProveedor: vi.fn(), ErrorProveedorDuplicado: class extends Error {} }));
import { GET, POST } from "./route";
const ctx = (recurso: string) => ({params:Promise.resolve({slug:"uno",recurso})});
describe("API de Canecas", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.acceso.mockResolvedValue({empresa:{id:5},session:{id:7,username:"u"}}); });
  it("limita la lectura a la empresa autorizada", async () => {
    mocks.query.mockResolvedValue([]);
    expect((await GET(new Request("http://local"),ctx("inventario"))).status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual([5]);
  });
  it("deniega antes de consultar si no existe autorización", async () => {
    mocks.acceso.mockResolvedValue({error:new Response(null,{status:403})});
    expect((await GET(new Request("http://local"),ctx("inventario"))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("valida la confirmación y pasa empresa y actor al servicio", async () => {
    mocks.confirmar.mockResolvedValue({yaConfirmada:false});
    const req = new Request("http://local",{method:"POST",body:JSON.stringify({id:2})});
    expect((await POST(req,ctx("confirmar"))).status).toBe(200);
    expect(mocks.acceso).toHaveBeenCalledWith("uno","confirmar");
    expect(mocks.confirmar).toHaveBeenCalledWith({},5,2,7);
  });
  it("rechaza cantidades inválidas", async () => {
    const req = new Request("http://local",{method:"POST",body:JSON.stringify({compra_id:1,ubicacion_id:1,recibido_por_empleado_id:1,cantidad:0,clave_operacion:"invalid"})});
    expect((await POST(req,ctx("recepciones"))).status).toBe(400);
  });
});
