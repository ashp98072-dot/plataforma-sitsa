import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { reforzarFirmaParaPdf } from "@/lib/firmas/reforzar-firma-pdf";
import { formatearTimestampVisible } from "@/lib/rrhh/dates";
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

// COMPRAS-EXCEL-ADMINISTRATIVO: helpers para no depender de direcciones de
// celda fijas (el layout crece/encoge según observaciones/estado).
function textoCompleto(ws: ExcelJS.Worksheet): string {
  const out: string[] = [];
  ws.eachRow(row => row.eachCell({ includeEmpty: false }, cell => { if (cell.value != null) out.push(String(cell.value)); }));
  return out.join("\n");
}
function filaConValores(ws: ExcelJS.Worksheet, valores: readonly string[]): number | undefined {
  let encontrada: number | undefined;
  ws.eachRow((row, n) => {
    const vals = (row.values as unknown[]).slice(1).map(v => v == null ? undefined : String(v));
    if (vals.length === valores.length && valores.every((v, i) => vals[i] === v)) encontrada = n;
  });
  return encontrada;
}

it.each(["Pendiente", "Autorizada", "Rechazada"] as const)("Excel %s: mismo formato administrativo que el PDF, sin firmas", async estado => {
  // Total diferente a la suma adrede: el reporte debe mostrar el persistido, nunca recalcularlo.
  const detalle = { ...d, estado, total: "1300.00" };
  const bytes = await requerimientoCompraExcel(detalle, "Tenant Real (nunca debe aparecer como título)");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(bytes).buffer);
  expect(wb.worksheets).toHaveLength(1);
  const ws = wb.worksheets[0];
  expect(ws.name.length).toBeLessThanOrEqual(31);

  // Encabezado: empresa requirente (nunca el tenant), título exacto.
  expect(ws.getCell("A1").value).toBe(d.entidad_requirente_nombre);
  expect(ws.getCell("A2").value).toBe("REQUERIMIENTO DE REPUESTOS");
  expect(String(ws.getCell("A2").value)).not.toBe("REQUERIMIENTO DE COMPRA");
  const texto = textoCompleto(ws);
  expect(texto).not.toContain("Tenant Real");
  expect(texto).toContain(d.codigo);
  expect(texto).toContain(estado);
  expect(texto).toContain(`Persona que requiere: ${d.requirente_nombre}`);
  expect(texto).toContain(`Encargado de compras: ${d.encargado_compras_nombre}`);

  // Datos que ya no deben estar visibles (sección 3/14 del ticket) — no se
  // borran de BD, solo no se presentan en este Excel administrativo.
  expect(texto).not.toContain("Solicitante"); expect(texto).not.toContain(d.solicitante_nombre!);
  expect(texto).not.toContain("Registrado por");

  // Tabla: exactamente las 9 columnas del PDF, mismo orden.
  expect(COLUMNAS_EXCEL_COMPRA).toEqual([
    "No.", "Unidad / placa", "Fecha", "Serie / factura", "Proveedor", "Repuesto a comprar", "Método de pago", "Condición", "Total",
  ]);
  const filaHeader = filaConValores(ws, COLUMNAS_EXCEL_COMPRA);
  expect(filaHeader).toBeDefined();
  for (const [i, linea] of detalle.lineas.entries()) {
    const row = ws.getRow(filaHeader! + 1 + i);
    expect(row.getCell(3).value).toBeInstanceOf(Date); // Fecha de línea, no la del requerimiento.
    expect(row.getCell(4).value).toBe(`${linea.serie_factura} / ${linea.numero_factura}`); // Serie / factura combinadas.
    expect(row.getCell(5).value).toBe(linea.proveedor_nombre_snapshot);
    expect(row.getCell(6).value).toBe(linea.repuesto_descripcion);
    expect(row.getCell(9).value).toBe(Number(linea.total)); // Total de línea numérico.
    expect(row.getCell(9).numFmt).toBe('"Q "#,##0.00');
  }
  // La tabla ya NO repite fecha/empresa/persona/solicitante/encargado por línea.
  expect(ws.getRow(filaHeader! + 1).values).toHaveLength(10); // undefined + 9 columnas, nunca 15.

  // TOTAL general = d.total persistido, numérico, formato Q, nunca recalculado.
  expect(texto).not.toContain("1,251"); // suma de líneas del fixture ≠ total persistido
  let totalEncontrado = false;
  ws.eachRow(row => { const c9 = row.getCell(9); if (c9.value === 1300 && c9.numFmt === '"Q "#,##0.00') totalEncontrado = true; });
  expect(totalEncontrado).toBe(true);

  // Observaciones: fuera de la tabla (no son una columna), solo si existen.
  expect(texto).toContain(`Observaciones de línea 1: ${detalle.lineas[0].observaciones}`);
  expect(texto).toContain(`Observaciones de línea 2: ${detalle.lineas[1].observaciones}`);
  expect(texto).toContain(`Observaciones del requerimiento: ${detalle.observaciones}`);

  // Estado.
  if (estado === "Pendiente") expect(texto).toContain("PENDIENTE DE AUTORIZACIÓN");
  if (estado === "Rechazada") {
    expect(texto).toContain("RECHAZADA");
    expect(texto).toContain(`Fecha de rechazo: ${formatearTimestampVisible(detalle.rechazado_en)}`);
    expect(texto).toContain(`Motivo: ${detalle.motivo_rechazo}`);
  }
  // Autorizada: sin metadata técnica de firma, nunca.
  for (const dato of ["Autorizado por:", "Rol al firmar:", "Fecha/hora:", "Código de firma:"]) expect(texto).not.toContain(dato);

  // Sin firmas en ningún estado: ni etiquetas ni imágenes.
  for (const etiqueta of ["FIRMA DE LA PERSONA QUE REQUIERE", "FIRMA DEL ENCARGADO DE COMPRAS", "FIRMA DEL AUTORIZANTE"]) expect(texto).not.toContain(etiqueta);
  let tieneImagenes = false;
  ws.eachRow(() => {}); // no-op: exceljs expone imágenes vía ws.getImages(), no en celdas.
  tieneImagenes = ws.getImages().length > 0;
  expect(tieneImagenes).toBe(false);

  // Recordatorios (reutilizados, no duplicados en otra constante) + frase institucional.
  for (const recordatorio of RECORDATORIOS_COMPRA) expect(texto).toContain(recordatorio);
  expect(texto).toContain(FRASE_INSTITUCIONAL_COMPRA);
  expect(RECORDATORIOS_COMPRA[1]).toMatch(/sacar$/);

  // Impresión: landscape, ancho a una página, sin gridlines.
  expect(ws.pageSetup.orientation).toBe("landscape");
  expect(ws.pageSetup.fitToWidth).toBe(1);
  expect(ws.pageSetup.fitToHeight).toBe(0);
  expect(ws.views?.[0]?.showGridLines).toBe(false);

  // REGRESIÓN: row.border = x (a diferencia de font/alignment) fija el
  // borde como estilo POR DEFECTO de toda la fila en ExcelJS — Excel lo
  // pinta como una cuadrícula fantasma mucho más allá de las 9 columnas
  // reales (J en adelante, vacías). Ninguna celda fuera de la tabla debe
  // tener borde.
  const columnasTabla = COLUMNAS_EXCEL_COMPRA.length;
  ws.eachRow(row => {
    for (let c = columnasTabla + 1; c <= columnasTabla + 10; c++) {
      const cell = row.getCell(c);
      expect(cell.border, `fila ${row.number} columna ${c} no debe tener borde`).toEqual({});
    }
  });

  guardarQA(`Requerimiento-${estado}.xlsx`, bytes);
});

it("Excel usa fallback histórico de empresa requirente y NO sustituye snapshots por el tenant", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(await requerimientoCompraExcel({ ...d, entidad_requirente_nombre: null }, "Tenant B")).buffer);
  const ws = wb.worksheets[0];
  expect(ws.getCell("A1").value).toBe("EMPRESA REQUIRENTE NO REGISTRADA");
  expect(textoCompleto(ws)).not.toContain("Tenant B");
});

it.each([1, 5, 30])("Excel QA %i líneas: filas completas, sin truncar, imprime en una página de ancho", async cantidad => {
  const detalle = { ...d, observaciones: null, lineas: Array.from({ length: cantidad }, (_, i) => ({ ...d.lineas[0], id: i + 1, observaciones: null })) };
  const bytes = await requerimientoCompraExcel(detalle, "Tenant");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(bytes).buffer);
  const ws = wb.worksheets[0];
  const filaHeader = filaConValores(ws, COLUMNAS_EXCEL_COMPRA)!;
  for (let i = 0; i < cantidad; i++) expect(ws.getRow(filaHeader + 1 + i).getCell(6).value).toBe(detalle.lineas[i].repuesto_descripcion);
  expect(ws.pageSetup.fitToWidth).toBe(1);
  guardarQA(`Excel-QA-${cantidad}-lineas.xlsx`, bytes);
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
