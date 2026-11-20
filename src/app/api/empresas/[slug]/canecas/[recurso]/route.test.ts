import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acceso: vi.fn(), query: vi.fn(), confirmar: vi.fn(), valorar: vi.fn(), gasto: vi.fn() }));
vi.mock("@/lib/canecas/acceso", () => ({ accesoCanecas: mocks.acceso }));
vi.mock("@/lib/canecas/confirmar", () => ({ confirmarRecepcion: mocks.confirmar }));
vi.mock("@/lib/canecas/valoracion-inicial", () => ({ valorarExistenciaInicial: mocks.valorar }));
vi.mock("@/lib/canecas/gasto-posterior", () => ({ registrarGastoPosterior: mocks.gasto }));
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
  it.each([["gastos_posteriores","compras"],["valoracion_inventario","compras"],["valoracion_inicial","confirmar"]])('restringe la lectura de %s con permiso %s', async (recurso, permiso) => {
    mocks.acceso.mockResolvedValue({error:new Response(null,{status:403})});
    expect((await GET(new Request("http://local"),ctx(recurso))).status).toBe(403);
    expect(mocks.acceso).toHaveBeenCalledWith("uno",permiso);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("no incluye costos en compras cuando solo hay permiso de lectura", async () => {
    mocks.acceso.mockResolvedValueOnce({empresa:{id:5},session:{id:7,username:"u"}}).mockResolvedValueOnce({error:new Response(null,{status:403})});
    mocks.query.mockResolvedValue([]);
    expect((await GET(new Request("http://local"),ctx("compras"))).status).toBe(200);
    expect(mocks.acceso).toHaveBeenLastCalledWith("uno","compras");
    expect(mocks.query.mock.calls[0][0]).not.toMatch(/precio_unitario_centavos|gastos_centavos|c\.\*/);
    expect(mocks.query.mock.calls[0][1]).toEqual([5]);
  });
  it("no incluye el precio de referencia en el catálogo de solo lectura", async () => {
    mocks.acceso.mockResolvedValueOnce({empresa:{id:5},session:{id:7,username:"u"}}).mockResolvedValueOnce({error:new Response(null,{status:403})}).mockResolvedValueOnce({error:new Response(null,{status:403})});
    mocks.query.mockResolvedValue([]);
    expect((await GET(new Request("http://local"),ctx("productos"))).status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).not.toMatch(/precio_venta_referencia|p\.\*/);
    expect(mocks.query.mock.calls[0][1]).toEqual([5]);
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
  it("no registra litros como unidad de inventario de canecas", async () => {
    const req = new Request("http://local", { method:"POST",body:JSON.stringify({codigo:"A",nombre:"Caneca llena",marca:"",presentacion:"Caneca",capacidad:5,unidad_capacidad:"litros",unidad_inventario:"litros"}) });
    expect((await POST(req,ctx("productos"))).status).toBe(400);
  });
  it("limita la valoración a quien confirma y conserva un costo respaldado", async () => {
    mocks.valorar.mockResolvedValue({ yaRegistrada: false });
    const req = new Request("http://local", { method:"POST",body:JSON.stringify({producto_id:2,ubicacion_id:3,cantidad:4,costo:"1.25",moneda:"GTQ",documento:"Conteo",motivo:"Existencia anterior",clave_operacion:"a0000000-0000-4000-8000-000000000001"}) });
    expect((await POST(req,ctx("valoracion_inicial"))).status).toBe(200);
    expect(mocks.acceso).toHaveBeenCalledWith("uno","confirmar");
    expect(mocks.valorar).toHaveBeenCalledWith({},5,7,expect.objectContaining({costoCentavos:BigInt(125),moneda:'GTQ'}));
  });
  it("recibe un gasto tardío en centavos y exige permiso de compras", async () => {
    mocks.gasto.mockResolvedValue({id:1,yaRegistrado:false});
    const req = new Request("http://local", { method:"POST",body:JSON.stringify({compra_id:2,importe:"1.07",moneda:"GTQ",fecha_documento:"2026-11-20",referencia:"Documento",motivo:"Flete",clave_operacion:"a0000000-0000-4000-8000-000000000001"}) });
    expect((await POST(req,ctx("gastos_posteriores"))).status).toBe(200);
    expect(mocks.acceso).toHaveBeenCalledWith("uno","compras");
    expect(mocks.gasto).toHaveBeenCalledWith({},5,7,expect.objectContaining({importeCentavos:BigInt(107)}));
  });
  it("no acepta costo conocido sin moneda", async () => {
    const req = new Request("http://local", { method:"POST",body:JSON.stringify({producto_id:2,ubicacion_id:3,cantidad:4,costo:"1.00",moneda:"",documento:"Conteo",motivo:"Saldo",clave_operacion:"a0000000-0000-4000-8000-000000000001"}) });
    expect((await POST(req,ctx("valoracion_inicial"))).status).toBe(400);
    expect(mocks.valorar).not.toHaveBeenCalled();
  });
  it("deja el saldo anterior pendiente cuando no se conoce su costo", async () => {
    const req = new Request("http://local", { method:"POST",body:JSON.stringify({producto_id:2,ubicacion_id:3,cantidad:4,costo:"",moneda:"",documento:"Conteo",motivo:"Saldo",clave_operacion:"a0000000-0000-4000-8000-000000000001"}) });
    expect((await POST(req,ctx("valoracion_inicial"))).status).toBe(400);
    expect(mocks.valorar).not.toHaveBeenCalled();
  });
  it.each(["valoracion_inicial", "gastos_posteriores"])('rechaza %s antes de escribir si no hay permiso', async (recurso) => {
    mocks.acceso.mockResolvedValue({error:new Response(null,{status:403})});
    const req = new Request("http://local", { method:"POST",body:"{}" });
    expect((await POST(req,ctx(recurso))).status).toBe(403);
    expect(mocks.valorar).not.toHaveBeenCalled();
    expect(mocks.gasto).not.toHaveBeenCalled();
  });
});
