import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn(), obtenerEmpresaPorSlug: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/permisos", async () => ({ ...await vi.importActual("@/lib/permisos-shared"), permisosEfectivos: vi.fn() }));
vi.mock("./bancos-mayor", () => ({ movimientosMayorBancario: vi.fn() }));
import { empresasParaUsuario, obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { permisosEfectivos } from "@/lib/permisos";
import { movimientosMayorBancario } from "./bancos-mayor";
import { AccesoContable } from "./ambito";
import { GET } from "@/app/api/empresas/[slug]/contabilidad/bancos/[bancoId]/mayor/route";
const req = (qs = "entidad=5&desde=2026-01-01&hasta=2026-01-31") => new Request(`http://localhost/x?${qs}`);
const ctx = (bancoId = "10") => ({ params: Promise.resolve({ slug: "qa", bancoId }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 91, username: "qa", rol: "Contabilidad", empresaId: 7 });
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ id: 7, activa: true, modulos: ["contabilidad"] } as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([{ id: 7 }] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "contabilidad_mayor", puedeVer: true }] as never);
  vi.mocked(movimientosMayorBancario).mockResolvedValue({ movimientos: [] } as never);
});
it("guard real del Mayor, empresa y actor de sesión, fechas y vacío privado", async () => {
  const r = await GET(req(), ctx()); expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ movimientos: [] });
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  expect(movimientosMayorBancario).toHaveBeenCalledWith(7, { entidadId: 5, usuarioId: 91, admin: false }, 10, { desde: "2026-01-01", hasta: "2026-01-31" });
});
it("catálogo Contabilidad no autoriza Mayor; revocación y empresa ajena bloquean", async () => {
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "contabilidad", puedeVer: true }] as never);
  let r = await GET(req(), ctx()); expect(r.status).toBe(403); expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "contabilidad_mayor", puedeVer: true }] as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([]);
  r = await GET(req(), ctx()); expect(r.status).toBe(403); expect(movimientosMayorBancario).not.toHaveBeenCalled();
});
it("sin sesión o módulo no consulta", async () => {
  vi.mocked(getSession).mockResolvedValueOnce(null);
  expect((await GET(req(), ctx())).status).toBe(401);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ id: 7, activa: true, modulos: ["tms"] } as never);
  expect((await GET(req(), ctx())).status).toBe(403); expect(movimientosMayorBancario).not.toHaveBeenCalled();
});
it.each(["", "entidad=", "entidad=5&entidad=6", "entidad=5&empresa=8", "entidad=5&desde=", "entidad=5&desde=2026-02-30", "entidad=5&desde=2026-02-01&hasta=2026-01-31", "entidad=5&hasta=2026-01-01&hasta=2026-01-02", "entidad=5&periodo=0", "entidad=5&periodo=1&desde=2026-01-01"])("rechaza filtros %s antes del servicio", async qs => {
  expect((await GET(req(qs), ctx())).status).toBe(400); expect(movimientosMayorBancario).not.toHaveBeenCalled();
});
it.each(["0", "-1", "abc", "2147483648"])("banco inválido %s", async id => {
  expect((await GET(req(), ctx(id))).status).toBe(400);
});
it("reutiliza período del Mayor sin combinar fechas", async () => {
  expect((await GET(req("entidad=5&periodo=12"), ctx())).status).toBe(200);
  expect(movimientosMayorBancario).toHaveBeenCalledWith(7, expect.anything(), 10, { periodoId: 12 });
});
it("errores scoped y esquema privados, sin filtrar SQL", async () => {
  for (const error of [new AccesoContable("Cuenta no disponible.", 404), { code: "ER_NO_SUCH_TABLE", sqlMessage: "secreto" }, Error("secreto")]) {
    vi.mocked(movimientosMayorBancario).mockRejectedValueOnce(error);
    const r = await GET(req(), ctx()); expect([404, 503, 500]).toContain(r.status);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store"); expect(await r.text()).not.toContain("secreto");
  }
});
