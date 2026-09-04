import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/rrhh/dates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rrhh/dates")>("@/lib/rrhh/dates");
  return { ...actual, ahoraLocal: vi.fn(() => "2026-09-03 10:00:00") };
});
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(() => Promise.resolve({ relative: "empresas/7/flota/vale.jpg", original: "vale.jpg", size: 123 })),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));

import { execute, query } from "@/lib/db";
import { guardarUpload } from "@/lib/uploads";
import {
  listarCargasCombustibleRevision,
  listarCargasCombustibleViaje,
  obtenerArchivoCargaCombustible,
  obtenerArchivoCargaCombustiblePorEmpresa,
  registrarCargaCombustible,
  resumenCombustibleMensual,
  revisarCargaCombustible,
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
      numeroVale: "A-12345",
      fechaConsumo: "2026-09-02",
      galones: 40,
      monto: 850.5,
      precioGalon: 21.26,
      km: 12000,
      gasolinera: "Shell Zona 10",
      file: FILE,
      username: "portal:E001",
    });
    expect(id).toBe(99);
    expect(guardarUpload).toHaveBeenCalledWith(7, "flota", "combustible_5", FILE);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO flota_combustible_cargas"),
      [
        7, 3, 5, 42, "Juan Pérez", "diesel", "A-12345", "2026-09-02", 40, 850.5, 21.26, 12000,
        "Shell Zona 10", "empresas/7/flota/vale.jpg", "vale.jpg", "image/jpeg", 123, "portal:E001",
        "2026-09-03 10:00:00",
      ],
    );
  });

  it("km null (unidad sin odómetro funcional) se guarda como NULL, no como 0", async () => {
    await registrarCargaCombustible({
      empresaId: 7, vehiculoId: 3, viajeId: 5, empleadoId: 42, pilotoNombre: "Juan Pérez",
      tipoCombustible: "gasolina", numeroVale: "B-1", fechaConsumo: "2026-09-02",
      galones: 10, monto: 200, precioGalon: 20, km: null, gasolinera: null,
      file: FILE, username: "portal:E001",
    });
    const params = vi.mocked(execute).mock.calls[0][1] as unknown[];
    expect(params[11]).toBeNull(); // km
    expect(params[12]).toBeNull(); // gasolinera
  });
});

describe("listarCargasCombustibleViaje", () => {
  it("mapea las filas de la BD al tipo CargaCombustible, incluyendo vale/fecha de consumo/precio (FLOTA-COMBUSTIBLE-2)", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1, viaje_id: 5, tipo_combustible: "diesel", numero_vale: "A-12345", fecha_consumo: "2026-09-02",
        galones: "40.00", monto: "850.50", precio_por_galon: "21.26",
        km: 12000, gasolinera: "Shell Zona 10", nombre_original: "vale.jpg",
        estado: "PENDIENTE", motivo_rechazo: null, creado_por: "portal:E001", creado_at: "2026-09-03 10:00:00",
      },
    ] as never);
    const out = await listarCargasCombustibleViaje(7, 5);
    expect(out).toEqual([
      {
        id: 1, viajeId: 5, tipoCombustible: "diesel", numeroVale: "A-12345", fechaConsumo: "2026-09-02",
        galones: 40, monto: 850.5, precioGalon: 21.26,
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

  // FLOTA-COMBUSTIBLE-2 (sección 8) — compatibilidad: un registro
  // histórico anterior a este ticket no tiene numero_vale/fecha_consumo/
  // precio_por_galon en la BD (columnas NULL) — el mapeo nunca debe
  // reventar, y esos 3 campos deben salir explícitamente en null (nunca
  // undefined, NaN, ni un valor inventado).
  it("un registro histórico SIN numero_vale/fecha_consumo/precio_por_galon (columnas NULL) mapea esos 3 campos a null, sin romper el resto", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1, viaje_id: 5, tipo_combustible: "diesel", numero_vale: null, fecha_consumo: null,
        galones: "40.00", monto: "850.50", precio_por_galon: null,
        km: 12000, gasolinera: "Shell Zona 10", nombre_original: "vale.jpg",
        estado: "APROBADO", motivo_rechazo: null, creado_por: "portal:E001", creado_at: "2026-08-01 09:00:00",
      },
    ] as never);
    const out = await listarCargasCombustibleViaje(7, 5);
    expect(out[0].numeroVale).toBeNull();
    expect(out[0].fechaConsumo).toBeNull();
    expect(out[0].precioGalon).toBeNull();
    // El resto de la fila sigue mapeándose con normalidad.
    expect(out[0]).toMatchObject({ id: 1, galones: 40, monto: 850.5, estado: "APROBADO" });
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

describe("obtenerArchivoCargaCombustiblePorEmpresa (Fase 2 — Operaciones)", () => {
  it("acota la consulta a empresa + id, SIN viajeId (Operaciones tiene autoridad sobre todos los viajes)", async () => {
    vi.mocked(query).mockResolvedValue([
      { ruta_relativa: "empresas/7/flota/vale.jpg", nombre_original: "vale.jpg", mime: "image/jpeg" },
    ] as never);
    const out = await obtenerArchivoCargaCombustiblePorEmpresa(7, 1);
    expect(out).toEqual({ rutaRelativa: "empresas/7/flota/vale.jpg", nombreOriginal: "vale.jpg", mime: "image/jpeg" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = ? AND empresa_id = ?"), [1, 7]);
  });

  it("regresa null cuando no hay fila", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerArchivoCargaCombustiblePorEmpresa(7, 999)).toBeNull();
  });
});

describe("listarCargasCombustibleRevision (Fase 2)", () => {
  it("sin filtros: consulta solo por empresa_id, y arma el resumen por estado", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 1, viaje_id: 5, tipo_combustible: "diesel", galones: 40, monto: 850.5, km: 12000,
          gasolinera: "Shell Zona 10", nombre_original: "vale.jpg", estado: "PENDIENTE", motivo_rechazo: null,
          creado_por: "portal:E001", creado_at: "2026-09-03 10:00:00", revisado_por: null, revisado_en: null,
          piloto_nombre: "Juan Pérez", placa: "C-034BXR",
        },
      ] as never)
      .mockResolvedValueOnce([
        { estado: "PENDIENTE", n: 3 },
        { estado: "APROBADO", n: 5 },
      ] as never);

    const { items, resumen } = await listarCargasCombustibleRevision(7);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 1, placa: "C-034BXR", pilotoNombre: "Juan Pérez", estado: "PENDIENTE" });
    expect(resumen).toEqual({ PENDIENTE: 3, APROBADO: 5, RECHAZADO: 0 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("c.empresa_id = ?");
    expect(String(sql)).not.toContain("c.estado = ?");
    expect(params).toEqual([7]);
  });

  it("con filtro de estado: agrega la condición y el parámetro", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarCargasCombustibleRevision(7, { estado: "APROBADO" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("c.estado = ?");
    expect(params).toEqual([7, "APROBADO"]);
  });

  it("con desde/hasta: filtra por creado_at con el rango del día completo", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarCargasCombustibleRevision(7, { desde: "2026-09-01", hasta: "2026-09-30" });
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([7, "2026-09-01 00:00:00", "2026-09-30 23:59:59"]);
  });

  it("un estado desconocido en el resumen se ignora (nunca revienta)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ estado: "ALGO_RARO", n: 1 }] as never);
    const { resumen } = await listarCargasCombustibleRevision(7);
    expect(resumen).toEqual({ PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 });
  });

  // FLOTA-COMBUSTIBLE-HARDENING-1 (sección 3) — el resumen (conteo por
  // estado de las 3 pestañas) debe reflejar los mismos filtros de
  // fecha/vehículo activos en la pantalla, para que "Pendientes/
  // Aprobados/Rechazados" describan el MISMO universo filtrado (p.ej.
  // "septiembre + vehículo X") en vez de los totales históricos de toda
  // la empresa.
  describe("el resumen refleja desde/hasta/vehiculoId, pero NUNCA el filtro estado", () => {
    it("con desde/hasta activos, la consulta del resumen también los aplica", async () => {
      vi.mocked(query).mockResolvedValue([] as never);
      await listarCargasCombustibleRevision(7, { desde: "2026-09-01", hasta: "2026-09-30" });
      // Llamada 0 = listado, llamada 1 = resumen.
      const [sqlResumen, paramsResumen] = vi.mocked(query).mock.calls[1];
      expect(String(sqlResumen)).toContain("c.creado_at >= ?");
      expect(String(sqlResumen)).toContain("c.creado_at <= ?");
      expect(paramsResumen).toEqual([7, "2026-09-01 00:00:00", "2026-09-30 23:59:59"]);
    });

    it("con vehiculoId activo, la consulta del resumen también lo aplica", async () => {
      vi.mocked(query).mockResolvedValue([] as never);
      await listarCargasCombustibleRevision(7, { vehiculoId: 3 });
      const [sqlResumen, paramsResumen] = vi.mocked(query).mock.calls[1];
      expect(String(sqlResumen)).toContain("c.vehiculo_id = ?");
      expect(paramsResumen).toEqual([7, 3]);
    });

    it("con estado=PENDIENTE activo, la consulta del resumen NUNCA filtra por estado (las 3 pestañas comparten universo)", async () => {
      vi.mocked(query).mockResolvedValue([] as never);
      await listarCargasCombustibleRevision(7, { estado: "PENDIENTE", desde: "2026-09-01" });
      const [sqlListado, paramsListado] = vi.mocked(query).mock.calls[0];
      const [sqlResumen, paramsResumen] = vi.mocked(query).mock.calls[1];
      // El listado SÍ filtra por estado...
      expect(String(sqlListado)).toContain("c.estado = ?");
      expect(paramsListado).toEqual([7, "2026-09-01 00:00:00", "PENDIENTE"]);
      // ...pero el resumen NO, aunque comparta el filtro de fecha.
      expect(String(sqlResumen)).not.toContain("c.estado = ?");
      expect(paramsResumen).toEqual([7, "2026-09-01 00:00:00"]);
    });

    it("septiembre + vehículo X: el resumen cuenta solo dentro de ese universo (ejemplo del ticket)", async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([] as never) // listado (no importa para este caso)
        .mockResolvedValueOnce([
          { estado: "PENDIENTE", n: 3 },
          { estado: "APROBADO", n: 12 },
          { estado: "RECHAZADO", n: 1 },
        ] as never);
      const { resumen } = await listarCargasCombustibleRevision(7, {
        desde: "2026-09-01", hasta: "2026-09-30", vehiculoId: 3,
      });
      expect(resumen).toEqual({ PENDIENTE: 3, APROBADO: 12, RECHAZADO: 1 });
    });
  });
});

describe("revisarCargaCombustible (Fase 2)", () => {
  it("aprobar: actualiza estado=APROBADO y motivo_rechazo=null", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    const out = await revisarCargaCombustible(7, 1, "aprobar", "op1");
    expect(out).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET estado = ?"),
      ["APROBADO", "op1", "2026-09-03 10:00:00", null, 1, 7],
    );
  });

  it("rechazar SIN motivo -> 400, nunca llega a ejecutar el UPDATE", async () => {
    const out = await revisarCargaCombustible(7, 1, "rechazar", "op1");
    expect(out).toEqual({ ok: false, error: "Indica el motivo del rechazo.", status: 400 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rechazar CON motivo: actualiza estado=RECHAZADO y guarda el motivo (recortado)", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    const out = await revisarCargaCombustible(7, 1, "rechazar", "op1", "  Vale ilegible  ");
    expect(out).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET estado = ?"),
      ["RECHAZADO", "op1", "2026-09-03 10:00:00", "Vale ilegible", 1, 7],
    );
  });

  it("carga ya revisada (0 filas afectadas por el WHERE estado='PENDIENTE') -> 409, no pisa la decisión anterior", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as never);
    const out = await revisarCargaCombustible(7, 1, "aprobar", "op1");
    expect(out.ok).toBe(false);
    expect((out as { status: number }).status).toBe(409);
  });
});

describe("resumenCombustibleMensual (Fase 3)", () => {
  it("usa el rango [YYYY-MM-01, mes_siguiente-01) y filtra por estado APROBADO", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await resumenCombustibleMensual(7, "2026-09");
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("c.estado = 'APROBADO'");
    expect(params).toEqual([7, "2026-09-01", "2026-10-01"]);
  });

  it("rechaza un mes con formato inválido (delega en rangoMes, ya probado — no reimplementa la validación)", async () => {
    await expect(resumenCombustibleMensual(7, "2026-13")).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("suma galones/monto por vehículo, separando diesel de gasolina", async () => {
    vi.mocked(query).mockResolvedValue([
      { vehiculo_id: 3, placa: "C-034BXR", tipo_combustible: "diesel", galones: "80.00", monto: "1700.00", n: 2 },
      { vehiculo_id: 3, placa: "C-034BXR", tipo_combustible: "gasolina", galones: "10.00", monto: "220.00", n: 1 },
      { vehiculo_id: 4, placa: "P-999ZZZ", tipo_combustible: "diesel", galones: "40.00", monto: "850.00", n: 1 },
    ] as never);
    const { porVehiculo, total } = await resumenCombustibleMensual(7, "2026-09");

    expect(porVehiculo).toEqual([
      {
        vehiculoId: 3, placa: "C-034BXR",
        dieselGalones: 80, dieselMonto: 1700,
        gasolinaGalones: 10, gasolinaMonto: 220,
        totalGalones: 90, totalMonto: 1920,
        cargas: 3,
      },
      {
        vehiculoId: 4, placa: "P-999ZZZ",
        dieselGalones: 40, dieselMonto: 850,
        gasolinaGalones: 0, gasolinaMonto: 0,
        totalGalones: 40, totalMonto: 850,
        cargas: 1,
      },
    ]);
    expect(total).toEqual({
      dieselGalones: 120, dieselMonto: 2550,
      gasolinaGalones: 10, gasolinaMonto: 220,
      totalGalones: 130, totalMonto: 2770,
      cargas: 4,
    });
  });

  it("sin cargas aprobadas en el mes: porVehiculo vacío y total en cero (nunca null/undefined)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const { porVehiculo, total } = await resumenCombustibleMensual(7, "2026-09");
    expect(porVehiculo).toEqual([]);
    expect(total).toEqual({
      dieselGalones: 0, dieselMonto: 0, gasolinaGalones: 0, gasolinaMonto: 0,
      totalGalones: 0, totalMonto: 0, cargas: 0,
    });
  });
});
