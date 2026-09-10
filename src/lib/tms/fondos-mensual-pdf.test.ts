import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));
vi.mock("@/lib/tms/viaticos-comprobante-pdf", () => ({ tituloEmpresa: (n: string) => n }));

import { query } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import { generarPdfMensualSolicitudesFondo } from "./fondos-mensual-pdf";
import { agruparSolicitudesFondo, resumenMensualFondos, type FilaSolicitudFondoReporte } from "./reportes-gastos";

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — PDF mensual consolidado de
 * Solicitudes de fondo. Mismo criterio de prueba que
 * fondos-solicitud-pdf.test.ts: pdfkit comprime el contenido, así que se
 * espía PDFDocument.prototype.text (delegando a la real) para verificar
 * qué texto se dibuja, y se cuentan páginas con `/Type /Page`.
 */
function espiarTexto() {
  return vi.spyOn(PDFDocument.prototype, "text");
}
function textos(spy: ReturnType<typeof espiarTexto>): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}
function contarPaginas(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
}
function mediaBox(buf: Buffer): { w: number; h: number } | null {
  const m = buf.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function linea(over: Partial<FilaSolicitudFondoReporte> = {}): FilaSolicitudFondoReporte {
  return {
    lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010",
    fechaSolicitud: "2026-09-03", fechaViaje: "2026-09-04",
    empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "1980305722",
    vehiculoId: 9, placa: "C-130BQ", clienteId: 5, clienteNombre: "Cliente A", planId: null,
    cantidad: 2, descripcion: "Combustible diesel", monto: 100, total: 200,
    requirenteNombre: "Mario Caal", solicitanteNombre: "Ana Gómez", autorizanteNombre: "Heber Sitan",
    fechaAutorizacion: "2026-09-04", totalSolicitud: 600, estadoFondo: "Autorizada",
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(query).mockResolvedValue([] as never); // sin snapshots de firma por defecto
});
afterEach(() => vi.restoreAllMocks());

async function generar(filas: FilaSolicitudFondoReporte[], mes = 9, anio = 2026) {
  const grupos = agruparSolicitudesFondo(filas);
  return generarPdfMensualSolicitudesFondo(7, "SITSA", grupos, resumenMensualFondos(grupos), { anio, mes });
}

describe("generarPdfMensualSolicitudesFondo", () => {
  it("genera un PDF landscape LETTER (792 × 612) válido", async () => {
    const buf = await generar([linea()]);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const box = mediaBox(buf);
    expect(box).not.toBeNull();
    expect(Math.round(box!.w)).toBe(792);
    expect(Math.round(box!.h)).toBe(612);
    expect(box!.w).toBeGreaterThan(box!.h);
  });

  it("dibuja el bloque de cada solicitud y el RESUMEN DEL MES", async () => {
    const spy = espiarTexto();
    await generar([
      linea({ lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010" }),
      linea({ lineaId: 2, solicitudId: 11, solicitudCodigo: "FONDO-000011", totalSolicitud: 900, estadoFondo: "Liquidada" }),
    ]);
    const t = textos(spy);
    expect(t).toContain("SOLICITUD FONDO-000010");
    expect(t).toContain("SOLICITUD FONDO-000011");
    expect(t).toContain("Persona que requiere: MARIO CAAL");
    expect(t).toContain("Estado: Autorizada");
    expect(t).toContain("Estado: Liquidada");
    expect(t).toContain("TOTAL SOLICITUD: Q 600.00");
    expect(t).toContain("TOTAL SOLICITUD: Q 900.00");
    // 3 firmas por solicitud (2 solicitudes -> 2 de cada título).
    expect(t.filter((x) => x === "FIRMA DEL REQUIRIENTE")).toHaveLength(2);
    expect(t.filter((x) => x === "FIRMA DEL SOLICITANTE")).toHaveLength(2);
    expect(t.filter((x) => x === "FIRMA DEL AUTORIZANTE")).toHaveLength(2);
    // RESUMEN DEL MES al final.
    expect(t).toContain("RESUMEN DEL MES");
    expect(t).toContain("Total solicitudes: 2");
    expect(t).toContain("Total autorizadas: 1");
    expect(t).toContain("Total liquidadas: 1");
    expect(t).toContain("TOTAL GENERAL DEL MES: Q 1,500.00"); // 600 + 900
  });

  it("cada solicitud arranca en página nueva y el documento tiene varias páginas", async () => {
    const buf = await generar([
      linea({ lineaId: 1, solicitudId: 10 }),
      linea({ lineaId: 2, solicitudId: 11, solicitudCodigo: "FONDO-000011" }),
      linea({ lineaId: 3, solicitudId: 12, solicitudCodigo: "FONDO-000012" }),
    ]);
    // 3 bloques + 1 página de resumen = 4 (o más si algún bloque desborda).
    expect(contarPaginas(buf)).toBeGreaterThanOrEqual(4);
  });

  it("pie de cada página: 'Página X de Y' + período del reporte", async () => {
    const spy = espiarTexto();
    await generar([linea()], 9, 2026);
    const t = textos(spy);
    expect(t.some((x) => /Página 1 de \d+ · Período: Septiembre 2026/.test(x))).toBe(true);
  });

  it("REGLA DE FIRMAS — sin snapshot en firmas_electronicas: muestra el nombre y NO dibuja imagen (nunca inventa una firma)", async () => {
    vi.mocked(query).mockResolvedValue([] as never); // ningún snapshot
    const imageSpy = vi.spyOn(PDFDocument.prototype, "image");
    const spy = espiarTexto();
    await generar([linea()]);
    expect(imageSpy).not.toHaveBeenCalled();
    const t = textos(spy);
    expect(t).toContain("Mario Caal");
    expect(t).toContain("Ana Gómez");
  });

  it("REGLA DE FIRMAS — con snapshot histórico (firmas_electronicas): usa ESA imagen y nunca consulta usuario_firmas", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      expect(sql).toContain("firmas_electronicas");
      expect(sql).not.toContain("usuario_firmas");
      // firmaHistorica manda [empresaId, solicitudId, accion]. Solo el
      // autorizante tiene snapshot.
      if ((params as unknown[])?.[2] !== "AUTORIZAR_FONDO") return [];
      return [{ payload_canonico: JSON.stringify({ nombreFirmante: "Ana Gómez" }), imagen_ruta: "firmas/a.png", imagen_mime: "image/png" }];
    }) as typeof query);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);
    const imageSpy = vi.spyOn(PDFDocument.prototype, "image");
    await generar([linea()]);
    expect(imageSpy).toHaveBeenCalledTimes(1); // solo la firma real del autorizante
  });

  it("sin solicitudes en el período: PDF válido con solo el RESUMEN DEL MES en cero", async () => {
    const spy = espiarTexto();
    const buf = await generar([]);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const t = textos(spy);
    expect(t).toContain("RESUMEN DEL MES");
    expect(t).toContain("Total solicitudes: 0");
    expect(t).toContain("TOTAL GENERAL DEL MES: Q 0.00");
  });
});
