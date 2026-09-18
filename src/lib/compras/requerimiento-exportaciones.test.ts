import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { reforzarFirmaParaPdf } from "@/lib/firmas/reforzar-firma-pdf";
import ExcelJS from "exceljs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ acceso: vi.fn(), detalle: vi.fn() }));
vi.mock("@/lib/compras/acceso", () => ({ obtenerAccesoComprasPagina: m.acceso }));
vi.mock("@/lib/compras/requerimientos", () => ({ obtenerRequerimiento: m.detalle }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("404"); } }));
import DetallePage from "@/app/e/[slug]/compras/requerimientos/[id]/page";
import { COLUMNAS_EXCEL_COMPRA, RECORDATORIOS_COMPRA, FRASE_INSTITUCIONAL_COMPRA, requerimientoCompraExcel, requerimientoCompraPdf } from "./requerimiento-exportaciones";
import { compraReporteFixture as d, pngFirmaFixture } from "./requerimiento-exportaciones.fixture";
const firma = { nombre: "Firmante Histórico", rol: "Gerente Operaciones", fecha: "2026-09-18 10:15:00", codigo: "SIG-20260918-ABC12345", imagen: { buffer: pngFirmaFixture, mime: "image/png" } };
beforeEach(() => vi.clearAllMocks());
it("PNG de prueba válido", () => {
  const doc = new PDFDocument();
  expect(() => doc.image(pngFirmaFixture)).not.toThrow();
  expect(() => doc.image(reforzarFirmaParaPdf(pngFirmaFixture))).not.toThrow();
  doc.end();
});
afterEach(() => vi.restoreAllMocks());
const guardarQA = (nombre: string, bytes: Buffer) => {
  if (process.env.COMPRAS_REPORTE_QA_DIR) { mkdirSync(process.env.COMPRAS_REPORTE_QA_DIR, { recursive: true }); writeFileSync(join(process.env.COMPRAS_REPORTE_QA_DIR, nombre), bytes); }
};

it.each(["Pendiente", "Rechazada", "Autorizada"] as const)("PDF %s válido, completo y con firma solo si Autorizada", async estado => {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  const image = vi.spyOn(PDFDocument.prototype, "image");
  const bytes = await requerimientoCompraPdf({ ...d, estado }, "Tenant Real / Razón Social", firma);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const contenido = text.mock.calls.map(c => String(c[0])).join(" ").replace(/\s+/g, " ");
  for (const dato of [d.entidad_requirente_nombre, "REQUERIMIENTO DE REPUESTOS", d.codigo, "18/09/2026", "Requirente Histórico", "José López", "Ana Muñoz", "Proveedor Histórico", "Cabezal histórico", "Taller manual", "Piñón", "cañería", "Serie A", "00001", "00002", "Tarjeta de crédito", "Contado", "Entrega en taller", "TOTAL: Q 1,250.75", "Página 1 de", "FIRMA DE LA PERSONA QUE REQUIERE", "FIRMA DEL ENCARGADO DE COMPRAS", "FIRMA DEL AUTORIZANTE"]) expect(contenido).toContain(dato);
  expect(contenido).not.toMatch(/Tenant Real|FIRMA DEL SOLICITANTE|Detalle de compra - Línea/);
  // COMPRAS-NOTIFICACIONES Parte A: "Registrado por (solicitante)" se quitó
  // del PDF — el nombre del solicitante (María Peña en este fixture) ya no
  // debe aparecer en ningún bloque de texto del reporte impreso.
  expect(contenido).not.toContain("Registrado por");
  expect(contenido).not.toContain(d.solicitante_nombre!);
  if (estado === "Autorizada") {
    expect(image).toHaveBeenCalled();
    expect(image.mock.results.map(r => r.type === "throw" ? String(r.value) : r.type)).toEqual(["return"]);
    expect(bytes.toString("latin1")).toContain("/Subtype /Image");
    expect(contenido).toContain("Gerente Histórico");
    for (const dato of ["Autorizado por:", "Rol al firmar:", "Fecha/hora:", "Código de firma:", firma.codigo, firma.rol]) expect(contenido).not.toContain(dato);
  } else {
    expect(image).not.toHaveBeenCalled(); expect(contenido).not.toContain(firma.codigo);
    if (estado === "Pendiente") expect(contenido).toContain("PENDIENTE DE AUTORIZACIÓN");
    else { expect(contenido).toContain("RECHAZADA"); expect(contenido).toContain(d.motivo_rechazo); }
  }
  guardarQA(`${estado}.pdf`, bytes);
});

it("PDF conserva texto largo completo y pagina sin truncar observaciones", async () => {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  const largo = "Texto largo de observaciones. ".repeat(250) + "FIN OBSERVACIONES";
  const bytes = await requerimientoCompraPdf({ ...d, lineas: [{ ...d.lineas[0], observaciones: largo }] }, "Tenant Real", null);
  expect(text.mock.calls.some(c => String(c[0]).endsWith("FIN OBSERVACIONES"))).toBe(true);
  const pies = text.mock.calls.filter(c => String(c[0]).startsWith("Página "));
  expect(pies.length).toBeGreaterThan(1);
  guardarQA("Multipagina.pdf", bytes);
});

it("Excel válido: cabecera, snapshots, todas las líneas, fechas y moneda numéricas, total persistido", async () => {
  // Total diferente a la suma adrede: el reporte debe mostrar el persistido, nunca recalcularlo.
  const bytes = await requerimientoCompraExcel({ ...d, total: "1300.00" }, "Tenant Real");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(bytes).buffer);
  expect(wb.worksheets).toHaveLength(1);
  const ws = wb.worksheets[0];
  expect(ws.name.length).toBeLessThanOrEqual(31);
  expect(ws.getCell("A1").value).toBe("Tenant Real"); expect(ws.getCell("A2").value).toBe("REQUERIMIENTO DE COMPRA");
  expect(ws.getCell("A3").value).toContain(d.codigo); expect(ws.getCell("A4").value).toContain("Pendiente");
  expect(ws.getRow(7).values).toEqual([undefined, ...COLUMNAS_EXCEL_COMPRA]);
  expect(COLUMNAS_EXCEL_COMPRA).not.toContain("Tipo de pago");
  for (const [i, linea] of d.lineas.entries()) {
    const row = ws.getRow(8 + i);
    expect(row.getCell(1).value).toBeInstanceOf(Date); expect(row.getCell(7).value).toBeInstanceOf(Date);
    expect(row.getCell(2).value).toBe(d.entidad_requirente_nombre); expect(row.getCell(3).value).toBe(d.requirente_nombre);
    expect(row.getCell(4).value).toBe(d.solicitante_nombre); expect(row.getCell(5).value).toBe(d.encargado_compras_nombre);
    expect(row.getCell(6).value).toBe(linea.unidad_descripcion); expect(row.getCell(10).value).toBe(linea.proveedor_nombre_snapshot);
    expect(row.getCell(14).value).toBe(Number(linea.total)); expect(row.getCell(14).numFmt).toBe('"Q "#,##0.00');
  }
  expect(ws.getCell("N11").value).toBe(1300); expect(ws.autoFilter).toBe("A7:O9");
  guardarQA("Requerimiento.xlsx", bytes);
});

it("Excel refleja rechazo y fallback histórico sin sustituir snapshots por tenant", async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(await requerimientoCompraExcel({ ...d, estado: "Rechazada", entidad_requirente_nombre: null }, "Tenant B")).buffer);
  const ws = wb.worksheets[0]; expect(ws.getCell("B8").value).toBe("Sin dato histórico");
  expect(ws.getCell("A4").value).toContain("Rechazada"); expect(ws.getCell("B13").value).toBe(d.motivo_rechazo);
});

it.each(["Pendiente", "Autorizada", "Rechazada"] as const)("UI %s: botones disponibles con ver, sin compras_autorizar", async estado => {
  m.acceso.mockResolvedValue({ empresa: { id: 1 }, session: { nombre: "Actual" }, permisos: [{ modulo: "compras_requerimientos", puedeVer: true }] });
  m.detalle.mockResolvedValue({ ...d, estado });
  const html = renderToStaticMarkup(await DetallePage({ params: Promise.resolve({ slug: "a", id: "12" }), searchParams: Promise.resolve({}) }));
  for (const tipo of ["pdf", "excel"]) expect(html).toContain(`/api/empresas/a/compras/requerimientos/12/${tipo}`);
  expect(html).toContain("Descargar PDF"); expect(html).toContain("Descargar Excel");
});
it("UI sin ver no expone descargas", async () => {
  m.acceso.mockResolvedValue({ error: true });
  expect(renderToStaticMarkup(await DetallePage({ params: Promise.resolve({ slug: "a", id: "12" }), searchParams: Promise.resolve({}) }))).not.toContain("Descargar");
});
it("solo Compras: reutiliza patrón, no cambia snapshots/firmas actuales ni SQL", () => {
  const source = readFileSync("src/lib/compras/requerimiento-exportaciones.ts", "utf8");
  expect(source).toContain("dibujarTablaEnDoc"); expect(source).toContain("altoFirmas");
  expect(source).not.toMatch(/usuario_firmas|leerBytesFirmaGuardada|Tipo de pago/);
});

it.each([1, 5, 30])("QA autorizada %i líneas: páginas naturales y tres firmas al final", async cantidad => {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  const image = vi.spyOn(PDFDocument.prototype, "image");
  const bytes = await requerimientoCompraPdf({ ...d, estado: "Autorizada", observaciones: null, lineas: Array.from({ length: cantidad }, (_, i) => ({ ...d.lineas[0], id: i + 1, observaciones: null })) }, "Tenant combinado", { requirente: firma, encargado: firma, autorizante: firma });
  expect(image).toHaveBeenCalledTimes(3);
  const paginas = text.mock.calls.filter(c => String(c[0]).startsWith("Página ")).length;
  expect(paginas).toBe(cantidad < 10 ? 1 : 3);
  for (const etiqueta of ["FIRMA DE LA PERSONA QUE REQUIERE", "FIRMA DEL ENCARGADO DE COMPRAS", "FIRMA DEL AUTORIZANTE"]) expect(text.mock.calls.filter(c => c[0] === etiqueta)).toHaveLength(1);
  guardarQA(`Autorizada-${cantidad}.pdf`, bytes);
});
it("recordatorios fieles, orden final y sin metadata técnica visible", async () => {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  await requerimientoCompraPdf({ ...d, estado: "Autorizada" }, "Tenant", { requirente: firma, encargado: firma, autorizante: firma });
  const textos = text.mock.calls.map(c => String(c[0]));
  expect(RECORDATORIOS_COMPRA).toEqual([
    "1. RECORDAR QUE LAS FACTURAS DEBEN SALIR A NOMBRE Y NIT DE LA EMPRESA REQUIRENTE",
    "2. Este formulario impreso, también debe ser enviado en Excel a Tesorería y a Contabilidad quien llevara un acumulado de requerimientos durante el mes para poder sacar",
    "3. Realizada la compra, presentar la factura sellada con una fotocopia de este requerimiento al frente para saber a que requerimiento corresponden y evitar cruces.",
    "4. Si al realizar la compra hubiere algún sobrante de efectivo, depositar o transferir a la cuenta de la empresa requirente el sobrante y con eso se liquidara el anticipo realizado.",
    "5. Se recomienda el requerimiento de la semana siguiente, los Jueves o Viernes por la mañana, para dejar programados los pagos y transferir a primera hora.",
  ]);
  let anterior = textos.indexOf(d.autorizante_nombre!);
  for (const recordatorio of RECORDATORIOS_COMPRA) { const indice = textos.indexOf(recordatorio); expect(indice).toBeGreaterThan(anterior); anterior = indice; }
  expect(textos.indexOf(FRASE_INSTITUCIONAL_COMPRA)).toBeGreaterThan(anterior);
  expect(FRASE_INSTITUCIONAL_COMPRA).toBe("EL ORDEN Y LA DISCIPLINA SON LA BASE PARA UN SERVICIO DE CALIDAD, EFICIENCIA Y SATISFACCIÓN A NUESTRO CLIENTE");
  expect(textos.join("\n")).not.toMatch(/Autorizado por:|Rol al firmar:|Fecha\/hora:|Código de firma:/);
});
it("PDF sin entidad utiliza fallback explícito y total persistido", async () => {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  await requerimientoCompraPdf({ ...d, entidad_requirente_nombre: null, total: "999.00" }, "Nombre combinado prohibido", null);
  const contenido = text.mock.calls.map(c => c[0]).join("\n");
  expect(contenido).toContain("EMPRESA REQUIRENTE NO REGISTRADA"); expect(contenido).toContain("TOTAL: Q 999.00"); expect(contenido).not.toContain("Nombre combinado prohibido");
});
it.each(["Autorizada", "Pendiente", "Rechazada"] as const)("PDF %s imágenes históricas opcionales, tres bloques sin alterar página", async estado => {
  const image = vi.spyOn(PDFDocument.prototype, "image");
  const text = vi.spyOn(PDFDocument.prototype, "text");
  const bytes = await requerimientoCompraPdf({ ...d, estado, observaciones: null, lineas: [{ ...d.lineas[0], observaciones: null }] }, "Tenant", {
    requirente: firma, encargado: firma, autorizante: firma,
  });
  expect(image).toHaveBeenCalledTimes(estado === "Autorizada" ? 3 : 2);
  expect(text.mock.calls.filter(c => String(c[0]).startsWith("Página "))).toHaveLength(1);
  for (const etiqueta of ["FIRMA DE LA PERSONA QUE REQUIERE", "FIRMA DEL ENCARGADO DE COMPRAS", "FIRMA DEL AUTORIZANTE"]) expect(text.mock.calls.filter(c => c[0] === etiqueta)).toHaveLength(1);
  expect(text.mock.calls.map(c => c[0]).join("\n")).not.toContain("FIRMA DEL SOLICITANTE");
  guardarQA(`Tres-firmas-${estado}.pdf`, bytes);
});
