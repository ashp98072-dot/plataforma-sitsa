import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  guard: vi.fn(), asistencias: vi.fn(), incidencias: vi.fn(), cargado: vi.fn(),
  excel: vi.fn(), pdf: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.guard }));
vi.mock("@/lib/rrhh/periodos", () => ({ obtenerRangoPeriodo: vi.fn() }));
vi.mock("@/lib/rrhh/reportes", () => ({ obtenerReporteAsistencias: m.asistencias, obtenerResumenIncidenciasDetallado: m.incidencias }));
vi.mock("@/lib/rrhh/export-files", () => {
  m.cargado();
  return { tablaAExcel: m.excel, tablaAPdf: m.pdf };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ empresa: { id: 7, nombre: "Empresa fixture" } });
  m.asistencias.mockResolvedValue([{ fecha: "2026-09-24", codigo: "E1", nombre: "Ana", horaEntrada: "08:00", horaSalida: null, estadoEntrada: "A tiempo", estadoSalida: "Pendiente", motivo: "Trabajando", tipoHorario: "Fijo", comentarios: "", fotoEntradaId: 1, fotoSalidaId: null }]);
  m.incidencias.mockResolvedValue([{ codigo: "E1", empleado: "Ana", totalRetrasos: 1, totalSalidasTempranas: 2, totalFaltas: 3, totalDiasAsistidos: 4 }]);
  m.excel.mockResolvedValue(Buffer.from("xlsx-fixture"));
  m.pdf.mockResolvedValue(Buffer.from("pdf-fixture"));
});

async function request(modo: string, formato = "json") {
  const { GET } = await import("@/app/api/empresas/[slug]/rrhh/reportes/route");
  return GET(new Request(`http://localhost/api?desde=2026-09-23&hasta=2026-09-24&modo=${modo}&formato=${formato}&tipo=Falta&horario=Variable`), { params: Promise.resolve({ slug: "fixture" }) });
}

it("JSON asistencia/incidencias no carga export-files y mantiene respuesta/filtros/permisos", async () => {
  const asistencia = await request("asistencias");
  expect(await asistencia.json()).toEqual({ desde: "2026-09-23", hasta: "2026-09-24", empresa: "Empresa fixture", filas: await m.asistencias() });
  expect(m.asistencias).toHaveBeenCalledWith(7, "2026-09-23", "2026-09-24", { tipo: "Falta", horario: "Variable" });
  const incidencias = await request("incidencias");
  expect(await incidencias.json()).toEqual({ desde: "2026-09-23", hasta: "2026-09-24", resumen: await m.incidencias() });
  expect(m.guard).toHaveBeenCalledWith("fixture", "reportes", "ver");
  expect(m.cargado).not.toHaveBeenCalled();
});

it("denegación conserva respuesta y no carga exports ni reportes", async () => {
  m.guard.mockResolvedValue({ error: new Response("Prohibido", { status: 403 }) });
  expect((await request("asistencias", "pdf")).status).toBe(403);
  expect(m.cargado).not.toHaveBeenCalled();
  expect(m.asistencias).not.toHaveBeenCalled();
});

for (const modo of ["asistencias", "incidencias"]) for (const formato of ["xlsx", "pdf"]) {
  it(`${modo}/${formato}: carga diferida, contenido/encabezados/nombre iguales`, async () => {
    const response = await request(modo, formato);
    const exportar = formato === "xlsx" ? m.excel : m.pdf;
    expect(exportar).toHaveBeenCalledTimes(1);
    const opciones = exportar.mock.calls[0][0];
    expect(opciones.headers).toEqual(modo === "incidencias"
      ? ["Código", "Empleado", "Retrasos", "Salidas tempranas", "Faltas", "Días asistidos"]
      : ["Fecha", "Código", "Empleado", "Entrada", "Salida", "Estado entrada", "Estado salida", "Motivo", "Horario", "Comentarios", "Foto entrada", "Foto salida"]);
    expect(opciones.rows).toEqual(modo === "incidencias" ? [["E1", "Ana", "1", "2", "3", "4"]] : [["2026-09-24", "E1", "Ana", "08:00", "", "A tiempo", "Pendiente", "Trabajando", "Fijo", "", "Disponible en el sistema", ""]]);
    if (formato === "pdf") expect(opciones.subtitle).toBe("Empresa fixture · 2026-09-23 → 2026-09-24");
    else expect(opciones.sheetName).toBe(modo === "incidencias" ? "Incidencias" : "Asistencias");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${modo}-fixture-2026-09-23-2026-09-24.${formato}"`);
    expect(response.headers.get("content-type")).toBe(formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(await response.text()).toBe(`${formato}-fixture`);
  });
}
