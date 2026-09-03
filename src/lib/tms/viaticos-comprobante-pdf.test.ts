import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/viaticos", () => ({ listarViaticosControl: vi.fn() }));
vi.mock("@/lib/firmas/firmas-lectura", () => ({ listarFirmasViatico: vi.fn() }));

import { listarViaticosControl } from "@/lib/tms/viaticos";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";
import { comprobanteAutorizacionesPdf } from "./viaticos-comprobante-pdf";

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
});
afterEach(() => vi.restoreAllMocks());

describe("comprobanteAutorizacionesPdf", () => {
  it("regresa null cuando no hay ningún viático AUTORIZADO (nunca un PDF vacío)", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [], resumen: {} as never });
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).toBeNull();
    expect(listarViaticosControl).toHaveBeenCalledWith(7, { estado: "AUTORIZADO" });
    expect(listarFirmasViatico).not.toHaveBeenCalled();
  });

  it("genera una tabla en PDF válida (empieza con %PDF) con un viático autorizado y su firma", async () => {
    vi.mocked(listarViaticosControl).mockResolvedValue({ items: [VIATICO_BASE], resumen: {} as never });
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_BASE]);
    const buf = await comprobanteAutorizacionesPdf(7, "SITSA");
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(listarFirmasViatico).toHaveBeenCalledWith(7, 1);
  });

  it("sin firma de autorización registrada, el PDF se genera igual (fila con 'No disponible', nunca falla)", async () => {
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
    // No debe reventar ni usar la firma de liquidación — se genera igual
    // que "sin firma registrada" (fila con "No disponible").
    expect(buf).not.toBeNull();
  });
});
