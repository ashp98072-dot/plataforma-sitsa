import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/fiscal-antecedentes", () => ({
  capturarAntecedentesFiscales: vi.fn(), confirmarAntecedentesFiscales: vi.fn(), leerAntecedentesFiscales: vi.fn(),
}));
import { requireTenantRrhh } from "@/lib/tenant";
import { capturarAntecedentesFiscales, confirmarAntecedentesFiscales, leerAntecedentesFiscales } from "@/lib/rrhh/fiscal-antecedentes";
import { ErrorModeloFiscal } from "@/lib/rrhh/fiscal-modelo";
import { GET, PATCH, POST } from "./route";
const ctx = { params: Promise.resolve({ slug: "prueba", empleadoId: "9", ejercicio: "2026" }) };
const antecedente = { inicioFiscal: null, corteAntecedentes: null, ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00",
  igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00", datos: { version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES",
    constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [],
    otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] } } };
const req = (body?: unknown) => new Request("https://local.test/?empresaId=99", body === undefined ? {} :
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh" } } as never);
  vi.mocked(leerAntecedentesFiscales).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] });
  vi.mocked(capturarAntecedentesFiscales).mockResolvedValue({ id: 1, revision: 1 });
  vi.mocked(confirmarAntecedentesFiscales).mockResolvedValue({ revision: 1 });
});
describe("API fiscal sin UI/motor", () => {
  it("GET solo usa empresa validada, exige ver y no permite cache", async () => {
    const response = await GET(req(), ctx);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "configuracion", "ver");
    expect(leerAntecedentesFiscales).toHaveBeenCalledWith(7, 9, 2026);
  });
  it("POST captura con crear, responsable servidor y una sola llamada", async () => {
    const response = await POST(req({ expectedRevision: 0, antecedente }), ctx);
    expect(response.status).toBe(201);
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "configuracion", "crear");
    expect(capturarAntecedentesFiscales).toHaveBeenCalledExactlyOnceWith(7, 9, 2026, antecedente, "rrhh", 0);
  });
  it("PATCH solo confirma con editar; no recibe datos económicos", async () => {
    expect((await PATCH(req({ accion: "confirmar", revision: 1 }), ctx)).status).toBe(200);
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "configuracion", "editar");
    expect(confirmarAntecedentesFiscales).toHaveBeenCalledExactlyOnceWith(7, 9, 2026, 1, "rrhh");
  });
  it.each([401, 403])("sin sesión/permiso (%s) no lee ni escribe", async (status) => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status }) } as never);
    expect((await GET(req(), ctx)).status).toBe(status);
    expect((await POST(req({ expectedRevision: 0, antecedente }), ctx)).status).toBe(status);
    expect((await PATCH(req({ accion: "confirmar", revision: 1 }), ctx)).status).toBe(status);
    expect(leerAntecedentesFiscales).not.toHaveBeenCalled();
    expect(capturarAntecedentesFiscales).not.toHaveBeenCalled(); expect(confirmarAntecedentesFiscales).not.toHaveBeenCalled();
  });
  it.each(["empresaId", "usuario", "confirmadoEn"]) ("rechaza campo manipulable %s", async (key) => {
    expect((await POST(req({ expectedRevision: 0, antecedente, [key]: 99 }), ctx)).status).toBe(400);
    expect(capturarAntecedentesFiscales).not.toHaveBeenCalled();
  });
  it("rechaza acciones fuera de alcance y edición económica al confirmar", async () => {
    expect((await PATCH(req({ accion: "ejecutar", revision: 1 }), ctx)).status).toBe(400);
    expect((await PATCH(req({ accion: "confirmar", revision: 1, antecedente }), ctx)).status).toBe(400);
    expect(confirmarAntecedentesFiscales).not.toHaveBeenCalled();
  });
  it.each(["-1", "1.5", "9e2", "2147483648"]) ("ID inválido %s no llega a modelo", async (empleadoId) => {
    expect((await GET(req(), { params: Promise.resolve({ slug: "prueba", empleadoId, ejercicio: "2026" }) })).status).toBe(400);
    expect(leerAntecedentesFiscales).not.toHaveBeenCalled();
  });
  it("JSON malformado devuelve 400 sin escribir", async () => {
    expect((await POST(new Request("https://local.test", { method: "POST", body: "{" }), ctx)).status).toBe(400);
    expect(capturarAntecedentesFiscales).not.toHaveBeenCalled();
  });
  it("errores internos se ocultan y errores de modelo conservan status", async () => {
    vi.mocked(leerAntecedentesFiscales).mockRejectedValue(new Error("SQL secreto /ruta/privada"));
    const response = await GET(req(), ctx);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("secreto");
    vi.mocked(confirmarAntecedentesFiscales).mockRejectedValue(new ErrorModeloFiscal("Ya confirmado.", 409));
    expect((await PATCH(req({ accion: "confirmar", revision: 1 }), ctx)).status).toBe(409);
  });
});
