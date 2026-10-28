import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), crear: vi.fn(), ejercicios: vi.fn(), periodos: vi.fn(), entidades: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCalendario: m.guard }));
vi.mock("@/lib/db", () => ({ getPool: () => { throw Error("Prohibido acceder a la BD de aplicación"); } }));
vi.mock("./entidades", () => ({ listarEntidades: m.entidades }));
vi.mock("./calendario", async (original) => ({ ...(await original<typeof import("./calendario")>()), crearEjercicioConPeriodos: m.crear, listarEjercicios: m.ejercicios, listarPeriodos: m.periodos }));
import { ejerciciosGet, ejerciciosPost, periodosGet, calendarioOpcionesGet } from "./calendario-http";
import { GET, POST } from "@/app/api/empresas/[slug]/contabilidad/ejercicios/route";
import { GET as periodosRoute } from "@/app/api/empresas/[slug]/contabilidad/ejercicios/[id]/periodos/route";
const req = (qs = "entidad=9", body?: unknown) => new Request(`http://local/x?${qs}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 4, username: "actor", rol: "Contabilidad" } });
  m.ejercicios.mockResolvedValue([]); m.periodos.mockResolvedValue([]); m.entidades.mockResolvedValue([]); m.crear.mockResolvedValue({ id: 12 });
});
describe("C3C-1: HTTP y rutas sin BD", () => {
  it("no invoca servicios sin permiso", async () => {
    m.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    for (const f of [() => ejerciciosGet(req(), "e"), () => ejerciciosPost(req("entidad=9", {}), "e"), () => periodosGet(req(), "e", "12"), () => calendarioOpcionesGet("e")]) expect((await f()).status).toBe(403);
    for (const f of [m.crear, m.ejercicios, m.periodos, m.entidades]) expect(f).not.toHaveBeenCalled();
  });
  it('correlaciona errores internos sin registrar datos sensibles ni aceptar referencias externas',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{
      m.crear.mockRejectedValue({code:'SECRET_TOKEN',errno:1030,message:'PASSWORD',sql:'SELECT PRIVATE',sqlMessage:'FINANCIAL',parameters:['COOKIE'],stack:'BEARER'});
      const r=await ejerciciosPost(req('entidad=9',{codigo:'SECRET_BODY'}),'e');
      const body=await r.json();expect(r.status).toBe(500);
      expect(body.referencia).toMatch(/^[a-f0-9-]{36}$/);expect(r.headers.get('X-Correlation-ID')).toBe(body.referencia);
      expect(log).toHaveBeenCalledOnce();expect(log.mock.calls[0][1]).toMatchObject({referencia:body.referencia,code:'NO_CLASIFICADO'});
      const recorded=JSON.stringify(log.mock.calls)+JSON.stringify(body);
      for(const secret of ['SECRET_TOKEN','PASSWORD','SELECT PRIVATE','FINANCIAL','COOKIE','BEARER','SECRET_BODY'])expect(recorded).not.toContain(secret);
    }finally{log.mockRestore();}
  });
  it.each(["", "entidad=0", "entidad=x", "entidad=9&entidad=10"])("rechaza ámbito inválido %s", async (qs) => {
    expect((await ejerciciosGet(req(qs), "e")).status).toBe(400);
    expect((await ejerciciosPost(req(qs, {}), "e")).status).toBe(400);
    expect(m.crear).not.toHaveBeenCalled(); expect(m.ejercicios).not.toHaveBeenCalled();
  });
  it("resuelve params Promise y usa empresa/actor de la sesión", async () => {
    const ctx = { params: Promise.resolve({ slug: "e" }) };
    const r = await GET(req("entidad=9&empresaId=88"), ctx);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(m.ejercicios).toHaveBeenCalledWith(7, 9);
    expect((await POST(req("entidad=9", { codigo: "E" }), ctx)).status).toBe(201);
    expect(m.crear).toHaveBeenCalledWith(7, "actor", { entidadId: 9, usuarioId: 4, admin: false }, { codigo: "E" });
    await periodosRoute(req(), { params: Promise.resolve({ slug: "e", id: "12" }) });
    expect(m.periodos).toHaveBeenCalledWith(7, 9, 12);
    expect(m.guard).toHaveBeenCalledWith("e", "crear");
  });
  it("IDs inválidos no consultan; opciones reutiliza catálogo de entidades de la empresa", async () => {
    for (const id of ["0", "-1", "x", "2147483648"]) expect((await periodosGet(req(), "e", id)).status).toBe(400);
    expect(m.periodos).not.toHaveBeenCalled();
    expect((await calendarioOpcionesGet("e")).status).toBe(200);
    expect(m.entidades).toHaveBeenCalledWith(7, true);
  });
  it.each([["ER_NO_SUCH_TABLE", 503], ["ER_DUP_ENTRY", 409], ["ER_LOCK_DEADLOCK", 409], ["ER_LOCK_WAIT_TIMEOUT", 409], ["ER_CHECKREAD", 500], ["ER_INTERNAL_ERROR", 500], ["OTRO", 500]] as const)("controla %s sin exponer detalles internos", async (code, status) => {
    m.crear.mockRejectedValue({ code, message: "detalle interno" });
    const r = await ejerciciosPost(req("entidad=9", {}), "e");
    expect(r.status).toBe(status); expect(await r.text()).not.toContain("detalle interno");
  });
});
