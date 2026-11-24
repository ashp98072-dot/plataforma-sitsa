import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acceso: vi.fn(), query: vi.fn(), confirmar: vi.fn(), valorar: vi.fn(), gasto: vi.fn(), crear: vi.fn(), editar: vi.fn(), estado: vi.fn(), mapear: vi.fn() }));
vi.mock("@/lib/canecas/acceso", () => ({ accesoCanecas: mocks.acceso }));
vi.mock("@/lib/canecas/confirmar", () => ({ confirmarRecepcion: mocks.confirmar }));
vi.mock("@/lib/canecas/valoracion-inicial", () => ({ valorarExistenciaInicial: mocks.valorar }));
vi.mock("@/lib/canecas/gasto-posterior", () => ({ registrarGastoPosterior: mocks.gasto }));
vi.mock("@/lib/db", () => ({ getPool: () => ({}), query: mocks.query }));
vi.mock("@/lib/canecas/catalogos", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/canecas/catalogos")>()), crearCatalogo: mocks.crear, editarCatalogo: mocks.editar, cambiarEstadoCatalogo: mocks.estado, mapearProveedorCompra: mocks.mapear }));
import { ErrorCatalogoDuplicado, ErrorCatalogoNoEncontrado } from "@/lib/canecas/catalogos";
import { GET, PATCH, POST } from "./route";
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
  it("asume GTQ cuando no se envía moneda: el usuario no elige ni escribe el código", async () => {
    mocks.valorar.mockResolvedValue({ok:true});
    const req = new Request("http://local", { method:"POST",body:JSON.stringify({producto_id:2,ubicacion_id:3,cantidad:4,costo:"1.00",documento:"Conteo",motivo:"Saldo",clave_operacion:"a0000000-0000-4000-8000-000000000001"}) });
    expect((await POST(req,ctx("valoracion_inicial"))).status).toBe(200);
    expect(mocks.valorar.mock.calls[0][3]).toMatchObject({ moneda:"GTQ", costoCentavos:BigInt(100) });
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
  describe("catálogos exclusivos de Canecas (proveedores y clientes)", () => {
    const solicitud = (metodo: string, cuerpo: unknown) => new Request("http://local", { method: metodo, body: JSON.stringify(cuerpo) });
    it.each([["proveedores","canecas_proveedores"],["clientes","canecas_clientes"]])("lee %s de su propia tabla y solo de la empresa de la sesión", async (recurso, tabla) => {
      mocks.query.mockResolvedValue([]);
      expect((await GET(new Request("http://local"), ctx(recurso))).status).toBe(200);
      expect(mocks.acceso).toHaveBeenCalledWith("uno", "ver");
      expect(mocks.query.mock.calls[0][0]).toContain(`FROM ${tabla} WHERE empresa_id=?`);
      expect(mocks.query.mock.calls[0][0]).not.toMatch(/compras_proveedores/);
      expect(mocks.query.mock.calls[0][1]).toEqual([5]);
    });
    it.each(["proveedores","clientes"])("%s: crea con la empresa y el usuario de la sesión y exige permiso de catálogo", async recurso => {
      mocks.crear.mockResolvedValue(11);
      const res = await POST(solicitud("POST", { nombre_comercial: "Aceites", nit: "123-4", telefono: "", direccion: "" }), ctx(recurso));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: 11 });
      expect(mocks.acceso).toHaveBeenCalledWith("uno", "catalogo");
      expect(mocks.crear).toHaveBeenCalledWith(expect.anything(), recurso, 5, 7, { nombre_comercial: "Aceites", nit: "123-4", telefono: null, direccion: null });
    });
    it("no confía en la empresa ni en el usuario enviados por el cliente", async () => {
      for (const extra of [{ empresa_id: 99 }, { creado_por: 99 }, { moneda: "USD" }]) expect((await POST(solicitud("POST", { nombre_comercial: "X", ...extra }), ctx("clientes"))).status).toBe(400);
      expect(mocks.crear).not.toHaveBeenCalled();
    });
    it.each([["POST"],["PATCH"]])("%s: deniega sin permiso de catálogo y no toca la base", async metodo => {
      mocks.acceso.mockResolvedValue({ error: new Response(null, { status: 403 }) });
      const res = metodo === "POST" ? await POST(solicitud("POST", { nombre_comercial: "X" }), ctx("proveedores")) : await PATCH(solicitud("PATCH", { id: 1, activo: false }), ctx("proveedores"));
      expect(res.status).toBe(403);
      expect(mocks.crear).not.toHaveBeenCalled(); expect(mocks.estado).not.toHaveBeenCalled(); expect(mocks.editar).not.toHaveBeenCalled();
    });
    it.each([["proveedores","nit","proveedor","NIT"],["clientes","nombre","cliente","nombre"]])("%s: un duplicado de %s responde 409 con mensaje propio", async (recurso, campo, palabra, texto) => {
      mocks.crear.mockRejectedValue(new ErrorCatalogoDuplicado(campo as "nit" | "nombre"));
      const res = await POST(solicitud("POST", { nombre_comercial: "Repetido" }), ctx(recurso));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(`Ya existe un ${palabra} de Canecas con ese ${texto}.`);
    });
    it("activa y desactiva con la empresa y el usuario de la sesión", async () => {
      expect((await PATCH(solicitud("PATCH", { id: 3, activo: false }), ctx("clientes"))).status).toBe(200);
      expect(mocks.estado).toHaveBeenCalledWith(expect.anything(), "clientes", 5, 7, 3, false);
      mocks.estado.mockRejectedValueOnce(new ErrorCatalogoNoEncontrado());
      expect((await PATCH(solicitud("PATCH", { id: 4, activo: true }), ctx("clientes"))).status).toBe(404);
    });
    it("edita datos y rechaza cuerpos inválidos o con campos ajenos", async () => {
      expect((await PATCH(solicitud("PATCH", { id: 3, nombre_comercial: "Nuevo nombre", nit: "", telefono: "5555-1111", direccion: "Zona 1" }), ctx("proveedores"))).status).toBe(200);
      expect(mocks.editar).toHaveBeenCalledWith(expect.anything(), "proveedores", 5, 7, 3, { nombre_comercial: "Nuevo nombre", nit: null, telefono: "5555-1111", direccion: "Zona 1" });
      mocks.editar.mockRejectedValueOnce(new ErrorCatalogoDuplicado("nombre"));
      expect((await PATCH(solicitud("PATCH", { id: 3, nombre_comercial: "Repetido" }), ctx("proveedores"))).status).toBe(409);
      for (const cuerpo of [{ id: 3 }, { nombre_comercial: "Sin id" }, { id: 3, nombre_comercial: "A", empresa_id: 9 }, { id: 3, activo: "si" }]) expect((await PATCH(solicitud("PATCH", cuerpo), ctx("proveedores"))).status).toBe(400);
      expect(mocks.editar).toHaveBeenCalledTimes(2);
    });
    it("mapea una compra histórica a un proveedor de Canecas solo con permiso de catálogo", async () => {
      expect((await POST(solicitud("POST", { compra_id: 8, proveedor_id: 2 }), ctx("mapeo_proveedor_compra"))).status).toBe(200);
      expect(mocks.acceso).toHaveBeenCalledWith("uno", "catalogo");
      expect(mocks.mapear).toHaveBeenCalledWith(expect.anything(), 5, 7, 8, 2);
      mocks.mapear.mockRejectedValueOnce(new Error("COMPRA_YA_MAPEADA"));
      expect((await POST(solicitud("POST", { compra_id: 8, proveedor_id: 2 }), ctx("mapeo_proveedor_compra"))).status).toBe(409);
    });
    it("PATCH sigue sin aceptar recursos desconocidos", async () => {
      expect((await PATCH(solicitud("PATCH", { id: 1, activo: true }), ctx("inventario"))).status).toBe(404);
    });
  });
});
