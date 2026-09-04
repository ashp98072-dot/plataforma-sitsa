import { beforeEach, describe, expect, it, vi } from "vitest";

const beginTransaction = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();
const release = vi.fn();
const execute = vi.fn();

const getConnection = vi.fn(async () => ({
  beginTransaction,
  commit,
  rollback,
  release,
  execute,
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({
    getConnection,
  }),
}));

vi.mock("@/lib/rrhh/dates", () => ({
  ahoraLocal: () => "2026-09-04 11:15:00",
}));

import {
  guardarConciliacionCombustible,
} from "./combustible-conciliacion-persistencia";

describe("guardarConciliacionCombustible", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    beginTransaction.mockResolvedValue(undefined);
    commit.mockResolvedValue(undefined);
    rollback.mockResolvedValue(undefined);
    release.mockReturnValue(undefined);

    execute.mockReset();

    execute.mockResolvedValue([
      {
        insertId: 100,
        affectedRows: 1,
      },
    ]);
  });

  it("guarda cabecera y una fila COINCIDE dentro de una transacción", async () => {
    const resultado =
      await guardarConciliacionCombustible({
        empresaId: 10,
        archivo: {
          nombreOriginal: "reporte.xlsx",
          rutaRelativa:
            "flota/combustible_conciliaciones/reporte.xlsx",
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          tamano: 12345,
        },
        hoja: "2026",
        subidoPor: "admin",
        resultados: [
          {
            estado: "COINCIDE",
            sistema: {
              id: 1,
              numeroVale: "4334",
              fechaConsumo: "2026-09-04",
              placa: "C-035BXR",
              pilotoNombre: "Piloto Sistema",
              producto: "diesel",
              galones: 7.15,
              precioGalon: 43.69,
              monto: 312.38,
            },
            gasolinera: {
              fila: 10,
              numeroVale: "4334",
              fechaConsumo: "2026-09-04",
              placa: "035 BXR",
              pilotoNombre: "Piloto Gasolinera",
              producto: "diesel",
              galones: 7.15,
              precioGalon: 43.69,
              monto: 312.38,
            },
            diferencias: [],
          },
        ],
        descartadas: [],
      });

    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);

    expect(resultado).toEqual({
      conciliacionId: 100,
      filasGuardadas: 1,
    });

    expect(execute).toHaveBeenCalledTimes(2);

    const llamadaCabecera = execute.mock.calls[0];

    expect(String(llamadaCabecera[0])).toContain(
      "INSERT INTO flota_combustible_conciliaciones",
    );

    expect(llamadaCabecera[1]).toEqual([
      10,
      "reporte.xlsx",
      "flota/combustible_conciliaciones/reporte.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      12345,
      "2026",
      "admin",
      "2026-09-04 11:15:00",
    ]);

    const llamadaFila = execute.mock.calls[1];

    expect(String(llamadaFila[0])).toContain(
      "INSERT INTO flota_combustible_conciliacion_filas",
    );

    expect(llamadaFila[1]).toEqual(
      expect.arrayContaining([
        100,
        10,
        10,
        "COINCIDE",
        1,
        "4334",
        "2026-09-04",
        "035 BXR",
        "Piloto Gasolinera",
        "diesel",
        7.15,
        43.69,
        312.38,
        "C-035BXR",
        "Piloto Sistema",
      ]),
    );
  });

  it("guarda las diferencias serializadas como JSON", async () => {
    await guardarConciliacionCombustible({
      empresaId: 10,
      archivo: {
        nombreOriginal: "reporte.xlsx",
        rutaRelativa: "flota/reporte.xlsx",
        mime: null,
        tamano: 100,
      },
      hoja: "Reporte",
      subidoPor: "operaciones",
      resultados: [
        {
          estado: "DIFERENCIA",
          sistema: {
            id: 1,
            numeroVale: "5000",
            fechaConsumo: "2026-09-04",
            placa: "C-034BXR",
            pilotoNombre: "Piloto",
            producto: "diesel",
            galones: 10,
            precioGalon: 40,
            monto: 400,
          },
          gasolinera: {
            fila: 8,
            numeroVale: "5000",
            fechaConsumo: "2026-09-04",
            placa: "034 BXR",
            pilotoNombre: "Piloto",
            producto: "diesel",
            galones: 10,
            precioGalon: 40,
            monto: 410,
          },
          diferencias: [
            {
              campo: "monto",
              sistema: "Q400.00",
              gasolinera: "Q410.00",
            },
          ],
        },
      ],
      descartadas: [],
    });

    const paramsFila = execute.mock.calls[1][1] as unknown[];

    expect(
      paramsFila.some(
        (valor) =>
          valor ===
          JSON.stringify([
            {
              campo: "monto",
              sistema: "Q400.00",
              gasolinera: "Q410.00",
            },
          ]),
      ),
    ).toBe(true);
  });

  it("guarda SOLO_GASOLINERA sin carga del sistema", async () => {
    const resultado =
      await guardarConciliacionCombustible({
        empresaId: 20,
        archivo: {
          nombreOriginal: "gasolinera.xlsx",
          rutaRelativa: "flota/gasolinera.xlsx",
          mime: null,
          tamano: 200,
        },
        hoja: "Reporte",
        subidoPor: "ops",
        resultados: [
          {
            estado: "SOLO_GASOLINERA",
            sistema: null,
            gasolinera: {
              fila: 5,
              numeroVale: "9999",
              fechaConsumo: "2026-09-03",
              placa: "999 XYZ",
              pilotoNombre: "Piloto",
              producto: "diesel",
              galones: 20,
              precioGalon: 40,
              monto: 800,
            },
            diferencias: [],
          },
        ],
        descartadas: [],
      });

    expect(resultado.filasGuardadas).toBe(1);

    const paramsFila = execute.mock.calls[1][1] as unknown[];

    expect(paramsFila).toContain("SOLO_GASOLINERA");
    expect(paramsFila).toContain("9999");
    expect(paramsFila).toContain("999 XYZ");
  });

  it("guarda SOLO_SISTEMA sin fila del Excel", async () => {
    const resultado =
      await guardarConciliacionCombustible({
        empresaId: 20,
        archivo: {
          nombreOriginal: "gasolinera.xlsx",
          rutaRelativa: "flota/gasolinera.xlsx",
          mime: null,
          tamano: 200,
        },
        hoja: "Reporte",
        subidoPor: "ops",
        resultados: [
          {
            estado: "SOLO_SISTEMA",
            sistema: {
              id: 77,
              numeroVale: "A-123",
              fechaConsumo: "2026-09-02",
              placa: "C-111ABC",
              pilotoNombre: "Piloto",
              producto: "diesel",
              galones: 12.5,
              precioGalon: 40,
              monto: 500,
            },
            gasolinera: null,
            diferencias: [],
          },
        ],
        descartadas: [],
      });

    expect(resultado.filasGuardadas).toBe(1);

    const paramsFila = execute.mock.calls[1][1] as unknown[];

    expect(paramsFila).toContain("SOLO_SISTEMA");
    expect(paramsFila).toContain(77);
    expect(paramsFila).toContain("A-123");
  });

  it("conserva filas descartadas del Excel", async () => {
    const resultado =
      await guardarConciliacionCombustible({
        empresaId: 10,
        archivo: {
          nombreOriginal: "reporte.xlsx",
          rutaRelativa: "flota/reporte.xlsx",
          mime: null,
          tamano: 100,
        },
        hoja: "2026",
        subidoPor: "admin",
        resultados: [],
        descartadas: [
          {
            fila: 15,
            motivo: "Monto inválido.",
          },
          {
            fila: 16,
            motivo: "Vale vacío.",
          },
        ],
      });

    expect(resultado).toEqual({
      conciliacionId: 100,
      filasGuardadas: 2,
    });

    expect(execute).toHaveBeenCalledTimes(3);

    const paramsDescartada1 =
      execute.mock.calls[1][1] as unknown[];

    const paramsDescartada2 =
      execute.mock.calls[2][1] as unknown[];

    expect(paramsDescartada1).toEqual([
      100,
      10,
      15,
      "Monto inválido.",
      "2026-09-04 11:15:00",
    ]);

    expect(paramsDescartada2).toEqual([
      100,
      10,
      16,
      "Vale vacío.",
      "2026-09-04 11:15:00",
    ]);
  });

  it("revierte toda la transacción si falla una fila", async () => {
    execute
      .mockResolvedValueOnce([
        {
          insertId: 100,
          affectedRows: 1,
        },
      ])
      .mockRejectedValueOnce(
        new Error("Fallo insert fila"),
      );

    await expect(
      guardarConciliacionCombustible({
        empresaId: 10,
        archivo: {
          nombreOriginal: "reporte.xlsx",
          rutaRelativa: "flota/reporte.xlsx",
          mime: null,
          tamano: 100,
        },
        hoja: "2026",
        subidoPor: "admin",
        resultados: [
          {
            estado: "COINCIDE",
            sistema: {
              id: 1,
              numeroVale: "4334",
              fechaConsumo: "2026-09-04",
              placa: "C-035BXR",
              pilotoNombre: "Piloto",
              producto: "diesel",
              galones: 7.15,
              precioGalon: 43.69,
              monto: 312.38,
            },
            gasolinera: {
              fila: 2,
              numeroVale: "4334",
              fechaConsumo: "2026-09-04",
              placa: "035 BXR",
              pilotoNombre: "Piloto",
              producto: "diesel",
              galones: 7.15,
              precioGalon: 43.69,
              monto: 312.38,
            },
            diferencias: [],
          },
        ],
        descartadas: [],
      }),
    ).rejects.toThrow("Fallo insert fila");

    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rechaza empresaId inválido antes de abrir conexión", async () => {
    await expect(
      guardarConciliacionCombustible({
        empresaId: 0,
        archivo: {
          nombreOriginal: "reporte.xlsx",
          rutaRelativa: "flota/reporte.xlsx",
          mime: null,
          tamano: 100,
        },
        hoja: "2026",
        subidoPor: "admin",
        resultados: [],
        descartadas: [],
      }),
    ).rejects.toThrow("empresaId inválido.");

    expect(getConnection).not.toHaveBeenCalled();
  });

  it("rechaza archivo sin nombre", async () => {
    await expect(
      guardarConciliacionCombustible({
        empresaId: 10,
        archivo: {
          nombreOriginal: "   ",
          rutaRelativa: "flota/reporte.xlsx",
          mime: null,
          tamano: 100,
        },
        hoja: "2026",
        subidoPor: "admin",
        resultados: [],
        descartadas: [],
      }),
    ).rejects.toThrow("Nombre de archivo inválido.");

    expect(getConnection).not.toHaveBeenCalled();
  });

  it("rechaza usuario vacío", async () => {
    await expect(
      guardarConciliacionCombustible({
        empresaId: 10,
        archivo: {
          nombreOriginal: "reporte.xlsx",
          rutaRelativa: "flota/reporte.xlsx",
          mime: null,
          tamano: 100,
        },
        hoja: "2026",
        subidoPor: "   ",
        resultados: [],
        descartadas: [],
      }),
    ).rejects.toThrow("Usuario inválido.");

    expect(getConnection).not.toHaveBeenCalled();
  });
});