import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/fondos", () => ({ obtenerSolicitudFondo: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));

import { obtenerSolicitudFondo } from "@/lib/tms/fondos";
import { query } from "@/lib/db";
import { generarPdfSolicitudFondoAutorizada } from "@/lib/tms/fondos-solicitud-pdf";
import { exportarSolicitudFondoExcel } from "@/lib/tms/gastos-export-excel";
import { requerimientoCompraExcel, requerimientoCompraPdf } from "@/lib/compras/requerimiento-exportaciones";
import { compraReporteFixture } from "@/lib/compras/requerimiento-exportaciones.fixture";

/**
 * Número/código del documento arriba a la derecha (Solicitud de Fondo y Requerimiento de compra; PDF y Excel individuales).
 * Se usa el código PERSISTIDO (p. ej. id 5 con código FONDO-000123: nunca se reconstruye desde el id). Gastos: ver discovery.
 */
const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const hoja = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ExcelJS.Buffer); return wb.worksheets[0]!; };
const llamadas = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => ({
  texto: String(c[0]), args: c.slice(1),
  opciones: c.find((a, i) => i > 0 && typeof a === "object" && a !== null) as Record<string, unknown> | undefined,
}));

const CODIGO_FONDO = "FONDO-000123";
const linea = {
  id: 1, categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, orden: 0, fechaViaje: "2026-09-02", empleadoId: 4,
  empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "1234567890", metodoPago: "Transferencia", vehiculoId: 9, placa: "P111AAA",
  clienteId: 5, clienteNombre: "Cliente A", planId: null,
};
const solicitud = {
  id: 5, empresaId: 7, codigo: CODIGO_FONDO, entidadRequirenteId: 10, entidadRequirenteNombre: "Kuiqtrans", requirenteEmpleadoId: null,
  requirenteNombre: "Mario Caal", requirenteUsuarioId: 3, fechaRequerimiento: "2026-09-04", total: 200, autorizanteEmpleadoId: null,
  autorizanteNombre: "Heber Sitan", autorizanteUsuarioId: 9, estado: "Autorizada", autorizadoEn: "2026-09-04 10:00:00", rechazadoEn: null,
  motivoRechazo: null, liquidadoEn: null, observaciones: null, creadoPor: "mcaal", solicitanteUsuarioId: 5, solicitanteNombre: "Mario Caal",
  creadoEn: "2026-09-04 09:00:00", lineas: [linea],
};

beforeEach(() => { vi.mocked(query).mockResolvedValue([] as never); vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud as never); });
afterEach(() => vi.restoreAllMocks());

describe("Solicitud de Fondo — PDF", () => {
  it("dibuja solicitud.codigo (el persistido) arriba a la derecha, en Helvetica-Bold, sin tapar el título centrado", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const font = vi.spyOn(PDFDocument.prototype, "font");
    const r = await generarPdfSolicitudFondoAutorizada(7, 5, "SITSA");
    expect(r.ok).toBe(true);
    const cs = llamadas(text);
    const codigo = cs.filter((c) => c.texto === CODIGO_FONDO);
    expect(codigo).toHaveLength(1); // solo primera página, una vez
    expect(codigo[0].opciones).toMatchObject({ align: "right", lineBreak: false, width: 728 });
    expect(codigo[0].args[0]).toBe(32); // x = margen izquierdo del área de texto: el ancho llega al margen derecho
    expect(Number(codigo[0].args[1])).toBeLessThan(60); // en la franja superior, junto al título
    expect(font.mock.calls.some((c) => c[0] === "Helvetica-Bold")).toBe(true);
    const titulo = cs.find((c) => c.texto === "SOLICITUD DE FONDO");
    expect(titulo?.opciones).toMatchObject({ align: "center", width: 728 });
    expect(cs.map((c) => c.texto)).not.toContain("FONDO-000005"); // no se reconstruye desde el id
  });
  it("título, fecha, empresa, requirente, total y nombre de archivo intactos", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const r = await generarPdfSolicitudFondoAutorizada(7, 5, "SITSA");
    const textos = llamadas(text).map((c) => c.texto);
    expect(textos).toContain("SOLICITUD DE FONDO");
    expect(textos).toContain("FECHA DEL REQUERIMIENTO: 04/09/2026");
    expect(textos).toContain("EMPRESA REQUIRIENTE: KUIQTRANS");
    expect(textos).toContain("PERSONA QUE REQUIERE: MARIO CAAL");
    expect(textos.some((t) => t.startsWith("TOTAL: Q 200.00"))).toBe(true);
    expect(textos).toContain("Notas:");
    if (r.ok) { expect(r.nombreArchivo).toBe(`solicitud-fondo-${CODIGO_FONDO}.pdf`); expect(r.buffer.subarray(0, 4).toString()).toBe("%PDF"); }
  });
  it("el código se dibuja ANTES que el título (mismo renglón) y el cursor no se mueve: el título sigue en su lugar", () => {
    const f = src("src/lib/tms/fondos-solicitud-pdf.ts");
    expect(f.indexOf("dibujarCodigoDocumentoPdf(doc, solicitud.codigo")).toBeLessThan(f.indexOf('.text("SOLICITUD DE FONDO"'));
    const h = src("src/lib/documentos-encabezado.ts");
    expect(h).toContain("doc.x = x0;");
    expect(h).toContain("doc.y = y0;");
  });
});

describe("Solicitud de Fondo — Excel", () => {
  it("código en las últimas 3 columnas de la fila del título (celda propia, no columna de datos); título sin código", async () => {
    const ws = await hoja(await exportarSolicitudFondoExcel(solicitud as never));
    expect(ws.getCell("A2").value).toBe("SOLICITUD DE FONDO");
    expect(ws.getCell("K2").value).toBe(CODIGO_FONDO);
    expect(ws.getCell("K2").isMerged).toBe(true);
    expect(ws.getCell("M2").isMerged).toBe(true);
    expect(ws.getCell("K2").font?.bold).toBe(true);
    expect(ws.getCell("K2").alignment?.horizontal).toBe("right");
    expect(ws.getCell("A2").isMerged).toBe(true);
    expect(ws.getCell("J2").isMerged).toBe(true); // título A2:J2 y código K2:M2 no se pisan
    expect(String(ws.getCell("A2").value)).not.toContain("FONDO-");
    expect(ws.getCell("A1").value).toBe("Kuiqtrans");
    expect(ws.getCell("M1").isMerged).toBe(true); // la fila de empresa sigue combinada en todo el ancho
  });
  it("la tabla, el total y los encabezados quedan igual (mismas filas)", async () => {
    const ws = await hoja(await exportarSolicitudFondoExcel(solicitud as never));
    expect(ws.getRow(4).values).toEqual([undefined, "Fecha solicitud", "Fecha viaje", "Nombre", "Cuenta", "Método de pago", "Cargo", "Placa", "Cliente", "Categoría", "Cantidad", "Descripción", "Valor", "Subtotal (Q)"]);
    expect(ws.getRow(5).getCell(13).value).toBe("200.00");
    expect(ws.getRow(6).values).toEqual([undefined, "", "", "", "", "", "", "", "", "", "", "", "TOTAL", "200.00"]);
    expect(ws.getCell("A3").value).toBeNull(); // fila separadora vacía como antes
    expect(ws.name).toBe(`Solicitud ${CODIGO_FONDO}`);
  });
  it("usa solicitud.codigo tal cual (código distinto del id → se ve el código)", async () => {
    const ws = await hoja(await exportarSolicitudFondoExcel({ ...solicitud, id: 77, codigo: "FONDO-009999" } as never));
    expect(ws.getCell("K2").value).toBe("FONDO-009999");
  });
});

describe("Requerimiento de compra — PDF y Excel", () => {
  const detalle = { ...compraReporteFixture, id: 12, codigo: "RC-2026-000777" };
  it("PDF: d.codigo arriba a la derecha (Helvetica-Bold), título centrado y la línea 'Código: …' se conserva", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const bytes = await requerimientoCompraPdf(detalle, "Tenant", null);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const cs = llamadas(text);
    const codigo = cs.filter((c) => c.texto === "RC-2026-000777");
    expect(codigo.length).toBeGreaterThanOrEqual(1);
    expect(codigo[0].opciones).toMatchObject({ align: "right", lineBreak: false, width: 728 });
    expect(codigo[0].args[0]).toBe(32);
    expect(cs.find((c) => c.texto === "REQUERIMIENTO DE REPUESTOS")?.opciones).toMatchObject({ align: "center" });
    expect(cs.some((c) => c.texto.startsWith("Código: RC-2026-000777 · Fecha:"))).toBe(true);
    expect(cs.map((c) => c.texto)).not.toContain("RC-2026-000012"); // no se reconstruye desde el id
    expect(cs.filter((c) => c.texto === "RC-2026-000777" && c.opciones?.align === "right")).toHaveLength(1); // solo en el encabezado
  });
  it("Excel: código en las últimas 3 columnas de la fila del título; título, línea 'Código: …' y tabla intactos", async () => {
    const ws = await hoja(await requerimientoCompraExcel(detalle, "Tenant"));
    expect(ws.getCell("A2").value).toBe("REQUERIMIENTO DE REPUESTOS");
    expect(ws.getCell("G2").value).toBe("RC-2026-000777");
    expect(ws.getCell("G2").font?.bold).toBe(true);
    expect(ws.getCell("G2").alignment?.horizontal).toBe("right");
    expect(ws.getCell("F2").isMerged && ws.getCell("I2").isMerged).toBe(true);
    expect(String(ws.getCell("A3").value)).toContain("Código: RC-2026-000777 · Fecha:");
    expect(ws.getCell("A1").value).toBe(detalle.entidad_requirente_nombre);
    expect(ws.name).toBe("Requerimiento RC-2026-000777");
  });
});

describe("Gastos — discovery de numeración (NO se inventa código)", () => {
  it("no existe un código administrativo persistido para el gasto: ni columna, ni campo del modelo", () => {
    const schema = src("sql/schema.sql");
    const tabla = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS tms_gastos_operativos"), schema.indexOf("ENGINE=InnoDB", schema.indexOf("CREATE TABLE IF NOT EXISTS tms_gastos_operativos")));
    expect(tabla).not.toMatch(/\bcodigo\b|\bnumero_gasto\b|\bcorrelativo\b/);
    const modelo = src("src/lib/tms/gastos.ts");
    const tipo = modelo.slice(modelo.indexOf("export type GastoOperativo = {"), modelo.indexOf("};", modelo.indexOf("export type GastoOperativo = {")));
    expect(tipo).not.toMatch(/^\s+codigo:/m);
  });
  it("por eso el Excel/PDF de Gasto NO cambia (sin código en el encabezado) y el archivo sigue usando el id", () => {
    expect(src("src/lib/tms/gastos-export-excel.ts")).toContain('encabezadoIndividual(await exportarGastosDetalleExcel(filas), gasto.entidadRequirenteNombre, "GASTO OPERATIVO");');
    expect(src("src/app/api/empresas/[slug]/tms/gastos/[id]/exportar/route.ts")).toContain("gasto-${gasto.id}");
  });
});
