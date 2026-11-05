import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn(), obtenerEmpresaPorSlug: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/permisos", async () => ({ ...await vi.importActual("@/lib/permisos-shared"), permisosEfectivos: vi.fn() }));
vi.mock("@/lib/contabilidad/bancos", () => ({ consultarBancos: vi.fn() }));
vi.mock("@/lib/contabilidad/entidades", () => ({ listarEntidades: vi.fn() }));
import { empresasParaUsuario, obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { permisosEfectivos } from "@/lib/permisos";
import { consultarBancos } from "./bancos";
import { listarEntidades } from "./entidades";
import { AccesoContable } from "./ambito";
import { GET } from "@/app/api/empresas/[slug]/contabilidad/bancos/route";
const ctx = { params: Promise.resolve({ slug: "qa" }) };
const request = (s = "entidad=5") => new Request(`http://localhost/api/empresas/qa/contabilidad/bancos?${s}`);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 91, username: "qa", rol: "Contabilidad", empresaId: 7 });
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ id: 7, activa: true, modulos: ["contabilidad"] } as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([{ id: 7 }] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "contabilidad", puedeVer: true }] as never);
  vi.mocked(consultarBancos).mockResolvedValue([]); vi.mocked(listarEntidades).mockResolvedValue([]);
});
it("guard real obtiene empresa y actor de sesión; respuesta privada", async () => {
  const r = await GET(request(), ctx); expect(r.status).toBe(200);
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  expect(consultarBancos).toHaveBeenCalledWith(7, { entidadId: 5, usuarioId: 91, admin: false });
  await GET(request(""), ctx); expect(listarEntidades).toHaveBeenCalledWith(7, false);
});
it("revocación y empresa no autorizada deniegan antes del servicio", async () => {
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "contabilidad", puedeVer: false }] as never);
  let r = await GET(request(), ctx); expect(r.status).toBe(403); expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  vi.mocked(empresasParaUsuario).mockResolvedValue([]);
  r = await GET(request(), ctx); expect(r.status).toBe(403);
  expect(consultarBancos).not.toHaveBeenCalled(); expect(listarEntidades).not.toHaveBeenCalled();
});
it("sin sesión no consulta; no revela nombres bancarios", async () => {
  vi.mocked(getSession).mockResolvedValue(null);
  expect((await GET(request(), ctx)).status).toBeGreaterThanOrEqual(401);
  expect(consultarBancos).not.toHaveBeenCalled();
});
it.each(["entidad=", "entidad=0", "entidad=abc", "entidad=1&entidad=2", "entidad=2147483648", "entidad=5&empresaId=2", "usuarioId=1"])("rechaza entrada %s", async qs => {
  expect((await GET(request(qs), ctx)).status).toBe(400); expect(consultarBancos).not.toHaveBeenCalled();
});
it("errores controlados privados sin SQL ni rutas sensibles", async () => {
  vi.mocked(consultarBancos).mockRejectedValueOnce(new AccesoContable("Entidad no disponible.", 404));
  expect((await GET(request(), ctx)).status).toBe(404);
  for (const code of ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"]) {
    vi.mocked(consultarBancos).mockRejectedValueOnce({ code, sqlMessage: "SQL privado" });
    const r = await GET(request(), ctx); expect(r.status).toBe(503); expect(await r.text()).not.toContain("SQL privado");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  }
  vi.mocked(consultarBancos).mockRejectedValueOnce(Error("contraseña y SQL privado"));
  expect(await (await GET(request(), ctx)).text()).not.toContain("privado");
});
