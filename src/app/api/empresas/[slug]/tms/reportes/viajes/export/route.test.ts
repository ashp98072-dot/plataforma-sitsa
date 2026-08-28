import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/reportes-viajes", () => ({
  obtenerReporteViajesParaExportar: vi.fn(() => Promise.resolve({ ok: true, planes: [] })),
  calcularKpisReporte: vi.fn(() => ({
    totalViajes: 0, cerrados: 0, pendientesCierre: 0, enRuta: 0, cancelados: 0,
    totalEvidencias: 0, totalKmRecorridos: 0, valorProgramado: 0, valorCerrado: 0, promedioIngresoPorViaje: 0,
  })),
  filtrosReporteDesdeUrl: vi.fn((url: URL) => ({
    fechaDesde: url.searchParams.get("fechaDesde") ?? undefined,
    estado: url.searchParams.get("estado") ?? undefined,
  })),
}));
vi.mock("@/lib/rrhh/export-files", () => ({
  tablaAExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx"))),
  tablaAPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}));
vi.mock("@/lib/rrhh/dates", () => ({
  hoyLocal: vi.fn(() => "2026-08-27"),
  ahoraLocal: vi.fn(() => "2026-08-27 14:35:00"),
  formatearTimestampVisible: vi.fn((v: string) => v),
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { filtrosReporteDesdeUrl, obtenerReporteViajesParaExportar } from "@/lib/tms/reportes-viajes";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>,
  );
  vi.mocked(obtenerReporteViajesParaExportar).mockResolvedValue({ ok: true, planes: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/reportes/viajes/export — 14) recibe y aplica los MISMOS filtros que el listado", () => {
  it("exige permiso antes de generar el archivo", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerReporteViajesParaExportar).not.toHaveBeenCalled();
  });

  it("usa filtrosReporteDesdeUrl (la MISMA función que el listado) para parsear los filtros", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-08-01&estado=Cerrado"), ctx);
    expect(res.status).toBe(200);
    expect(filtrosReporteDesdeUrl).toHaveBeenCalledTimes(1);
    expect(obtenerReporteViajesParaExportar).toHaveBeenCalledWith(7, { fechaDesde: "2026-08-01", estado: "Cerrado" });
  });

  it('formato=xlsx genera Excel (Content-Type xlsx) reutilizando tablaAExcel', async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(tablaAExcel).toHaveBeenCalledTimes(1);
    expect(tablaAPdf).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("formato=pdf genera PDF reutilizando tablaAPdf", async () => {
    const res = await GET(new Request("http://localhost/x?formato=pdf"), ctx);
    expect(tablaAPdf).toHaveBeenCalledTimes(1);
    expect(tablaAExcel).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });
});

describe("[HALLAZGO 3 · 4] la exportación usa obtenerReporteViajesParaExportar — nunca el LIMIT 2000 silencioso", () => {
  it("si el volumen excede el máximo seguro, responde 400 con el mensaje claro (no genera un archivo truncado)", async () => {
    vi.mocked(obtenerReporteViajesParaExportar).mockResolvedValue({
      ok: false,
      error: "Hay 9000 viaje(s) sin un filtro que acote el volumen. Acota el rango de fechas para exportar.",
    });
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Acota el rango de fechas");
    expect(tablaAExcel).not.toHaveBeenCalled();
  });

  it("con éxito, exporta exactamente las filas que devolvió el exportador (todo el filtro, no una página)", async () => {
    const filaBase = {
      id: 1, codigo: "PLAN-1", fechaPlan: "2026-08-01", horaCarga: null, estado: "Programado",
      pendienteCierre: false, cerradoPor: null, cerradoEn: null, clienteId: null, cliente: null,
      rutaCodigo: null, lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null,
      regresoEstimado: null, tarifaComercial: null, placa: null, unidadTipo: null, unidadCapacidad: null,
      pilotoId: null, piloto: null, auxiliares: [] as string[], paradas: [], evidencias: 0,
      horaSalida: null, horaLlegada: null, kmSalida: null, kmLlegada: null, kmRecorridos: null, diasRuta: null,
    };
    const filas = Array.from({ length: 3000 }, (_, i) => ({ ...filaBase, id: i + 1 }));
    vi.mocked(obtenerReporteViajesParaExportar).mockResolvedValue({ ok: true, planes: filas as never });
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.status).toBe(200);
    const llamada = vi.mocked(tablaAExcel).mock.calls[0][0];
    expect(llamada.rows).toHaveLength(3000);
  });
});

describe("[HALLAZGO 2] fecha/hora de Guatemala explícita en la exportación", () => {
  it("el nombre de archivo usa hoyLocal (Guatemala), no el UTC del servidor", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.headers.get("Content-Disposition")).toContain("2026-08-27");
  });

  it("el subtítulo del PDF incluye la hora de Guatemala formateada, no toLocaleString del proceso", async () => {
    await GET(new Request("http://localhost/x?formato=pdf"), ctx);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    expect(llamada.subtitle).toContain("2026-08-27 14:35:00");
    expect(llamada.subtitle).toContain("Guatemala");
  });
});
