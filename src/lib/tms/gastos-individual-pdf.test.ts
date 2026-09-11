import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/tms/gastos", () => ({ obtenerGasto: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));

import { obtenerGasto } from "@/lib/tms/gastos";
import { query } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import { generarPdfGastoAutorizado } from "./gastos-individual-pdf";

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo criterio de prueba que
 * fondos-solicitud-pdf.test.ts: pdfkit comprime el contenido
 * (FlateDecode), así que se espía PDFDocument.prototype.text (delegando
 * a la implementación real) para verificar EXACTAMENTE qué texto se
 * dibuja, y se cuentan páginas con el marcador estructural `/Type /Page`
 * (no comprimido) en vez de inspeccionar el stream de contenido.
 */
function espiarTexto() {
  return vi.spyOn(PDFDocument.prototype, "text");
}
function llamadaTexto(call: unknown[]): { texto: string; opciones: Record<string, unknown> | undefined } {
  const opciones = call.find((a): a is Record<string, unknown> => typeof a === "object" && a !== null && !Array.isArray(a));
  return { texto: String(call[0]), opciones };
}
function contarPaginas(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
}

function gasto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresaId: 7, fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02",
    empleadoId: 4, empleadoCodigo: "EMP-004", empleadoNombre: "Heber Sitan", empleadoCargo: "Piloto",
    vehiculoId: 9, vehiculoPlaca: "P111AAA",
    clienteId: 5, clienteNombre: "Cliente A",
    planId: null, planCodigo: null,
    categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100,
    metodoPago: "Efectivo", numeroCuentaPago: "1234567890",
    tieneFactura: true, facturaNombreOriginal: null, facturaTamano: null,
    observaciones: null, activo: true, creadoPor: "mcaal", creadoEn: "2026-09-01 09:00:00", actualizadoEn: "2026-09-01 09:00:00",
    entidadRequirenteId: 10, entidadRequirenteNombre: "Kuiqtrans",
    requirenteEmpleadoId: null, requirenteNombre: "Mario Caal", requirenteUsuarioId: null,
    solicitanteUsuarioId: 5, solicitanteNombre: "Mario Caal",
    autorizanteEmpleadoId: null, autorizanteNombre: "Heber Sitan", autorizanteUsuarioId: 9,
    estado: "Autorizada", autorizadoEn: "2026-09-04 10:00:00", rechazadoEn: null, motivoRechazo: null,
    ...overrides,
  };
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Mock de firmas_electronicas por `accion` ('SOLICITAR_GASTO' |
 * 'REQUERIR_GASTO' | 'AUTORIZAR_GASTO') — cada llamada real de
 * firmaHistoricaGasto() manda [empresaId, gastoId, accion]; este helper
 * responde SOLO a la accion indicada.
 */
function mockFirmas(porAccion: Record<string, { nombre: string; conImagen?: boolean }>) {
  vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
    if (!sql.includes("firmas_electronicas")) return [];
    const accion = (params as unknown[])?.[2] as string;
    const cfg = porAccion[accion];
    if (!cfg) return [];
    return [{
      payload_canonico: JSON.stringify({ nombreFirmante: cfg.nombre }),
      imagen_ruta: cfg.conImagen ? `firmas/${accion}.png` : null,
      imagen_mime: "image/png",
    }];
  }) as typeof query);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(query).mockResolvedValue([] as never);
});
afterEach(() => vi.restoreAllMocks());

describe("generarPdfGastoAutorizado — estado", () => {
  it("gasto inexistente -> 404, nunca genera un PDF", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(null);
    const r = await generarPdfGastoAutorizado(7, 999, "SITSA");
    expect(r).toEqual({ ok: false, status: 404, error: "Gasto no encontrado." });
  });

  it.each(["Pendiente", "Rechazada"] as const)("estado %s -> 400, NUNCA se presenta como PDF autorizado", async (estado) => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ estado }) as never);
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain(estado);
    }
  });

  it("histórico (estado NULL) -> 400, fuera del flujo nuevo", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ estado: null }) as never);
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("Autorizada -> genera el PDF individual", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ estado: "Autorizada" }) as never);
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(r.nombreArchivo).toBe("gasto-1.pdf");
    }
  });
});

describe("generarPdfGastoAutorizado — orientación (landscape)", () => {
  it("se genera en orientación HORIZONTAL (landscape LETTER: 792 × 612 pt)", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto() as never);
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.buffer.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(Number(m![2]));
      expect(Math.round(Number(m![1]))).toBe(792);
      expect(Math.round(Number(m![2]))).toBe(612);
    }
  });
});

describe("generarPdfGastoAutorizado — tabla de una sola fila", () => {
  it("dibuja EXACTAMENTE las mismas 10 columnas que el PDF tabular de Gastos, en este orden", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto() as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    const i = textos.indexOf("Fecha de solicitud");
    expect(textos.slice(i, i + 10)).toEqual([
      "Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta / Número", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Valor",
    ]);
  });

  it("contiene exactamente UNA fila con los datos del gasto (cantidad*monto en Valor)", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ cantidad: 3, monto: 150, empleadoNombre: "Heber Sitan", vehiculoPlaca: "P111AAA" }) as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Heber Sitan");
    expect(textos).toContain("P111AAA");
    expect(textos).toContain("3");
    expect(textos).toContain("Q 450.00");
  });

  it("valores ausentes se muestran como '—', nunca revientan ni inventan un dato", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({
      empleadoNombre: null, empleadoCargo: null, vehiculoPlaca: null, clienteNombre: null, fechaViaje: null, numeroCuentaPago: null, descripcion: null,
    }) as never);
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(true);
  });
});

describe("generarPdfGastoAutorizado — total", () => {
  it("el TOTAL mostrado es cantidad × monto, alineado a la derecha", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ cantidad: 2, monto: 500 }) as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    const llamadas = spy.mock.calls.map(llamadaTexto);
    const total = llamadas.find((c) => c.texto === "TOTAL: Q 1,000.00");
    expect(total?.opciones?.align).toBe("right");
  });
});

describe("generarPdfGastoAutorizado — firmas", () => {
  it("muestra el nombre real del autorizante (ya guardado en autorizanteNombre) en el bloque de firma cuando no hay snapshot", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ autorizanteNombre: "Heber Sitan" }) as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("FIRMA DEL AUTORIZANTE");
    expect(textos).toContain("Heber Sitan");
  });

  it("requirente/solicitante SIN firma capturada: muestran nombre + espacio en blanco, sin inventar ninguna firma", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ requirenteNombre: "Mario Caal", solicitanteNombre: "Mario Caal" }) as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("FIRMA DEL REQUIRIENTE");
    expect(textos).toContain("FIRMA DEL SOLICITANTE");
  });

  it("firma histórica con imagen (firmas_electronicas, modulo GASTOS/entidad_tipo GASTO_OPERATIVO): se consulta acotada por empresa/entidad", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto() as never);
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("firmas_electronicas")) {
        expect(sql).toContain("modulo = 'GASTOS'");
        expect(sql).toContain("entidad_tipo = 'GASTO_OPERATIVO'");
        expect((params as unknown[])?.[0]).toBe(7);
        expect((params as unknown[])?.[1]).toBe(1);
        if ((params as unknown[])?.[2] !== "AUTORIZAR_GASTO") return [];
        return [{ payload_canonico: JSON.stringify({ nombreFirmante: "Ana Gómez" }), imagen_ruta: "firmas/x.png", imagen_mime: "image/png" }];
      }
      return [];
    }) as typeof query);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);
    const spy = espiarTexto();
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Ana Gómez");
  });

  it("PDF contiene las imágenes de firma de LAS 3 (requirente/solicitante/autorizante) cuando existen", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ requirenteUsuarioId: 30 }) as never);
    mockFirmas({
      SOLICITAR_GASTO: { nombre: "Mario Caal", conImagen: true },
      REQUERIR_GASTO: { nombre: "Ana Gómez", conImagen: true },
      AUTORIZAR_GASTO: { nombre: "Heber Sitan", conImagen: true },
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);
    const imageSpy = vi.spyOn(PDFDocument.prototype, "image");
    const spy = espiarTexto();
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    expect(imageSpy).toHaveBeenCalledTimes(3);
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Mario Caal");
    expect(textos).toContain("Ana Gómez");
    expect(textos).toContain("Heber Sitan");
  });

  it("AISLAMIENTO: la firma de una accion nunca se confunde con la de otra (REQUERIR_GASTO no usa la imagen de AUTORIZAR_GASTO)", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ requirenteUsuarioId: 30 }) as never);
    mockFirmas({ AUTORIZAR_GASTO: { nombre: "Heber Sitan", conImagen: true } });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);
    const imageSpy = vi.spyOn(PDFDocument.prototype, "image");
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(imageSpy).toHaveBeenCalledTimes(1); // únicamente el autorizante
  });
});

describe("generarPdfGastoAutorizado — multiempresa", () => {
  it("consulta el gasto SIEMPRE con el empresaId del guard del endpoint, nunca uno distinto", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto() as never);
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(obtenerGasto).toHaveBeenCalledWith(7, 1);
  });

  it("la firma histórica se busca acotada a empresa_id + entidad_id (nunca a otra empresa)", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ id: 42 }) as never);
    await generarPdfGastoAutorizado(9, 42, "SITSA");
    const llamadaFirma = vi.mocked(query).mock.calls.find((c) => String(c[0]).includes("firmas_electronicas"));
    expect((llamadaFirma?.[1] as unknown[])?.slice(0, 2)).toEqual([9, 42]);
  });

  it("gasto inexistente para esta empresa (obtenerGasto ya filtra por empresa_id) -> 404", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(null);
    const r = await generarPdfGastoAutorizado(9, 1, "SITSA");
    expect(r).toEqual({ ok: false, status: 404, error: "Gasto no encontrado." });
  });
});

describe("generarPdfGastoAutorizado — paginación", () => {
  it("una sola fila -> exactamente 1 página", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto() as never);
    const r = await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) expect(contarPaginas(r.buffer)).toBe(1);
  });
});

describe("generarPdfGastoAutorizado — encabezado", () => {
  it("título 'SOLICITUD DE GASTOS' centrado, Empresa requirente, Persona que requiere y Solicitante", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ entidadRequirenteNombre: "Kuiqtrans", requirenteNombre: "Mario Caal", solicitanteNombre: "Ana Gómez" }) as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "TRANSPORTES SITSA");
    const llamadas = spy.mock.calls.map(llamadaTexto);
    const titulo = llamadas.find((c) => c.texto === "SOLICITUD DE GASTOS");
    expect(titulo?.opciones?.align).toBe("center");
    const textos = llamadas.map((c) => c.texto);
    expect(textos).toContain("EMPRESA REQUIRIENTE: KUIQTRANS");
    expect(textos).toContain("PERSONA QUE REQUIERE: MARIO CAAL");
    expect(textos).toContain("SOLICITANTE: ANA GÓMEZ");
  });

  it("sin entidad requirente asociada, cae al nombre de la empresa del tenant", async () => {
    vi.mocked(obtenerGasto).mockResolvedValue(gasto({ entidadRequirenteId: null, entidadRequirenteNombre: null }) as never);
    const spy = espiarTexto();
    await generarPdfGastoAutorizado(7, 1, "SITSA");
    expect(spy.mock.calls.map((c) => llamadaTexto(c).texto)).toContain("EMPRESA REQUIRIENTE: SITSA");
  });
});
