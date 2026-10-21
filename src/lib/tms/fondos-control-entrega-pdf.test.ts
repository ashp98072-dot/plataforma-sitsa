import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/tms/fondos", () => ({ obtenerSolicitudFondo: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));

import { query } from "@/lib/db";
import { obtenerSolicitudFondo } from "@/lib/tms/fondos";
import type { Entrega } from "@/lib/entregas/entregas";
import { generarPdfSolicitudFondoAutorizada } from "./fondos-solicitud-pdf";
import {
  NOTA_MOVIMIENTOS_CERRADOS,
  cargarControlEntregaPdf,
  construirLineasControlEntrega,
  seleccionarEntregasParaPdf,
} from "./fondos-control-entrega-pdf";

/** Misma técnica que fondos-solicitud-pdf.test.ts: pdfkit comprime el contenido, así que se espía `text`. */
const textos = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((c) => String(c[0]));

const entrega = (extra: Partial<Entrega> = {}): Entrega => ({
  id: 1, empresaId: 7, modulo: "FONDOS", entidadId: 1, documentoCodigo: "FONDO-000001", etapaOrigen: "OPERACIONES", etapaDestino: "TESORERIA",
  modo: "SISTEMA", estado: "RECIBIDA", emitidoPorUsuarioId: 4, emitidoPorNombre: "Olga Operaciones", emitidoPorRol: "JefeOperaciones",
  emitidoEn: new Date("2026-10-13T10:00:00"), firmaEmisionId: 100, observacionesEmision: null,
  recibidoPorUsuarioId: 8, recibidoPorNombre: "Tere Tesorería", recibidoPorRol: "Contabilidad", recibidoEn: new Date("2026-10-13T11:30:00"),
  firmaRecepcionId: 101, observacionesRecepcion: null, recepcionOperadaPorUsuarioId: null, recepcionOperadaPorNombre: null,
  cerradoPorUsuarioId: null, cerradoPorNombre: null, cerradoEn: null, motivoCierre: null,
  ...extra,
});

/** Fila de BD de `documento_entregas` a partir de una Entrega. */
const filaBd = (e: Entrega) => ({
  id: e.id, empresa_id: e.empresaId, modulo: e.modulo, entidad_id: e.entidadId, documento_codigo: e.documentoCodigo,
  etapa_origen: e.etapaOrigen, etapa_destino: e.etapaDestino, modo: e.modo, estado: e.estado,
  emitido_por_usuario_id: e.emitidoPorUsuarioId, emitido_por_nombre: e.emitidoPorNombre, emitido_por_rol: e.emitidoPorRol,
  emitido_en: e.emitidoEn, firma_emision_id: e.firmaEmisionId, observaciones_emision: e.observacionesEmision,
  recibido_por_usuario_id: e.recibidoPorUsuarioId, recibido_por_nombre: e.recibidoPorNombre, recibido_por_rol: e.recibidoPorRol,
  recibido_en: e.recibidoEn, firma_recepcion_id: e.firmaRecepcionId, observaciones_recepcion: e.observacionesRecepcion,
  recepcion_operada_por_usuario_id: e.recepcionOperadaPorUsuarioId, recepcion_operada_por_nombre: e.recepcionOperadaPorNombre,
  cerrado_por_usuario_id: e.cerradoPorUsuarioId, cerrado_por_nombre: e.cerradoPorNombre, cerrado_en: e.cerradoEn, motivo_cierre: e.motivoCierre,
  huella_idempotencia: "h".repeat(64),
});

const RECIBIDA = entrega();
const PENDIENTE = entrega({
  id: 2, etapaOrigen: "TESORERIA", etapaDestino: "CONTABILIDAD", estado: "EMITIDA", emitidoPorNombre: "Tere Tesorería", emitidoEn: new Date("2026-10-13T12:00:00"),
  firmaEmisionId: 102, recibidoPorUsuarioId: null, recibidoPorNombre: null, recibidoPorRol: null, recibidoEn: null, firmaRecepcionId: null,
});
const RECHAZADA = entrega({ id: 3, estado: "RECHAZADA", recibidoPorUsuarioId: null, recibidoPorNombre: null, recibidoPorRol: null, recibidoEn: null, firmaRecepcionId: null, cerradoPorUsuarioId: 8, cerradoPorNombre: "Tere", cerradoEn: new Date(), motivoCierre: "Falta firma" });
const ANULADA = entrega({ id: 4, estado: "ANULADA", recibidoPorUsuarioId: null, recibidoPorNombre: null, recibidoPorRol: null, recibidoEn: null, firmaRecepcionId: null, cerradoPorUsuarioId: 4, cerradoPorNombre: "Olga", cerradoEn: new Date(), motivoCierre: "Destino equivocado" });

function mockBd(entregas: Entrega[], codigos: Record<number, string> = { 100: "SIG-A", 101: "SIG-B", 102: "SIG-C" }) {
  vi.mocked(query).mockImplementation((async (sql: string) => {
    if (sql.includes("FROM documento_entregas")) return entregas.map(filaBd);
    if (sql.includes("codigo_firma")) return Object.entries(codigos).map(([id, codigo_firma]) => ({ id: Number(id), codigo_firma }));
    return []; // firmas históricas y usuarios: ninguna
  }) as typeof query);
}

function solicitud() {
  return {
    id: 1, empresaId: 7, codigo: "FONDO-000001", entidadRequirenteId: 10, entidadRequirenteNombre: "Kuiqtrans", requirenteEmpleadoId: null,
    requirenteNombre: "Mario Caal", requirenteUsuarioId: null, fechaRequerimiento: "2026-09-04", total: 200, autorizanteEmpleadoId: null,
    autorizanteNombre: "Heber Sitan", autorizanteUsuarioId: 9, estado: "Autorizada", autorizadoEn: "2026-09-04 10:00:00", rechazadoEn: null,
    motivoRechazo: null, liquidadoEn: null, observaciones: null, creadoPor: "mcaal", solicitanteUsuarioId: 5, solicitanteNombre: "Mario Caal", creadoEn: "2026-09-04 09:00:00",
    lineas: [{ id: 1, categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, orden: 0, fechaViaje: "2026-09-02", empleadoId: 4,
      empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "1234567890", vehiculoId: 9, placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A", planId: null }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue([] as never);
  vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
});
afterEach(() => vi.restoreAllMocks());

describe("seleccionarEntregasParaPdf", () => {
  it("RECIBIDAS + la EMITIDA pendiente en orden cronológico; RECHAZADA/ANULADA no son filas", () => {
    const r = seleccionarEntregasParaPdf([ANULADA, PENDIENTE, RECHAZADA, RECIBIDA]);
    expect(r.mostrar.map((e) => e.id)).toEqual([1, 2]);
    expect(r.hayCerradasSinRecepcion).toBe(true);
  });
  it("sin movimientos cerrados no hay nota; sin entregas no hay nada", () => {
    expect(seleccionarEntregasParaPdf([RECIBIDA])).toMatchObject({ hayCerradasSinRecepcion: false });
    expect(seleccionarEntregasParaPdf([])).toEqual({ mostrar: [], hayCerradasSinRecepcion: false });
  });
});

describe("cargarControlEntregaPdf", () => {
  it("arma filas con áreas legibles, nombres, fechas y CÓDIGOS de firma (sin imágenes)", async () => {
    mockBd([RECIBIDA, PENDIENTE]);
    const c = await cargarControlEntregaPdf(7, 1);
    expect(c.filas).toHaveLength(2);
    expect(c.filas[0]).toMatchObject({
      estado: "RECIBIDA", origen: "Operaciones", destino: "Tesorería", emitidoPor: "Olga Operaciones", recibidoPor: "Tere Tesorería",
      codigoFirmaEmision: "SIG-A", codigoFirmaRecepcion: "SIG-B", emitidoEn: "13/10/2026 10:00:00",
    });
    expect(c.filas[1]).toMatchObject({ estado: "EMITIDA", origen: "Tesorería", destino: "Contabilidad", recibidoPor: null, codigoFirmaEmision: "SIG-C" });
    expect(JSON.stringify(c)).not.toMatch(/imagen|png/i);
  });

  it("todas las consultas van acotadas por empresa", async () => {
    mockBd([RECIBIDA]);
    await cargarControlEntregaPdf(7, 1);
    for (const [sql, params] of vi.mocked(query).mock.calls) {
      expect(String(sql)).toContain("empresa_id = ?");
      expect((params as unknown[])[0]).toBe(7);
    }
  });

  it("si la lectura falla (p. ej. tabla inexistente) devuelve un control vacío y el PDF sigue siendo posible", async () => {
    const espia = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(query).mockRejectedValue(new Error("Table 'documento_entregas' doesn't exist"));
    await expect(cargarControlEntregaPdf(7, 1)).resolves.toEqual({ filas: [], hayCerradasSinRecepcion: false });
    espia.mockRestore();
  });
});

describe("construirLineasControlEntrega", () => {
  it("RECIBIDA: emisor, área origen, fecha/hora, receptor, área destino, fecha/hora de recepción, estado y códigos de firma", async () => {
    mockBd([RECIBIDA]);
    const lineas = construirLineasControlEntrega(await cargarControlEntregaPdf(7, 1));
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toBe("Emitido por: Olga Operaciones · Área origen: Operaciones · 13/10/2026 10:00:00 · Firma SIG-A");
    expect(lineas[1]).toBe("Recibido por: Tere Tesorería · Área destino: Tesorería · 13/10/2026 11:30:00 · Firma SIG-B · Estado: Recibida");
  });

  it("EMITIDA pendiente: emisor, área origen, destino, fecha/hora y «Pendiente de recepción»", async () => {
    mockBd([PENDIENTE]);
    const lineas = construirLineasControlEntrega(await cargarControlEntregaPdf(7, 1));
    expect(lineas[0]).toContain("Emitido por: Tere Tesorería · Área origen: Tesorería · 13/10/2026 12:00:00");
    expect(lineas[1]).toBe("Destino: Contabilidad · Estado: Pendiente de recepción");
  });

  it("presencial: indica quién registró la recepción", () => {
    const lineas = construirLineasControlEntrega({
      hayCerradasSinRecepcion: false,
      filas: [{ estado: "RECIBIDA", origen: "Operaciones", destino: "Tesorería", presencial: true, emitidoPor: "Olga", emitidoEn: "13/10/2026 10:00:00",
        codigoFirmaEmision: null, recibidoPor: "Juan Pérez", recibidoEn: "13/10/2026 11:00:00", registradoPor: "Pedro", codigoFirmaRecepcion: null }],
    });
    expect(lineas[1]).toContain("Juan Pérez (presencial; registrado por Pedro)");
  });

  it("RECHAZADA/ANULADA: SOLO la nota, nunca filas completas ni sus motivos", async () => {
    mockBd([RECHAZADA, ANULADA]);
    const lineas = construirLineasControlEntrega(await cargarControlEntregaPdf(7, 1));
    expect(lineas).toEqual([NOTA_MOVIMIENTOS_CERRADOS]);
    expect(lineas.join("\n")).not.toMatch(/Falta firma|Destino equivocado/);
  });

  it("modo compacto: una línea por entrega", async () => {
    mockBd([RECIBIDA, PENDIENTE]);
    const lineas = construirLineasControlEntrega(await cargarControlEntregaPdf(7, 1), true);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain("recibida por Tere Tesorería");
    expect(lineas[1]).toContain("Pendiente de recepción");
  });

  it("sin entregas: ninguna línea (el bloque se omite)", () => {
    expect(construirLineasControlEntrega({ filas: [], hayCerradasSinRecepcion: false })).toEqual([]);
  });
});

describe("PDF individual de la solicitud con control de entrega", () => {
  it("sin entregas: se genera igual y NO aparece el bloque (históricos sin cambios)", async () => {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    mockBd([]);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    const t = textos(espia);
    expect(t).not.toContain("CONTROL DE ENTREGA");
    expect(t).toContain("SOLICITUD DE FONDO");
    expect(t.some((x) => x.startsWith("TOTAL: "))).toBe(true);
  });

  it("RECIBIDA y EMITIDA pendiente aparecen en el bloque «CONTROL DE ENTREGA»", async () => {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    mockBd([RECIBIDA, PENDIENTE]);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    const t = textos(espia);
    expect(t).toContain("CONTROL DE ENTREGA");
    expect(t.some((x) => x.startsWith("Recibido por: Tere Tesorería"))).toBe(true);
    expect(t).toContain("Destino: Contabilidad · Estado: Pendiente de recepción");
    expect(t).not.toContain(NOTA_MOVIMIENTOS_CERRADOS);
  });

  it("RECHAZADA/ANULADA: solo la nota, sin filas", async () => {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    mockBd([RECIBIDA, RECHAZADA, ANULADA]);
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const t = textos(espia);
    expect(t).toContain(NOTA_MOVIMIENTOS_CERRADOS);
    expect(t.filter((x) => x.startsWith("Emitido por:"))).toHaveLength(1); // solo la RECIBIDA
    expect(t.join("\n")).not.toMatch(/Falta firma|Destino equivocado/);
  });

  it("el contenido existente (tabla, total, firmas, notas) se conserva igual con y sin entregas", async () => {
    const sin = vi.spyOn(PDFDocument.prototype, "text");
    mockBd([]);
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const base = textos(sin).filter((x) => !x.startsWith("Página ") && !/Documento generado/.test(x));
    sin.mockClear();
    mockBd([RECIBIDA, PENDIENTE, ANULADA]);
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const con = textos(sin).filter((x) => !x.startsWith("Página ") && !/Documento generado/.test(x));
    const nuevo = new Set(["CONTROL DE ENTREGA", NOTA_MOVIMIENTOS_CERRADOS]);
    const sinBloque = con.filter((x) => !nuevo.has(x) && !x.startsWith("Emitido por:") && !x.startsWith("Recibido por:") && !x.startsWith("Destino:"));
    expect(sinBloque).toEqual(base);
  });

  it("si el control de entrega no se puede leer, el PDF se genera igual", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("documento_entregas")) throw new Error("tabla inexistente");
      return [];
    }) as typeof query);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    consola.mockRestore();
  });
});

describe("PDF mensual consolidado con control de entrega (versión compacta, solo texto)", () => {
  const filaReporte = (solicitudId: number, codigo: string) => ({
    lineaId: solicitudId, solicitudId, solicitudCodigo: codigo, fechaSolicitud: "2026-09-03", fechaViaje: "2026-09-04",
    empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "1980305722", vehiculoId: 9, placa: "C-130BQ",
    clienteId: 5, clienteNombre: "Cliente A", planId: null, cantidad: 2, descripcion: "Combustible diesel", monto: 100, total: 200,
    entidadRequirenteNombre: "Kuiqtrans", requirenteNombre: "Mario Caal", solicitanteNombre: "Ana Gómez", autorizanteNombre: "Heber Sitan",
    fechaAutorizacion: "2026-09-04", totalSolicitud: 200, estadoFondo: "Autorizada", observaciones: null,
  });

  async function generarMensual(filas: ReturnType<typeof filaReporte>[]) {
    const { generarPdfMensualSolicitudesFondo } = await import("./fondos-mensual-pdf");
    const { agruparSolicitudesFondo, resumenMensualFondos } = await import("./reportes-gastos");
    const grupos = agruparSolicitudesFondo(filas as never);
    return generarPdfMensualSolicitudesFondo(7, "SITSA", grupos, resumenMensualFondos(grupos), { anio: 2026, mes: 9 });
  }

  it("agrega una línea compacta por entrega y NO dibuja imágenes de firma de entrega", async () => {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    const imagen = vi.spyOn(PDFDocument.prototype, "image");
    mockBd([RECIBIDA, PENDIENTE, RECHAZADA]);
    const buf = await generarMensual([filaReporte(1, "FONDO-000001")]);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const t = textos(espia);
    expect(t).toContain("CONTROL DE ENTREGA");
    expect(t.some((x) => x.includes("recibida por Tere Tesorería"))).toBe(true);
    expect(t.some((x) => x.includes("Pendiente de recepción"))).toBe(true);
    expect(t).toContain(NOTA_MOVIMIENTOS_CERRADOS);
    expect(imagen).not.toHaveBeenCalled();
  });

  it("sin entregas: el reporte mensual queda igual (sin bloque)", async () => {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    mockBd([]);
    await generarMensual([filaReporte(1, "FONDO-000001"), filaReporte(2, "FONDO-000002")]);
    expect(textos(espia)).not.toContain("CONTROL DE ENTREGA");
    expect(textos(espia)).toContain("RESUMEN DEL MES");
  });
});
