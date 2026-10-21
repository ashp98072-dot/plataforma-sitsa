import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("./viaticos", () => ({ listarViaticosControl: vi.fn() }));
import { listarViaticosControl, type ViaticoControlItem } from "./viaticos";
import { coincideFiltroReporte, filtrosReporteSchema, ESTADOS_REPORTE, mensajeSinDatos, type EstadoReporte } from "./viaticos-reporte-filtros";
import { datosReporteViaticos, reporteViaticosExcel, reporteViaticosPdf, totalReporte } from "./viaticos-reporte";
const base = {
  id: 1, planCodigo: "VJ-001", fechaPlan: "2026-09-24", personalNombre: "Ana Pérez", cliente: "Cliente uno",
  rol: "Piloto", montoSugerido: 90, montoAsignado: 100.10, metodoPago: "EFECTIVO", banco: "BANCO SECRETO", cuentaBancaria: "123456",
} as ViaticoControlItem;
const estados = Object.keys(ESTADOS_REPORTE).filter((x) => x !== "TODOS") as EstadoReporte[];
beforeEach(() => vi.clearAllMocks());
describe("Reporte según estado/filtros", () => {
  it("QA: cinco estados y 110 registros con nombres largos, multipágina natural", async () => {
    for (const estado of [...estados, "TODOS" as const]) {
      const cantidad = estado === "TODOS" ? 110 : 1;
      const items = Array.from({ length: cantidad }, (_, i) => ({
        ...base, id: i + 1, estado: estado === "TODOS" ? "AUTORIZADO" : estado,
        personalNombre: "Ana María Pérez García de la Cruz", autorizadoPor: "Usuario autorizado",
        autorizadoEn: "2026-09-24 09:30:00", observacionesEntrega: "Entrega registrada para el viaje de la fecha indicada.",
      }));
      const buffer = await reporteViaticosPdf(items, "EMPRESA DE PRUEBA", filtrosReporteSchema.parse({ estado }), true);
      const pages = (await PDFDocument.load(buffer)).getPageCount();
      expect(pages).toBeGreaterThanOrEqual(1);
      if (cantidad === 110) expect(pages).toBeGreaterThan(1);
      if (process.env.VIATICOS_QA_DIR) {
        mkdirSync(process.env.VIATICOS_QA_DIR, { recursive: true });
        writeFileSync(join(process.env.VIATICOS_QA_DIR, `${estado}.pdf`), buffer);
      }
    }
  });
  it.each(estados)("%s exporta solo su estado en PDF/Excel", async (estado) => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: estados.map((e, i) => ({ ...base, id: i + 1, estado: e })), resumen: {} as never });
    const f = filtrosReporteSchema.parse({ estado });
    const items = await datosReporteViaticos(7, f, false);
    expect(items).toHaveLength(1);
    expect(items[0].estado).toBe(estado);
    expect(listarViaticosControl).toHaveBeenCalledWith(7, expect.objectContaining({ estado }), { incluirBancario: false });
    expect(mensajeSinDatos(estado)).toBe(`No hay viáticos ${ESTADOS_REPORTE[estado]} en el período seleccionado.`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(await reporteViaticosExcel(items, "EMPRESA 7", f, false)).buffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe(`Viáticos ${ESTADOS_REPORTE[estado]}`.slice(0, 31));
    expect(ws.getCell("A2").value).toBe(`Viáticos ${ESTADOS_REPORTE[estado]}`);
    expect(ws.getCell("I6").value).toBe(ESTADOS_REPORTE[estado]);
    expect(ws.getCell("H6").value).toBe(100.10);
    expect(ws.getCell("H7").value).toBe(100.10);
    expect((await PDFDocument.load(await reporteViaticosPdf(items, "EMPRESA 7", f, false))).getPageCount()).toBe(1);
  });
  it.each(["VJ-001", "cliente uno", "Ana Pérez"])("búsqueda %s", (busqueda) => {
    expect(coincideFiltroReporte(base, { busqueda, rol: "", metodo: "" })).toBe(true);
  });
  it.each([{ busqueda: "no coincide", rol: "", metodo: "" }, { busqueda: "", rol: "Auxiliar", metodo: "" },
    { busqueda: "", rol: "", metodo: "CHEQUE" }])("excluye %o", (f) => expect(coincideFiltroReporte(base, f)).toBe(false));
  it("combina filtros con empleado/rango servidor sin perder tenant", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [{ ...base, estado: "AUTORIZADO" }, { ...base, estado: "AUTORIZADO", rol: "Auxiliar" }], resumen: {} as never });
    const f = filtrosReporteSchema.parse({ estado: "AUTORIZADO", empleado: "Ana", busqueda: "Cliente", rol: "Piloto", metodo: "EFECTIVO", fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", agrupacion: "SEMANA" });
    expect(await datosReporteViaticos(18, f, true)).toHaveLength(1);
    expect(listarViaticosControl).toHaveBeenCalledWith(18, { estado: "AUTORIZADO", empleadoNombre: "Ana", fechaDesde: "2026-09-01", fechaHasta: "2026-09-30" }, { incluirBancario: true });
  });
  it("excluye Q0 por autorizar y suma centavos", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [{ ...base, estado: "PROGRAMADO", montoAsignado: 0 }], resumen: {} as never });
    expect(await datosReporteViaticos(7, filtrosReporteSchema.parse({ estado: "PROGRAMADO" }), false)).toEqual([]);
    expect(totalReporte([{ ...base, montoAsignado: 0.1 }, { ...base, montoAsignado: 0.2 }])).toBe(0.3);
  });
  it.each(["DIA", "SEMANA", "MES"])("Excel agrupa %s y protege banco", async (agrupacion) => {
    const f = filtrosReporteSchema.parse({ estado: "AUTORIZADO", agrupacion });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(await reporteViaticosExcel([{ ...base, estado: "AUTORIZADO" }], "OTRO TENANT", f, false)).buffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("OTRO TENANT");
    expect(ws.getCell("A6").value).toBe(agrupacion === "DIA" ? "24/09/2026" : agrupacion === "SEMANA" ? "Semana 21–27 septiembre 2026" : "Septiembre 2026");
    expect(ws.getCell("K6").value).toBe("Restringido");
    expect(ws.getCell("L6").value).toBe("Restringido");
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getRow(5).alignment.wrapText).toBe(true);
    expect(ws.getCell("H6").numFmt).toContain("#,##0.00");
    expect(ws.getRow(6).alignment.wrapText).toBe(true);
  });
  it.each([{ estado: "ARBITRARIO" }, { estado: "AUTORIZADO", fechaDesde: "2026-02-30" }, { estado: "AUTORIZADO", fechaDesde: "2026-10-01", fechaHasta: "2026-09-01" }])("rechaza %o", (f) => expect(filtrosReporteSchema.safeParse(f).success).toBe(false));
});
