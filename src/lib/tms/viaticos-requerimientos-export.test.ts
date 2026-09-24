import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ query: queryMock, getPool: vi.fn() }));

import {
  cabeceraRequerimiento,
  ENCABEZADOS_REQUERIMIENTO_EXCEL,
  ENCABEZADOS_REQUERIMIENTO_PDF,
  filasRequerimiento,
  requerimientoViaticoExcel,
  requerimientoViaticoPdf,
} from "./viaticos-requerimientos-export";

/** PNG 1x1 real (pdfkit lo decodifica). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

type Req = Parameters<typeof requerimientoViaticoExcel>[0];
const linea = (i: number, extra: Record<string, unknown> = {}) => ({
  id: i, fecha_solicitud: "2026-09-22", fecha_viaje: "2026-09-24", personal_nombre_snapshot: `Piloto ${i}`, cargo_snapshot: "Piloto",
  cuenta_snapshot: `0100-${1000 + i}`, banco_snapshot: "Banrural", placa_snapshot: "C-123ABC", cliente_nombre_snapshot: "Cliente",
  destino: "Escuintla", cantidad: "2", monto_unitario: "100.25", total: "200.50", ...extra,
});
const base = (n = 1, extra: Record<string, unknown> = {}): Req => ({
  id: 1, codigo: "VR-2026-000001", estado: "AUTORIZADO", total: (200.5 * n).toFixed(2), fecha_requerimiento: "2026-09-21",
  periodo_tipo: "SEMANA", periodo_desde: "2026-09-21", periodo_hasta: "2026-09-27",
  empresa_requirente_nombre: "KuiqTrans", requirente_nombre_snapshot: "Ana", solicitante_nombre_snapshot: "Luis",
  autorizado_por_nombre: "Carlos", autorizado_en: "2026-09-21 10:30:00", observaciones: "Prueba",
  lineas: Array.from({ length: n }, (_, i) => linea(i + 1)), ...extra,
}) as Req;

async function pdf(d: Req, aut: Buffer | null = null, req: Buffer | null = null) {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  const image = vi.spyOn(PDFDocument.prototype, "image");
  const addPage = vi.spyOn(PDFDocument.prototype, "addPage");
  const bytes = await requerimientoViaticoPdf(d, aut, req);
  const valores = text.mock.calls.map(c => String(c[0]));
  const folio = valores.map(v => /^Página \d+ de (\d+) · /.exec(v)).find(Boolean);
  return { bytes, valores, imagenes: image.mock.calls.length, paginas: Number(folio?.[1] ?? 0), addPageCalls: addPage.mock.calls.length };
}
afterEach(() => { vi.restoreAllMocks(); queryMock.mockReset(); });

describe("PDF — cabecera y tabla del formato administrativo", () => {
  it("cabecera: título, fecha, empresa, requiere, solicitante, periodo y estado", async () => {
    const { valores, bytes } = await pdf(base());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    for (const v of ["REQUERIMIENTO DE VIÁTICOS", "21/09/2026", "KuiqTrans", "Ana", "Luis", "AUTORIZADO", "Semana 21/09/2026 – 27/09/2026"]) expect(valores).toContain(v);
    for (const r of ["Fecha del requerimiento: ", "Empresa requirente: ", "Persona que requiere: ", "Solicitante: ", "Periodo: ", "Estado: "]) expect(valores).toContain(r);
  });

  it("periodo Día y Mes con el formato pedido", async () => {
    expect((await pdf(base(1, { periodo_tipo: "DIA", periodo_desde: "2026-09-21", periodo_hasta: "2026-09-21" }))).valores).toContain("Día 21/09/2026");
    expect((await pdf(base(1, { periodo_tipo: "MES", periodo_desde: "2026-09-01", periodo_hasta: "2026-09-30" }))).valores).toContain("Mes septiembre 2026");
  });

  it("todos los encabezados de la tabla y las celdas (incluido No. de cuenta) salen del snapshot", async () => {
    const { valores } = await pdf(base());
    for (const h of ENCABEZADOS_REQUERIMIENTO_PDF) expect(valores).toContain(h);
    expect(ENCABEZADOS_REQUERIMIENTO_PDF).toEqual(["No.", "Fecha solicitud", "Fecha viaje", "Nombre", "No. cuenta", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga / destino", "Total"]);
    for (const v of ["22/09/2026", "24/09/2026", "Piloto 1", "0100-1001", "Piloto", "C-123ABC", "Cliente", "Escuintla", "Q 200.50"]) expect(valores).toContain(v);
  });

  it("total general correcto y una sola vez", async () => {
    const { valores } = await pdf(base(3));
    expect(valores.filter(v => v.startsWith("TOTAL: "))).toEqual(["TOTAL: Q 601.50"]);
  });
});

describe("PDF — firmas", () => {
  it("requirente == sesión: se muestra su imagen; el autorizante también (una vez cada una)", async () => {
    const r = await pdf(base(), PNG, PNG);
    expect(r.imagenes).toBe(2);
    expect(r.valores).toContain("Carlos");
    expect(r.valores).toContain("Fecha y hora: 21/09/2026 10:30");
  });

  it("requirente distinto: SIN imagen del requirente (espacio para firma física) y solo la firma del autorizante", async () => {
    const r = await pdf(base(), PNG, null);
    expect(r.imagenes).toBe(1);
    expect(r.valores).toContain("FIRMA DE LA PERSONA QUE REQUIERE");
    expect(r.valores).toContain("Ana");
  });

  it("sin firmas: ninguna imagen", async () => {
    expect((await pdf(base(), null, null)).imagenes).toBe(0);
  });
});

describe("PDF — multipágina", () => {
  it("repite encabezados por página; total y firmas solo al final; sin páginas vacías", async () => {
    const r = await pdf(base(45), PNG, PNG);
    const paginas = r.paginas;
    expect(paginas).toBeGreaterThan(1);
    expect(r.valores.filter(v => v === "Fecha solicitud")).toHaveLength(paginas); // encabezado en CADA página
    expect(r.valores.filter(v => v.startsWith("TOTAL: "))).toHaveLength(1);
    expect(r.valores.filter(v => v === "AUTORIZADO POR")).toHaveLength(1);
    expect(r.valores.filter(v => v === "FIRMA DE LA PERSONA QUE REQUIERE")).toHaveLength(1);
    expect(r.imagenes).toBe(2);
    // cada página tiene filas: 45 filas caben en ⌈45 / filas-por-página⌉ páginas, nunca una de más
    expect(r.valores.filter(v => /^Piloto \d+$/.test(v))).toHaveLength(45);
    expect(paginas).toBeLessThanOrEqual(Math.ceil(45 / 14));
    const folios = r.valores.filter(v => /^Página \d+ de \d+ · /.test(v));
    expect(folios).toHaveLength(paginas);
    expect(folios[paginas - 1]).toContain(`Página ${paginas} de ${paginas}`);
  });

  it("la última fila nunca deja las firmas solas en una página nueva", async () => {
    for (const n of [12, 13, 14, 15, 16, 26, 27, 28, 29]) {
      const r = await pdf(base(n), PNG, PNG);
      const paginas = r.paginas;
      expect(r.valores.filter(v => v === "Fecha solicitud")).toHaveLength(paginas); // toda página nueva trae encabezado + al menos una fila
      vi.restoreAllMocks();
    }
  });
});

describe("Excel — mismo contenido lógico que el PDF", () => {
  async function libro(d: Req) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(await requerimientoViaticoExcel(d)).buffer);
    return wb.worksheets[0];
  }

  it("encabezado superior con título, fecha, empresa, requiere, solicitante, periodo y estado", async () => {
    const ws = await libro(base());
    expect(ws.getCell("A1").value).toBe("REQUERIMIENTO DE VIÁTICOS");
    const filas = [2, 3, 4, 5, 6, 7].map(r => [ws.getCell(r, 1).value, ws.getCell(r, 4).value]);
    expect(filas).toEqual([
      ["Fecha del requerimiento", "21/09/2026"], ["Empresa requirente", "KuiqTrans"], ["Persona que requiere", "Ana"],
      ["Solicitante", "Luis"], ["Periodo", "Semana 21/09/2026 – 27/09/2026"], ["Estado", "AUTORIZADO"],
    ]);
  });

  it("columnas del formato + Banco; filtros, freeze panes, anchos, moneda y total general", async () => {
    const ws = await libro(base(2));
    const h = ws.getRow(9);
    expect((h.values as unknown[]).slice(1)).toEqual([...ENCABEZADOS_REQUERIMIENTO_EXCEL]);
    expect(ENCABEZADOS_REQUERIMIENTO_EXCEL).toEqual(["No.", "Fecha solicitud", "Fecha viaje", "Nombre", "No. cuenta", "Banco", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga / destino", "Total"]);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 9 });
    expect(ws.getColumn(4).width).toBeGreaterThan(20);
    expect(ws.getColumn(12).numFmt).toContain("#,##0.00");
    const ultima = ws.getRow(ws.rowCount);
    expect(ultima.getCell(11).value).toBe("TOTAL GENERAL");
    expect(ultima.getCell(12).value).toBe(401);
  });

  it("mismas líneas que el PDF: cuenta, banco, fechas, cliente, destino y total por fila", async () => {
    const d = base(3);
    const ws = await libro(d);
    const esperadas = filasRequerimiento(d);
    esperadas.forEach((f, i) => {
      const r = ws.getRow(10 + i);
      expect(r.getCell(1).value).toBe(f.no);
      expect(r.getCell(4).value).toBe(f.nombre);
      expect(r.getCell(5).value).toBe(`0100-${1001 + i}`);
      expect(r.getCell(6).value).toBe("Banrural");
      expect(r.getCell(2).value).toBe("22/09/2026");
      expect(r.getCell(11).value).toBe("Escuintla");
      expect(r.getCell(12).value).toBe(200.5);
    });
    expect(esperadas).toHaveLength(3);
  });
});

describe("snapshots históricos: nada se recalcula ni se consulta al exportar", () => {
  it("PDF y Excel no ejecutan ninguna consulta a BD (todo sale del requerimiento persistido)", async () => {
    const d = base(2);
    await pdf(d, PNG, PNG);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(await requerimientoViaticoExcel(d)).buffer);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("si el empleado cambió de cuenta después, el requerimiento ya emitido conserva la anterior", async () => {
    const d = base(1);
    const antes = filasRequerimiento(d)[0];
    queryMock.mockResolvedValue([{ cuenta_bancaria: "NUEVA-999", banco: "Otro" }]); // "cuenta actual" ahora distinta
    expect((await pdf(d)).valores).toContain("0100-1001");
    expect(filasRequerimiento(d)[0]).toEqual(antes);
    expect(antes.cuenta).toBe("0100-1001");
    expect(antes.banco).toBe("Banrural");
  });

  it("requerimiento anterior a la migración (sin periodo/cuenta): salen guiones, no se rompe", async () => {
    const d = base(1, { periodo_tipo: null, periodo_desde: null, periodo_hasta: null, lineas: [linea(1, { cuenta_snapshot: null, banco_snapshot: null })] });
    expect(cabeceraRequerimiento(d).periodo).toBe("—");
    expect(filasRequerimiento(d)[0]).toMatchObject({ cuenta: "—", banco: "—" });
    expect((await pdf(d)).bytes.length).toBeGreaterThan(1000);
  });

  it("el módulo de exportación no relee cuentas/empleados vivos", () => {
    const src = readFileSync("src/lib/tms/viaticos-requerimientos-export.ts", "utf8");
    expect(src).not.toMatch(/cuenta_bancaria|FROM empleados|tms_personal|flota_vehiculos|tms_clientes/);
    expect(src.match(/query</g)).toHaveLength(1); // solo la lectura de la imagen de firma
  });
});
