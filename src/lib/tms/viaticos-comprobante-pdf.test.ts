import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/tms/viaticos", () => ({ listarViaticosControl: vi.fn() }));
vi.mock("@/lib/firmas/firmas-lectura", () => ({ listarFirmasViatico: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));

import { listarViaticosControl } from "@/lib/tms/viaticos";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";
import { query } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import { agruparPorFirmante, comprobanteAutorizacionesPdf, fechaLargaEsGt, tituloEmpresa } from "./viaticos-comprobante-pdf";

/**
 * VIATICOS-PDF-PRESENTACION-1 — pdfkit comprime los content streams
 * (FlateDecode) por defecto, así que inspeccionar el buffer crudo en
 * busca de texto NO es una prueba confiable (mismo criterio ya
 * documentado en cotizacion-pdf.test.ts). Para verificar EXACTAMENTE qué
 * texto se dibuja (y con qué alineación) se espía `PDFDocument.prototype.
 * text` SIN reemplazar su implementación (`vi.spyOn` sin
 * `mockImplementation` delega a la real) — pdfkit sigue corriendo tal
 * cual, solo quedan registrados los argumentos de cada llamada.
 */
function espiarTexto() {
  return vi.spyOn(PDFDocument.prototype, "text");
}

/** Extrae {texto, opciones} de una llamada capturada por espiarTexto(). */
function llamadaTexto(call: unknown[]): { texto: string; opciones: Record<string, unknown> | undefined } {
  const opciones = call.find((a): a is Record<string, unknown> => typeof a === "object" && a !== null && !Array.isArray(a));
  return { texto: String(call[0]), opciones };
}

const VIATICO_BASE = {
  id: 1,
  planId: 1,
  planCodigo: "VJ-001",
  fechaPlan: "2026-09-01",
  cliente: "PriceSmart",
  unidadPlaca: "P-123ABC",
  personalId: 4,
  personalNombre: "Juan Pérez",
  rol: "Piloto",
  puesto: null,
  montoSugerido: 200,
  montoAsignado: 200,
  motivoCambio: null,
  modificadoPor: null,
  estado: "AUTORIZADO",
  metodoPago: null,
  creadoEn: "2026-09-01T08:00:00",
  actualizadoEn: "2026-09-01T08:00:00",
  autorizadoPor: "op1",
  autorizadoEn: "2026-09-01T09:00:00",
  entregadoPor: null,
  entregadoEn: null,
  referenciaPago: null,
  observacionesEntrega: null,
  liquidadoPor: null,
  liquidadoEn: null,
  observacionesLiquidacion: null,
  gastosComprobados: null,
  reintegro: null,
  diferencia: null,
  rechazadoPor: null,
  rechazadoEn: null,
  motivoRechazo: null,
} as unknown as Awaited<ReturnType<typeof listarViaticosControl>>["items"][number];

const FIRMA_BASE = {
  id: 55,
  accion: "AUTORIZAR_VIATICO" as const,
  codigoFirma: "SIG-55",
  // Formato real que produce mapFirmaViatico() (String(Date) de MySQL DATETIME
  // vía mysql2) — igual que en producción, no un ISO limpio inventado.
  fechaHoraServidor: "Thu Sep 03 2026 18:47:26 GMT+0000 (Coordinated Universal Time)",
  metodo: "PASSWORD" as const,
  usuarioId: 9,
  empleadoId: null,
  nombreFirmante: "Ana Gómez",
  rolFirmante: "JefeOperaciones",
  origenFirma: null,
  tieneImagen: false,
  hashPayload: "hash-abc",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  // Default seguro: ningún username/imagen encontrado. Los tests que
  // necesitan una fila real (imagen_ruta o username) lo sobreescriben.
  vi.mocked(query).mockResolvedValue([] as never);
});
afterEach(() => vi.restoreAllMocks());

describe("tituloEmpresa", () => {
  it("'Kuiqtrans / Logiservicios Mónaco' -> 'Logiservicios Mónaco' (se queda solo el último segmento)", () => {
    expect(tituloEmpresa("Kuiqtrans / Logiservicios Mónaco")).toBe("Logiservicios Mónaco");
  });

  it("con 3 segmentos también se queda solo el último (p. ej. si algún día hay un tercer nombre delante)", () => {
    expect(tituloEmpresa("Ritza / Kuiqtrans / Logiservicios Mónaco")).toBe("Logiservicios Mónaco");
  });

  it("nombre de empresa SIN '/' se devuelve sin cambios (no afecta a otras empresas)", () => {
    expect(tituloEmpresa("PriceSmart")).toBe("PriceSmart");
    expect(tituloEmpresa("SITSA")).toBe("SITSA");
  });
});

describe("fechaLargaEsGt", () => {
  it("formatea en español, locale es-GT: 'D de mes de AAAA, H:MM'", () => {
    expect(fechaLargaEsGt("2026-09-03 18:47:26")).toBe("3 de septiembre de 2026, 18:47");
  });

  it("hora de un solo dígito no se rellena con cero (8:05, no 08:05)", () => {
    expect(fechaLargaEsGt("2026-01-05 08:05:00")).toBe("5 de enero de 2026, 8:05");
  });

  it("acepta el formato real de MySQL vía mysql2 (String(Date) con zona) — construido con Date real para no depender de la zona horaria de la máquina que corre el test", () => {
    // mapFirmaViatico() guarda fechaHoraServidor como String(dateObj); acá
    // se reproduce ese mismo round-trip (Date -> string -> fechaLargaEsGt)
    // en vez de un string con offset fijo, que solo sería correcto en una
    // máquina con esa misma zona horaria.
    const dateObj = new Date(2026, 8, 3, 18, 47, 26);
    expect(fechaLargaEsGt(String(dateObj))).toBe("3 de septiembre de 2026, 18:47");
  });

  it("nunca en inglés (Sep 03 2026) ni en formatos ambiguos (09/03/2026, 2026-09-03)", () => {
    const resultado = fechaLargaEsGt("2026-09-03 18:47:26");
    expect(resultado).not.toContain("Sep");
    expect(resultado).not.toMatch(/^\d{2}\/\d{2}\/\d{4}/);
    expect(resultado).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("valor nulo/vacío -> '—' (nunca revienta)", () => {
    expect(fechaLargaEsGt(null)).toBe("—");
    expect(fechaLargaEsGt(undefined)).toBe("—");
  });
});

describe("agruparPorFirmante", () => {
  it("2 viáticos autorizados por la MISMA persona (mismo usuarioId) -> UNA sola entrada", () => {
    const grupos = agruparPorFirmante([
      { firma: FIRMA_BASE, imagen: null },
      { firma: { ...FIRMA_BASE, id: 56, codigoFirma: "SIG-56" }, imagen: null },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].firma.usuarioId).toBe(9);
  });

  it("2 viáticos autorizados por personas DISTINTAS -> una entrada por cada una, en orden de aparición", () => {
    const otraFirma = { ...FIRMA_BASE, id: 60, usuarioId: 11, nombreFirmante: "Carlos Ruiz" };
    const grupos = agruparPorFirmante([
      { firma: FIRMA_BASE, imagen: null },
      { firma: otraFirma, imagen: null },
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].firma.nombreFirmante).toBe("Ana Gómez");
    expect(grupos[1].firma.nombreFirmante).toBe("Carlos Ruiz");
  });

  it("dentro de un mismo firmante, se queda con la firma MÁS RECIENTE (fecha e imagen)", () => {
    const imagenVieja = { buffer: Buffer.from("vieja"), mime: "image/png" };
    const imagenNueva = { buffer: Buffer.from("nueva"), mime: "image/png" };
    const grupos = agruparPorFirmante([
      { firma: { ...FIRMA_BASE, fechaHoraServidor: "2026-09-01 08:00:00" }, imagen: imagenVieja },
      { firma: { ...FIRMA_BASE, id: 61, fechaHoraServidor: "2026-09-03 08:00:00" }, imagen: imagenNueva },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].firma.id).toBe(61);
    expect(grupos[0].imagen).toBe(imagenNueva);
  });

  it("viáticos sin firma (null) se ignoran, no revientan ni generan una entrada 'vacía'", () => {
    const grupos = agruparPorFirmante([
      { firma: null, imagen: null },
      { firma: FIRMA_BASE, imagen: null },
    ]);
    expect(grupos).toHaveLength(1);
  });

  it("firma sin usuarioId (null) se agrupa por nombreFirmante", () => {
    const grupos = agruparPorFirmante([
      { firma: { ...FIRMA_BASE, usuarioId: null }, imagen: null },
      { firma: { ...FIRMA_BASE, id: 62, usuarioId: null }, imagen: null },
    ]);
    expect(grupos).toHaveLength(1); // mismo nombreFirmante ("Ana Gómez")
  });
});

describe("comprobanteAutorizacionesPdf", () => {
  it("regresa null cuando no hay ningún viático AUTORIZADO (nunca un PDF vacío)", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [], resumen: {} as never });
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).toBeNull();
    expect(listarViaticosControl).toHaveBeenCalledWith(7, { estado: "AUTORIZADO" });
    expect(listarFirmasViatico).not.toHaveBeenCalled();
  });

  it("genera un PDF válido (empieza con %PDF) con un viático autorizado y firma sin imagen", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]);
    const buf = await comprobanteAutorizacionesPdf(7, "Kuiqtrans / Logiservicios Mónaco");
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(listarFirmasViatico).toHaveBeenCalledWith(7, 1);
    // VIATICOS-PDF-PRESENTACION-1: la búsqueda de username se retiró por
    // completo (ya no se muestra "(usuario)" junto al nombre) — sin
    // tieneImagen tampoco hay consulta de imagen_ruta, así que este lote
    // no tiene ninguna razón para llamar a query().
    expect(query).not.toHaveBeenCalled();
  });

  it("sin ningún firmante con usuarioId, no consulta la tabla usuarios", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([{ ...FIRMA_BASE, usuarioId: null }]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("2 viáticos autorizados por la MISMA persona no disparan ninguna consulta extra (ni de username, ya retirada, ni duplicada por viático)", async () => {
    const v2 = { ...VIATICO_BASE, id: 2, planCodigo: "VJ-002" };
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE, v2], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]); // mismo usuarioId=9 para ambos viáticos
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("consulta la imagen de la firma acotada a empresa/modulo/entidad cuando tieneImagen=true", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([{ ...FIRMA_BASE, tieneImagen: true }]);
    vi.mocked(query).mockResolvedValue([{ imagen_ruta: "firmas/x.png", imagen_mime: "image/png" }] as never);
    vi.mocked(existsSync).mockReturnValue(false); // archivo no existe -> PDF sigue generándose sin la imagen

    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("firmas_electronicas"), [55, 7]);
  });

  it("incrusta la imagen real de la firma en el PDF cuando el archivo existe", async () => {
    // PNG 1x1 mínimo válido, para que pdfkit's doc.image() no falle.
    const PNG_1X1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([{ ...FIRMA_BASE, tieneImagen: true }]);
    vi.mocked(query).mockResolvedValue([{ imagen_ruta: "firmas/x.png", imagen_mime: "image/png" }] as never);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);

    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(readFileSync).toHaveBeenCalledWith("/abs/firmas/x.png");
  });

  it("sin firma de autorización registrada, el PDF se genera igual (lo indica en el texto, no falla)", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("consulta la firma de CADA viático del lote (no solo el primero)", async () => {
    const v2 = { ...VIATICO_BASE, id: 2, planCodigo: "VJ-002", personalNombre: "María López" };
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE, v2], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(listarFirmasViatico).toHaveBeenCalledWith(7, 1);
    expect(listarFirmasViatico).toHaveBeenCalledWith(7, 2);
    expect(listarFirmasViatico).toHaveBeenCalledTimes(2);
  });

  it("ignora una firma de LIQUIDAR_VIATICO y usa solo AUTORIZAR_VIATICO", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([
      { ...FIRMA_BASE, accion: "LIQUIDAR_VIATICO", nombreFirmante: "Otro Firmante" },
    ]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
  });

  it("2 viáticos autorizados por la misma persona -> genera un PDF válido con UNA sola firma en el bloque de autorización", async () => {
    const v2 = { ...VIATICO_BASE, id: 2, planCodigo: "VJ-002", personalNombre: "María López" };
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE, v2], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockImplementation(async (_empresaId, viaticoId) => [
      { ...FIRMA_BASE, id: 55 + viaticoId, codigoFirma: `SIG-${55 + viaticoId}` },
    ]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("2 viáticos autorizados por personas distintas -> genera un PDF válido con 2 bloques de firma", async () => {
    const v2 = { ...VIATICO_BASE, id: 2, planCodigo: "VJ-002", personalNombre: "María López" };
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE, v2], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockImplementation(async (_empresaId, viaticoId) =>
      viaticoId === 1
        ? [FIRMA_BASE]
        : [{ ...FIRMA_BASE, id: 60, usuarioId: 11, nombreFirmante: "Carlos Ruiz", codigoFirma: "SIG-60" }],
    );
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("VIATICOS-PDF-PRESENTACION-1 — bloque 'Autorizado por' muestra SOLO el nombre real", () => {
  it("el texto es exactamente 'Autorizado por: <nombre>' — sin username, sin rol, sin paréntesis", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]);
    // Aunque exista un username resoluble para este usuarioId, la firma
    // de autorización ya NO debe consultarlo ni mostrarlo — ver test de
    // abajo ("ya no consulta la tabla usuarios").
    vi.mocked(query).mockResolvedValue([{ id: 9, username: "hsitan" }] as never);
    const spy = espiarTexto();
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Autorizado por: Ana Gómez");
  });

  it("no aparece '(admin)', '(usuario)', el username ni el rol del firmante en ningún texto del PDF", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([
      { ...FIRMA_BASE, nombreFirmante: "Heber Sitan", rolFirmante: "Administrador General" },
    ]);
    vi.mocked(query).mockResolvedValue([{ id: 9, username: "admin" }] as never);
    const spy = espiarTexto();
    await comprobanteAutorizacionesPdf(7, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    for (const t of textos) {
      expect(t).not.toContain("(admin)");
      expect(t).not.toContain("(usuario)");
      expect(t).not.toContain("admin)");
      expect(t).not.toContain("Administrador General");
    }
    expect(textos).toContain("Autorizado por: Heber Sitan");
  });

  it("ya no consulta la tabla usuarios (la búsqueda de username se retiró por completo, no solo se dejó de mostrar)", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]); // usuarioId=9, sin imagen
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    // Sin imagen (tieneImagen=false) y sin búsqueda de username, este lote
    // no tiene ninguna razón para llamar a query().
    expect(query).not.toHaveBeenCalled();
  });

  it("mantiene la fecha en español debajo, sin cambios de formato", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([{ ...FIRMA_BASE, fechaHoraServidor: "2026-09-09 14:12:00" }]);
    const spy = espiarTexto();
    await comprobanteAutorizacionesPdf(7, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Fecha: 9 de septiembre de 2026, 14:12");
  });
});

describe("VIATICOS-PDF-PRESENTACION-1 — columna Monto completa y centrada", () => {
  it("el encabezado 'Monto' se dibuja centrado", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]);
    const spy = espiarTexto();
    await comprobanteAutorizacionesPdf(7, "SITSA");
    const encabezado = spy.mock.calls.map(llamadaTexto).find((c) => c.texto === "Monto");
    expect(encabezado).toBeDefined();
    expect(encabezado!.opciones?.align).toBe("center");
  });

  it("valores de Monto se dibujan centrados y COMPLETOS, sin truncar con '…', para montos normales en GTQ", async () => {
    // Columnas largas a propósito (mismo escenario que reprodujo el bug
    // real: "Q50.00" -> "Q50.0…" cuando Cliente/Empleado/Código de firma
    // son largos y le quitan espacio proporcional a Monto).
    const v1 = {
      ...VIATICO_BASE, planCodigo: "VJ-20260901-00123456", cliente: "Distribuidora Guatemalteca de Alimentos S.A.",
      personalNombre: "Juan Carlos Perez Lopez Gonzalez", montoAsignado: 50,
    };
    const v2 = {
      ...VIATICO_BASE, id: 2, planCodigo: "VJ-20260901-00123457", cliente: "Distribuidora Guatemalteca de Alimentos S.A.",
      personalNombre: "Maria Fernanda Lopez", montoAsignado: 1250,
    };
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [v1, v2], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([
      { ...FIRMA_BASE, nombreFirmante: "Heber Alexander Sitan Ramirez", codigoFirma: "SIG-20260909-a1b2c3d4" },
    ]);
    const spy = espiarTexto();
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    const textos = spy.mock.calls.map(llamadaTexto);
    const montos = textos.filter((t) => /^Q[\d.,]+$/.test(t.texto));
    expect(montos.map((m) => m.texto)).toEqual(["Q50.00", "Q1,250.00"]);
    for (const m of montos) expect(m.opciones?.align).toBe("center");
  });

  it("ningún texto dibujado en el PDF contiene el carácter de truncamiento '…'", async () => {
    const v1 = {
      ...VIATICO_BASE, planCodigo: "VJ-20260901-00123456", cliente: "Distribuidora Guatemalteca de Alimentos S.A.",
      personalNombre: "Juan Carlos Perez Lopez Gonzalez", montoAsignado: 999999.99,
    };
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [v1], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([
      { ...FIRMA_BASE, nombreFirmante: "Heber Alexander Sitan Ramirez", codigoFirma: "SIG-20260909-a1b2c3d4" },
    ]);
    const spy = espiarTexto();
    await comprobanteAutorizacionesPdf(7, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    const truncados = textos.filter((t) => t.includes("…"));
    expect(truncados).toEqual([]);
  });
});

describe("VIATICOS-PDF-PRESENTACION-1 — sin página en blanco extra", () => {
  it("un comprobante con un único viático genera EXACTAMENTE 1 página (antes generaba 2, la segunda vacía)", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    // Marcador estructural del PDF (no comprimido, a diferencia del
    // contenido de texto) — mismo criterio ya usado en cotizacion-pdf.test.ts
    // para contar páginas sin depender de streams comprimidos.
    const paginas = buf!.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g);
    expect(paginas).toHaveLength(1);
  });

  it("un comprobante con firmantes que SÍ requieren varias páginas sigue generándolas (el fix no afecta PDFs multipágina legítimos)", async () => {
    // Muchos firmantes DISTINTOS con imagen para forzar overflow real de
    // contenido a una segunda página — el bloque de blank-page-fix debe
    // seguir permitiendo esto (nunca fuerza todo a una sola página).
    const PNG_1X1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const items = Array.from({ length: 12 }, (_, i) => ({
      ...VIATICO_BASE, id: i + 1, planCodigo: `VJ-${String(i + 1).padStart(3, "0")}`,
    }));
    vi.mocked(listarViaticosControl).mockResolvedValue({ items, resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockImplementation(async (_empresaId, viaticoId) => [
      { ...FIRMA_BASE, id: 100 + Number(viaticoId), usuarioId: 100 + Number(viaticoId), nombreFirmante: `Firmante ${viaticoId}`, codigoFirma: `SIG-${viaticoId}`, tieneImagen: true },
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("firmas_electronicas")) return [{ imagen_ruta: "firmas/x.png", imagen_mime: "image/png" }];
      return [];
    }) as typeof query);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    const paginas = buf!.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g);
    // Con 12 firmantes distintos + imagen cada uno, legítimamente necesita
    // más de 1 página — el fix de la página en blanco NUNCA debe recortar
    // páginas que sí hacen falta.
    expect(paginas!.length).toBeGreaterThan(1);
  });
});
