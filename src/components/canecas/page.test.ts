import { beforeEach, describe, expect, it, vi } from "vitest";
const { acceso, redirect, notFound } = vi.hoisted(() => ({ acceso: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect"); }), notFound: vi.fn(() => { throw new Error("notFound"); }) }));
vi.mock("@/lib/canecas/acceso", () => ({ accesoCanecas: acceso }));
vi.mock("next/navigation", () => ({ redirect, notFound }));
import Page from "@/app/e/[slug]/canecas/[[...seccion]]/page";

describe("acceso a la página de Canecas", () => {
  beforeEach(() => vi.clearAllMocks());
  it("deniega la página sin permiso de lectura antes de consultar acciones", async () => {
    acceso.mockResolvedValue({error:{status:403}});
    const result = await Page({params:Promise.resolve({slug:"demo"})});
    expect(acceso).toHaveBeenCalledTimes(1);
    expect(acceso).toHaveBeenCalledWith("demo", "ver", { soloLectura: true });
    expect(result.props.role).toBe("alert");
  });
  it("redirige si la sesión no está autenticada", async () => {
    acceso.mockResolvedValue({error:{status:401}});
    await expect(Page({params:Promise.resolve({slug:"demo"})})).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
  it("transmite los permisos de acciones después de autorizar lectura", async () => {
    acceso.mockImplementation(async (_slug:string, accion:string) => accion === "catalogo" || accion === "confirmar" ? {} : accion === "ver" ? {} : {error:{status:403}});
    const result = await Page({params:Promise.resolve({slug:"demo",seccion:["compras"]})});
    expect(result.props.permisos).toEqual({catalogo:true,compras:false,recepciones:false,confirmar:true,ventas:false});
    expect(acceso).toHaveBeenCalledTimes(6);
    expect(acceso.mock.calls.every(([, , opciones]) => opciones?.soloLectura === true)).toBe(true);
  });
  it.each([["reportes","ventas","ReportesComerciales"],["proveedores-historicos","catalogo","MapeoProveedores"]])("muestra %s solo con el permiso %s", async (seccion, permiso, componente) => {
    acceso.mockImplementation(async (_slug:string, accion:string) => accion === "ver" || accion === permiso ? {} : {error:{status:403}});
    const con = await Page({params:Promise.resolve({slug:"demo",seccion:[seccion]})}) as { type: { name: string } };
    expect(con.type.name).toBe(componente);
    acceso.mockImplementation(async (_slug:string, accion:string) => accion === "ver" ? {} : {error:{status:403}});
    const sin = await Page({params:Promise.resolve({slug:"demo",seccion:[seccion]})}) as { type: string; props: { role: string } };
    expect(sin.type).toBe("p");
    expect(sin.props.role).toBe("alert");
  });
  it("entrega al cliente la empresa y el usuario de la sesión para delimitar las claves de idempotencia", async () => {
    acceso.mockImplementation(async () => ({ session: { id: 77 }, empresa: { id: 5 } }));
    const r = await Page({params:Promise.resolve({slug:"demo",seccion:["compras"]})}) as { props: { empresaId: number; usuarioId: number } };
    expect(r.props).toMatchObject({ empresaId: 5, usuarioId: 77 });
  });
  it.each(["ventas","redistribuciones","proveedores","clientes"])("acepta la sección %s", async seccion => {
    acceso.mockImplementation(async () => ({}));
    const r = await Page({params:Promise.resolve({slug:"demo",seccion:[seccion]})}) as { props: { vista: string } };
    expect(r.props.vista).toBe(seccion);
  });
});
