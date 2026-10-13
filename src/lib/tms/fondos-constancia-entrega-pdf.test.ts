import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/fondos", () => ({ obtenerSolicitudFondo: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));
vi.mock("@/lib/entregas/entregas", () => ({ obtenerEntrega: vi.fn() }));
vi.mock("@/lib/entregas/evidencia", () => ({ leerEvidenciaEntrega: vi.fn() }));

import { query } from "@/lib/db";
import { obtenerSolicitudFondo } from "@/lib/tms/fondos";
import { leerEvidenciaEntrega } from "@/lib/entregas/evidencia";
import { obtenerEntrega, type Entrega } from "@/lib/entregas/entregas";
import { MENSAJES_CONSTANCIA, armarDatosConstancia, codigoEntrega, generarPdfConstanciaEntrega } from "./fondos-constancia-entrega-pdf";

/** Mismo criterio que fondos-solicitud-pdf.test.ts: pdfkit comprime el contenido, así que se espía `text`. */
const textos = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((c) => String(c[0]));

const entrega = (extra: Partial<Entrega> = {}): Entrega => ({
  id: 12, empresaId: 7, modulo: "FONDOS", entidadId: 3, documentoCodigo: "FONDO-000003", etapaOrigen: "OPERACIONES", etapaDestino: "TESORERIA",
  modo: "PRESENCIAL", estado: "EMITIDA", emitidoPorUsuarioId: 4, emitidoPorNombre: "Olga Operaciones", emitidoPorRol: "JefeOperaciones",
  emitidoEn: new Date("2026-10-13T10:00:00"), firmaEmisionId: 100, observacionesEmision: "Expediente completo",
  recibidoPorUsuarioId: null, recibidoPorNombre: null, recibidoPorRol: null, recibidoEn: null, firmaRecepcionId: null,
  observacionesRecepcion: null, recepcionOperadaPorUsuarioId: null, recepcionOperadaPorNombre: null,
  cerradoPorUsuarioId: null, cerradoPorNombre: null, cerradoEn: null, motivoCierre: null,
  ...extra,
});
const RECIBIDA_SISTEMA = entrega({
  modo: "SISTEMA", estado: "RECIBIDA", recibidoPorUsuarioId: 8, recibidoPorNombre: "Tere Tesorería", recibidoPorRol: "Contabilidad",
  recibidoEn: new Date("2026-10-13T11:30:00"), firmaRecepcionId: 101, observacionesRecepcion: "Todo en orden",
});
const RECIBIDA_PRESENCIAL = entrega({
  modo: "PRESENCIAL", estado: "RECIBIDA", recibidoPorNombre: "Juan Pérez", recibidoEn: new Date("2026-10-13T12:15:00"), firmaRecepcionId: 102,
  recepcionOperadaPorUsuarioId: 9, recepcionOperadaPorNombre: "Pedro Presencial",
});

const solicitud = {
  id: 3, empresaId: 7, codigo: "FONDO-000003", entidadRequirenteNombre: "Kuiqtrans", requirenteNombre: "Mario Caal",
  solicitanteNombre: "Ana Gómez", fechaRequerimiento: "2026-09-04", total: 1250.5, estado: "Autorizada",
};

function mockCodigos(codigos: Record<number, string> = { 100: "SIG-EMI", 101: "SIG-REC", 102: "SIG-PRES" }) {
  vi.mocked(query).mockImplementation((async (sql: string) =>
    sql.includes("codigo_firma") ? Object.entries(codigos).map(([id, codigo_firma]) => ({ id: Number(id), codigo_firma })) : []) as typeof query);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCodigos();
  vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud as never);
  vi.mocked(leerEvidenciaEntrega).mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

async function generar(e: Entrega | null) {
  vi.mocked(obtenerEntrega).mockResolvedValue(e);
  const espia = vi.spyOn(PDFDocument.prototype, "text");
  const r = await generarPdfConstanciaEntrega(7, 12, "SITSA");
  return { r, t: textos(espia) };
}

describe("constancia PREVIA (PRESENCIAL + EMITIDA)", () => {
  it("lleva los datos del documento y de quien emite, y deja al receptor EN BLANCO", async () => {
    const { r, t } = await generar(entrega());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variante).toBe("PREVIA");
    expect(t).toContain("CONSTANCIA DE ENTREGA DE DOCUMENTO");
    const todo = t.join("\n");
    for (const esperado of [
      "Solicitud de fondo", "FONDO-000003", "Mario Caal", "Ana Gómez", "04/09/2026", "Q 1,250.50",
      "Operaciones", "Tesorería", "Olga Operaciones", "JefeOperaciones", "13/10/2026 10:00:00", "SIG-EMI", "Expediente completo", "ENT-000012",
    ]) expect(todo).toContain(esperado);
    // Espacios para completar a mano.
    expect(t).toContain("Nombre de quien recibe:");
    expect(t).toContain("Firma:");
    expect(t).toContain("Fecha y hora de recepción:");
    // No aparenta estar recibida: nada del receptor, ni estado RECIBIDA, ni forma de recepción.
    expect(todo).not.toMatch(/RECIBIDA|Forma de recepción|Registrada en el sistema por|SIG-REC|SIG-PRES/);
    expect(todo).toContain("Pendiente de recepción presencial");
    expect(todo).toContain("NO acredita la recepción");
  });

  it("el nombre de archivo indica que es para firma", async () => {
    const { r } = await generar(entrega());
    expect(r.ok && r.nombreArchivo).toBe("constancia-entrega-FONDO-000003-ENT-000012-para-firma.pdf");
  });
});

describe("constancia FINAL (RECIBIDA)", () => {
  it("SISTEMA: emitido y recibido con rol, fecha/hora, códigos de firma, estado RECIBIDA y observaciones", async () => {
    const { r, t } = await generar(RECIBIDA_SISTEMA);
    expect(r.ok && r.variante).toBe("FINAL");
    const todo = t.join("\n");
    for (const esperado of [
      "Olga Operaciones", "JefeOperaciones", "13/10/2026 10:00:00", "SIG-EMI",
      "Tere Tesorería", "Contabilidad", "13/10/2026 11:30:00", "SIG-REC",
      "Confirmada en el sistema con firma digital del receptor", "RECIBIDA", "ENT-000012", "Expediente completo", "Todo en orden",
    ]) expect(todo).toContain(esperado);
    // Ya no hay espacios en blanco para firmar.
    expect(t).not.toContain("Nombre de quien recibe:");
    expect(r.ok && r.nombreArchivo).toBe("constancia-entrega-FONDO-000003-ENT-000012.pdf");
  });

  it("PRESENCIAL con constancia escaneada: indica la evidencia y quién registró la recepción (sin rol de receptor)", async () => {
    vi.mocked(leerEvidenciaEntrega).mockResolvedValue({ ruta: "empresas/7/evidencias/c.pdf", nombre: "c.pdf", mime: "application/pdf", tamano: 1000 });
    const { r, t } = await generar(RECIBIDA_PRESENCIAL);
    expect(r.ok && r.variante).toBe("FINAL");
    const todo = t.join("\n");
    expect(todo).toContain("Juan Pérez");
    expect(todo).toContain("Constancia firmada y escaneada (PDF) adjunta en el sistema");
    expect(todo).toContain("Pedro Presencial");
    expect(todo).toContain("SIG-PRES");
    // Solo aparece el rol de quien EMITE: el receptor presencial no tiene usuario ni rol.
    expect(t.filter((x) => x === "Rol: ")).toHaveLength(1);
  });

  it("PRESENCIAL histórica sin evidencia: se genera con los datos existentes y no inventa archivo", async () => {
    const { r, t } = await generar(RECIBIDA_PRESENCIAL);
    expect(r.ok).toBe(true);
    expect(t.join("\n")).toContain("Firma dibujada en el dispositivo (sin constancia escaneada adjunta)");
  });
});

describe("estados que NO generan constancia final", () => {
  it("SISTEMA + EMITIDA: no hay constancia previa (queda en «Entregas por recibir»)", async () => {
    const { r } = await generar(entrega({ modo: "SISTEMA" }));
    expect(r).toEqual({ ok: false, status: 409, error: MENSAJES_CONSTANCIA.sistemaPendiente });
  });
  it("RECHAZADA y ANULADA: 409, nunca una constancia como si hubiera sido recibida", async () => {
    for (const estado of ["RECHAZADA", "ANULADA"] as const) {
      for (const modo of ["SISTEMA", "PRESENCIAL"] as const) {
        const { r } = await generar(entrega({ estado, modo, cerradoPorUsuarioId: 4, cerradoPorNombre: "Olga", cerradoEn: new Date(), motivoCierre: "x" }));
        expect(r).toEqual({ ok: false, status: 409, error: MENSAJES_CONSTANCIA.cerrada });
      }
    }
  });
  it("entrega inexistente, de otra empresa o de otro módulo => 404", async () => {
    expect((await generar(null)).r).toMatchObject({ ok: false, status: 404 });
    expect((await generar(entrega({ modulo: "GASTOS" }))).r).toMatchObject({ ok: false, status: 404 });
  });
});

describe("armarDatosConstancia (puro)", () => {
  const codigos = new Map<number, string>([[100, "SIG-EMI"], [101, "SIG-REC"]]);
  it("RECHAZADA/ANULADA y SISTEMA pendiente no producen datos", () => {
    expect(armarDatosConstancia(entrega({ modo: "SISTEMA" }), solicitud as never, codigos, null, "SITSA")).toBeNull();
    expect(armarDatosConstancia(entrega({ estado: "ANULADA" }), solicitud as never, codigos, null, "SITSA")).toBeNull();
  });
  it("la previa no contiene datos de recepción; la final sí", () => {
    expect(armarDatosConstancia(entrega(), solicitud as never, codigos, null, "SITSA")!.recibido).toBeNull();
    expect(armarDatosConstancia(RECIBIDA_SISTEMA, solicitud as never, codigos, null, "SITSA")!.recibido).toMatchObject({ nombre: "Tere Tesorería", rol: "Contabilidad", codigoFirma: "SIG-REC" });
  });
  it("código de entrega estable", () => {
    expect(codigoEntrega(7)).toBe("ENT-000007");
    expect(codigoEntrega(123456)).toBe("ENT-123456");
  });
});
