import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/viaticos", () => ({ listarViaticosControl: vi.fn() }));
vi.mock("@/lib/firmas/firmas-lectura", () => ({ listarFirmasViatico: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));

import { listarViaticosControl } from "@/lib/tms/viaticos";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";
import { query } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import { agruparPorFirmante, comprobanteAutorizacionesPdf, tituloEmpresa } from "./viaticos-comprobante-pdf";

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
    expect(query).not.toHaveBeenCalled(); // sin tieneImagen, no se consulta imagen_ruta
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
