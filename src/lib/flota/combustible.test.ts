import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/rrhh/dates", () => ({ ahoraLocal: vi.fn(() => "2026-09-03 10:00:00") }));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(() => Promise.resolve({ relative: "empresas/7/flota/vale.jpg", original: "vale.jpg", size: 123 })),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));

import { execute, query } from "@/lib/db";
import { guardarUpload } from "@/lib/uploads";
import {
  listarCargasCombustibleViaje,
  obtenerArchivoCargaCombustible,
  registrarCargaCombustible,
} from "./combustible";

const FILE = {
  name: "vale.jpg",
  size: 123,
  type: "image/jpeg",
  arrayBuffer: async () => new ArrayBuffer(1),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/7/flota/vale.jpg", original: "vale.jpg", size: 123 });
  vi.mocked(execute).mockResolvedValue({ insertId: 99 } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("registrarCargaCombustible", () => {
  it("sube el archivo al subdir 'flota' (mismo patrón que evidencias de viaje) e inserta con estado PENDIENTE", async () => {
    const id = await registrarCargaCombustible({
      empresaId: 7,
      vehiculoId: 3,
      viajeId: 5,
      empleadoId: 42,
      pilotoNombre: "Juan Pérez",
      tipoCombustible: "diesel",
      galones: 40,
      monto: 850.5,
      km: 12000,
      gasolinera: "Shell Zona 10",
      file: FILE,
      username: "portal:E001",
    });
    expect(id).toBe(99);
    expect(guardarUpload).toHaveBeenCalledWith(7, "flota", "combustible_5", FILE);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO flota_combustible_cargas"),
      [7, 3, 5, 42, "Juan Pérez", "diesel", 40, 850.5, 12000, "Shell Zona 10", "empresas/7/flota/vale.jpg", "vale.jpg", "image/jpeg", 123, "portal:E001", "2026-09-03 10:00:00"],
    );
  });

  it("km null (unidad sin odómetro funcional) se guarda como NULL, no como 0", async () => {
    await registrarCargaCombustible({
      empresaId: 7, vehiculoId: 3, viajeId: 5, empleadoId: 42, pilotoNombre: "Juan Pérez",
      tipoCombustible: "gasolina", galones: 10, monto: 200, km: null, gasolinera: null,
      file: FILE, username: "portal:E001",
    });
    const params = vi.mocked(execute).mock.calls[0][1] as unknown[];
    expect(params[8]).toBeNull(); // km
    expect(params[9]).toBeNull(); // gasolinera
  });
});

describe("listarCargasCombustibleViaje", () => {
  it("mapea las filas de la BD al tipo CargaCombustible", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1, viaje_id: 5, tipo_combustible: "diesel", galones: "40.00", monto: "850.50",
        km: 12000, gasolinera: "Shell Zona 10", nombre_original: "vale.jpg",
        estado: "PENDIENTE", motivo_rechazo: null, creado_por: "portal:E001", creado_at: "2026-09-03 10:00:00",
      },
    ] as never);
    const out = await listarCargasCombustibleViaje(7, 5);
    expect(out).toEqual([
      {
        id: 1, viajeId: 5, tipoCombustible: "diesel", galones: 40, monto: 850.5,
        km: 12000, gasolinera: "Shell Zona 10", nombreArchivo: "vale.jpg",
        estado: "PENDIENTE", motivoRechazo: null, creadoPor: "portal:E001", creadoEn: "2026-09-03 10:00:00",
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE empresa_id = ? AND viaje_id = ?"), [7, 5]);
  });

  it("un estado desconocido en la BD nunca revienta el mapeo, cae a PENDIENTE", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 1, viaje_id: 5, tipo_combustible: "diesel", galones: 1, monto: 1, km: null, gasolinera: null, nombre_original: "x.jpg", estado: "ALGO_RARO", motivo_rechazo: null, creado_por: "x", creado_at: "x" },
    ] as never);
    const out = await listarCargasCombustibleViaje(7, 5);
    expect(out[0].estado).toBe("PENDIENTE");
  });
});

describe("obtenerArchivoCargaCombustible", () => {
  it("acota la consulta a empresa + viaje + id (nunca solo el id)", async () => {
    vi.mocked(query).mockResolvedValue([
      { ruta_relativa: "empresas/7/flota/vale.jpg", nombre_original: "vale.jpg", mime: "image/jpeg" },
    ] as never);
    const out = await obtenerArchivoCargaCombustible(7, 5, 1);
    expect(out).toEqual({ rutaRelativa: "empresas/7/flota/vale.jpg", nombreOriginal: "vale.jpg", mime: "image/jpeg" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = ? AND viaje_id = ? AND empresa_id = ?"), [1, 5, 7]);
  });

  it("regresa null cuando no hay fila (evita 200 con datos vacíos)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerArchivoCargaCombustible(7, 5, 999)).toBeNull();
  });
});
