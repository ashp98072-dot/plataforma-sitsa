import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));
vi.mock("@/lib/tms/viaticos-comprobante-pdf", () => ({ tituloEmpresa: (n: string) => n }));

import { query } from "@/lib/db";
import { generarPdfMensualSolicitudesFondo } from "./fondos-mensual-pdf";
import { agruparSolicitudesFondo, resumenMensualFondos, resumirSolicitudesFondo, type FilaSolicitudFondoReporte } from "./reportes-gastos";

/** OP-FONDOS-REP-01 — PDF mensual consolidado: con categoría rotula y suma solo la categoría; sin categoría conserva sus criterios. */
function linea(over: Partial<FilaSolicitudFondoReporte> = {}): FilaSolicitudFondoReporte {
  return {
    lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010", fechaSolicitud: "2026-09-03", fechaViaje: "2026-09-04", empleadoId: 4, empleadoNombre: "Heber", cargo: "Piloto",
    cuenta: null, vehiculoId: 9, placa: "C-130BQ", clienteId: 5, clienteNombre: "Cliente A", planId: null, categoria: "Combustible", cantidad: 2, descripcion: "Combustible", monto: 100.5,
    total: 201, totalExacto: "201.0000", entidadRequirenteNombre: "Kuiqtrans", requirenteNombre: "Mario", solicitanteNombre: "Ana", autorizanteNombre: "Heber",
    fechaAutorizacion: "2026-09-04", totalSolicitud: 501, estadoFondo: "Autorizada", ...over,
  };
}
const textos = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(query).mockResolvedValue([] as never); });
afterEach(() => vi.restoreAllMocks());

// Filas ya filtradas por categoría (lo que entrega reporteSolicitudesFondo con categoria=Combustible).
const FILTRADAS = [
  linea({ lineaId: 1, solicitudId: 10, solicitudCodigo: "F-10", subtotalCategoria: 201 }),
  linea({ lineaId: 3, solicitudId: 11, solicitudCodigo: "F-11", cantidad: 3, monto: 20.05, total: 60.15, totalExacto: "60.1500", totalSolicitud: 60.15, estadoFondo: "Liquidada", subtotalCategoria: 60.15 }),
  linea({ lineaId: 5, solicitudId: 13, solicitudCodigo: "F-13", cantidad: 1, monto: 1000, total: 1000, totalExacto: "1000.0000", totalSolicitud: 1000, estadoFondo: "Rechazada", subtotalCategoria: 1000 }),
];

describe("PDF mensual con filtro de categoría", () => {
  it("rotula la categoría en encabezado, bloques, subtotales, resumen y pie; el total del mes suma SOLO esa categoría (Autorizada + Liquidada)", async () => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const grupos = agruparSolicitudesFondo(FILTRADAS);
    const resumen = resumenMensualFondos(grupos, "Combustible");
    await generarPdfMensualSolicitudesFondo(7, "SITSA", grupos, resumen, { anio: 2026, mes: 9 }, "Combustible");
    const t = textos(spy);
    expect(t.some((x) => /Período: .* · Categoría: Combustible$/.test(x))).toBe(true);
    expect(t.filter((x) => x === "Categoría filtrada: Combustible (solo se listan las líneas de esta categoría)")).toHaveLength(3);
    expect(t).toContain("SUBTOTAL COMBUSTIBLE: Q 201.00");
    expect(t).toContain("SUBTOTAL COMBUSTIBLE: Q 60.15");
    expect(t).toContain("Total de la solicitud (todas las categorías): Q 501.00");
    expect(t).not.toContain("TOTAL SOLICITUD: Q 501.00"); // el rótulo ambiguo no se reutiliza
    expect(t).toContain("TOTAL COMBUSTIBLE DEL MES: Q 261.15"); // 201.00 + 60.15; la rechazada (1000) no suma
    expect(t.some((x) => x.startsWith("Categoría filtrada: Combustible. Se suman SOLO las líneas de esa categoría"))).toBe(true);
    expect(t).not.toContain("TOTAL GENERAL DEL MES: Q 261.15");
    expect(t.some((x) => / · Categoría: Combustible · Generado/.test(x))).toBe(true);
  });

  it("mismos números que la pantalla: el total del mes = autorizado del resumen del servidor", () => {
    const grupos = agruparSolicitudesFondo(FILTRADAS);
    expect(resumenMensualFondos(grupos, "Combustible").totalGeneral).toBe(resumirSolicitudesFondo(FILTRADAS, "Combustible").totalAutorizado);
  });

  it("SIN categoría: criterios y rótulos de siempre (TOTAL SOLICITUD, TOTAL GENERAL DEL MES con total de cabecera)", async () => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const filas = FILTRADAS.map((l) => ({ ...l, subtotalCategoria: undefined }));
    const grupos = agruparSolicitudesFondo(filas);
    await generarPdfMensualSolicitudesFondo(7, "SITSA", grupos, resumenMensualFondos(grupos), { anio: 2026, mes: 9 });
    const t = textos(spy);
    expect(t).toContain("TOTAL SOLICITUD: Q 501.00");
    expect(t).toContain("TOTAL GENERAL DEL MES: Q 561.15"); // 501 + 60.15
    expect(t.some((x) => x.includes("Categoría"))).toBe(false);
  });
});
