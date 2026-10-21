import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantViaticosComprobantes: vi.fn(), requireTenantViaticosAny: vi.fn() }));
vi.mock("@/lib/permisos", () => ({ permisosEfectivos: vi.fn(), tienePermiso: vi.fn() }));
vi.mock("@/lib/tms/viaticos-reporte", () => ({ datosReporteViaticos: vi.fn(), reporteViaticosPdf: vi.fn(), reporteViaticosExcel: vi.fn() }));
import { requireTenantViaticosComprobantes, requireTenantViaticosAny } from "@/lib/tenant";
import { tienePermiso, permisosEfectivos } from "@/lib/permisos";
import { datosReporteViaticos, reporteViaticosPdf, reporteViaticosExcel } from "@/lib/tms/viaticos-reporte";
import { GET } from "./route";
import { ESTADOS_REPORTE, mensajeSinDatos, type EstadoReporte } from "@/lib/tms/viaticos-reporte-filtros";
const call = (query = "estado=AUTORIZADO&formato=pdf") => GET(new Request(`http://localhost/api?${query}`), { params: Promise.resolve({ slug: "empresa-7" }) });
beforeEach(() => {
  vi.resetAllMocks();
  const ok = { session: { id: 23, rol: "Operaciones" }, empresa: { id: 7, nombre: "EMPRESA 7" } } as never;
  vi.mocked(requireTenantViaticosComprobantes).mockResolvedValue(ok);
  vi.mocked(requireTenantViaticosAny).mockResolvedValue(ok);
  vi.mocked(permisosEfectivos).mockResolvedValue([] as never);
  vi.mocked(tienePermiso).mockReturnValue(false);
  vi.mocked(datosReporteViaticos).mockResolvedValue([{ id: 1 }] as never);
  vi.mocked(reporteViaticosPdf).mockResolvedValue(Buffer.from("pdf"));
  vi.mocked(reporteViaticosExcel).mockResolvedValue(Buffer.from("excel"));
});
describe("Reporte protegido", () => {
  it.each(["pdf", "excel"])("%s usa tenant del guard", async (formato) => {
    const res = await call(`estado=AUTORIZADO&formato=${formato}&empresaId=999`);
    expect(res.status).toBe(200);
    expect(datosReporteViaticos).toHaveBeenCalledWith(7, expect.objectContaining({ estado: "AUTORIZADO" }), false);
    expect(formato === "pdf" ? reporteViaticosPdf : reporteViaticosExcel).toHaveBeenCalledWith(expect.any(Array), "EMPRESA 7", expect.any(Object), false);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(requireTenantViaticosComprobantes).toHaveBeenCalledWith("empresa-7", "ver");
  });
  it.each(["estado=INVALIDO&formato=pdf", "estado=AUTORIZADO&formato=exe", "formato=pdf", "estado=AUTORIZADO&formato=pdf&rol=Admin"])("400 %s", async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(datosReporteViaticos).not.toHaveBeenCalled();
  });
  it.each(["comprobantes", "listado"])("403 sin permiso %s", async (tipo) => {
    vi.mocked(tipo === "comprobantes" ? requireTenantViaticosComprobantes : requireTenantViaticosAny).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    expect((await call()).status).toBe(403);
    expect(datosReporteViaticos).not.toHaveBeenCalled();
  });
  it("banco requiere permiso propio", async () => {
    vi.mocked(tienePermiso).mockReturnValue(true);
    await call("estado=AUTORIZADO&formato=excel&incluirBancario=false");
    expect(tienePermiso).toHaveBeenCalledWith([], "viaticos_pagar", "ver");
    expect(datosReporteViaticos).toHaveBeenCalledWith(7, expect.any(Object), true);
  });
  it.each(Object.keys(ESTADOS_REPORTE) as EstadoReporte[])("404 dinámico %s", async (estado) => {
    vi.mocked(datosReporteViaticos).mockResolvedValue([]);
    const res = await call(`estado=${estado}&formato=pdf`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: mensajeSinDatos(estado) });
    expect(reporteViaticosPdf).not.toHaveBeenCalled();
  });
});
