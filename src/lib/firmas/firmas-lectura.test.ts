import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { listarFirmasViatico } from "./firmas-lectura";

/**
 * VIATICOS-HISTORIAL-FIRMA-1 — pruebas del helper de LECTURA de
 * firmas_electronicas. `query` está mockeado (mismo patrón que el resto
 * de pruebas de este proyecto) — el filtrado real por empresa/modulo/
 * entidad_tipo lo garantiza MySQL en producción; aquí se verifica que el
 * SQL/params enviados son exactamente los que aíslan correctamente
 * (2/3/4) y que el parseo de payload_canonico es seguro (6/7/8/9).
 */

function filaFirma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    accion: "AUTORIZAR_VIATICO",
    codigo_firma: "SIG-20260831-ABCD1234",
    fecha_hora_servidor: "2026-08-31 08:15:00",
    metodo: "FIRMA_MANUSCRITA",
    usuario_id: 3,
    empleado_id: null,
    payload_canonico: JSON.stringify({
      nombreFirmante: "Juan Pérez",
      rolFirmante: "Jefe de Operaciones",
      origenFirma: "DIBUJADA",
    }),
    hash_payload: "a".repeat(64),
    imagen_ruta: "empresas/7/firmas/firma_viatico_autorizar_10.png",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("listarFirmasViatico — aislamiento (1/2/3/4)", () => {
  it("1) consulta filtrada por empresa_id + entidad_id — nunca trae más de lo pedido", async () => {
    vi.mocked(query).mockResolvedValue([filaFirma()] as unknown as Awaited<ReturnType<typeof query>>);
    await listarFirmasViatico(7, 10);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ?");
    expect(String(sql)).toContain("entidad_id = ?");
    expect(params).toEqual([7, 10]);
  });

  it("2) empresa incorrecta -> empresa_id viaja como parámetro real del WHERE, nunca se omite ni se sustituye por el del viático", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await listarFirmasViatico(999, 10);
    expect(r).toEqual([]);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params![0]).toBe(999);
  });

  it("3) excluye otros módulos: el SQL fija modulo = 'VIATICOS' literal (no parametrizado, no puede filtrarse por accidente)", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    await listarFirmasViatico(7, 10);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("modulo = 'VIATICOS'");
  });

  it("4) excluye otras entidades: el SQL fija entidad_tipo = 'VIATICO' literal", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    await listarFirmasViatico(7, 10);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("entidad_tipo = 'VIATICO'");
  });

  it("17) la consulta nunca referencia usuario_firmas — el historial es independiente de la plantilla personal vigente", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    await listarFirmasViatico(7, 10);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).not.toContain("usuario_firmas");
  });
});

describe("listarFirmasViatico — orden y mapeo", () => {
  it("5) orden cronológico: el SQL ordena por fecha_hora_servidor ASC (autorización antes que liquidación)", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    await listarFirmasViatico(7, 10);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("ORDER BY fecha_hora_servidor ASC");
  });

  it("6/7) parsea nombreFirmante y rolFirmante desde payload_canonico", async () => {
    vi.mocked(query).mockResolvedValue([filaFirma()] as unknown as Awaited<ReturnType<typeof query>>);
    const [firma] = await listarFirmasViatico(7, 10);
    expect(firma.nombreFirmante).toBe("Juan Pérez");
    expect(firma.rolFirmante).toBe("Jefe de Operaciones");
  });

  it("8) parsea origenFirma ('GUARDADA'/'DIBUJADA') desde payload_canonico", async () => {
    vi.mocked(query).mockResolvedValue([
      filaFirma({ payload_canonico: JSON.stringify({ nombreFirmante: "Ana", rolFirmante: "Jefe", origenFirma: "GUARDADA" }) }),
    ] as unknown as Awaited<ReturnType<typeof query>>);
    const [firma] = await listarFirmasViatico(7, 10);
    expect(firma.origenFirma).toBe("GUARDADA");
  });

  it("9) payload viejo sin origenFirma (o sin ningún campo) -> null, nunca inventa un valor", async () => {
    vi.mocked(query).mockResolvedValue([
      filaFirma({ payload_canonico: JSON.stringify({ nombreFirmante: "Carlos", rolFirmante: "Facturador" }) }),
    ] as unknown as Awaited<ReturnType<typeof query>>);
    const [firma] = await listarFirmasViatico(7, 10);
    expect(firma.origenFirma).toBeNull();
    expect(firma.nombreFirmante).toBe("Carlos");
  });

  it("payload_canonico corrupto (JSON inválido) -> se degrada a null en todo, nunca lanza", async () => {
    vi.mocked(query).mockResolvedValue([
      filaFirma({ payload_canonico: "{esto no es json" }),
    ] as unknown as Awaited<ReturnType<typeof query>>);
    const [firma] = await listarFirmasViatico(7, 10);
    expect(firma.nombreFirmante).toBeNull();
    expect(firma.rolFirmante).toBeNull();
    expect(firma.origenFirma).toBeNull();
  });

  it("16) viático sin firmas -> []", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await listarFirmasViatico(7, 999);
    expect(r).toEqual([]);
  });

  it("nunca expone imagen_ruta ni payload_canonico completo en el resultado — solo tieneImagen (boolean)", async () => {
    vi.mocked(query).mockResolvedValue([filaFirma()] as unknown as Awaited<ReturnType<typeof query>>);
    const [firma] = await listarFirmasViatico(7, 10);
    expect(firma.tieneImagen).toBe(true);
    expect((firma as Record<string, unknown>).imagenRuta).toBeUndefined();
    expect((firma as Record<string, unknown>).payloadCanonico).toBeUndefined();
    expect((firma as Record<string, unknown>).ip).toBeUndefined();
    expect((firma as Record<string, unknown>).userAgent).toBeUndefined();
    expect((firma as Record<string, unknown>).sesionId).toBeUndefined();
  });

  it("tieneImagen: false cuando imagen_ruta es null (firma sin imagen)", async () => {
    vi.mocked(query).mockResolvedValue([filaFirma({ imagen_ruta: null })] as unknown as Awaited<ReturnType<typeof query>>);
    const [firma] = await listarFirmasViatico(7, 10);
    expect(firma.tieneImagen).toBe(false);
  });
});
