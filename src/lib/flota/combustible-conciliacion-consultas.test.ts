import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  listarConciliacionesCombustible,
  obtenerArchivoConciliacionCombustible,
  obtenerConciliacionCombustible,
} from "./combustible-conciliacion-consultas";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listarConciliacionesCombustible", () => {
  it("rechaza empresaId inválido sin consultar la base de datos", async () => {
    await expect(listarConciliacionesCombustible(0)).rejects.toThrow(
      "empresaId inválido.",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("aísla por empresa: consulta filtrando WHERE c.empresa_id = ? con el empresaId recibido", async () => {
    vi.mocked(query).mockResolvedValue([] as never);

    await listarConciliacionesCombustible(20);

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("WHERE c.empresa_id = ?");
    expect(params).toEqual([20]);
  });

  it("no hace N+1: una sola llamada a query() sin importar cuántas conciliaciones devuelva", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1,
        nombre_original: "reporte1.xlsx",
        hoja: "2026",
        subido_por: "ops",
        creado_at: "2026-09-01 10:00:00",
        min_gas: "2026-08-01",
        max_gas: "2026-08-31",
        min_sis: "2026-08-01",
        max_sis: "2026-08-30",
        total_filas: 10,
        descartadas: 1,
        coincide: 6,
        diferencia: 2,
        solo_gasolinera: 1,
        solo_sistema: 0,
        ambiguo: 0,
      },
      {
        id: 2,
        nombre_original: "reporte2.xlsx",
        hoja: "2026",
        subido_por: "ops",
        creado_at: "2026-09-02 10:00:00",
        min_gas: null,
        max_gas: null,
        min_sis: null,
        max_sis: null,
        total_filas: 0,
        descartadas: 0,
        coincide: 0,
        diferencia: 0,
        solo_gasolinera: 0,
        solo_sistema: 0,
        ambiguo: 0,
      },
    ] as never);

    const items = await listarConciliacionesCombustible(20);

    expect(query).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(2);
  });

  it("mapea los conteos por estado agregados en SQL (SUM(f.estado = ...))", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1,
        nombre_original: "reporte.xlsx",
        hoja: "2026",
        subido_por: "ops",
        creado_at: "2026-09-01 10:00:00",
        min_gas: "2026-08-01",
        max_gas: "2026-08-31",
        min_sis: "2026-08-01",
        max_sis: "2026-08-30",
        total_filas: 10,
        descartadas: 1,
        coincide: 6,
        diferencia: 2,
        solo_gasolinera: 1,
        solo_sistema: 0,
        ambiguo: 0,
      },
    ] as never);

    const [item] = await listarConciliacionesCombustible(20);

    expect(item.totalFilas).toBe(10);
    expect(item.descartadas).toBe(1);
    expect(item.coincide).toBe(6);
    expect(item.diferencia).toBe(2);
    expect(item.soloGasolinera).toBe(1);
    expect(item.soloSistema).toBe(0);
    expect(item.ambiguo).toBe(0);
  });

  it("deriva el período de fecha_gasolinera/fecha_sistema de las filas, NUNCA de creado_at", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1,
        nombre_original: "reporte.xlsx",
        hoja: "2026",
        subido_por: "ops",
        // creado_at deliberadamente fuera del rango de las fechas de
        // consumo — el período NO debe basarse en esto.
        creado_at: "2026-09-15 10:00:00",
        min_gas: "2026-08-05",
        max_gas: "2026-08-20",
        min_sis: "2026-08-01",
        max_sis: "2026-08-25",
        total_filas: 3,
        descartadas: 0,
        coincide: 3,
        diferencia: 0,
        solo_gasolinera: 0,
        solo_sistema: 0,
        ambiguo: 0,
      },
    ] as never);

    const [item] = await listarConciliacionesCombustible(20);

    expect(item.periodoDesde).toBe("2026-08-01");
    expect(item.periodoHasta).toBe("2026-08-25");
  });

  it("con una conciliación sin filas (todas las fechas NULL) el período queda en null, sin caer en creado_at", async () => {
    vi.mocked(query).mockResolvedValue([
      {
        id: 1,
        nombre_original: "reporte.xlsx",
        hoja: "2026",
        subido_por: "ops",
        creado_at: "2026-09-15 10:00:00",
        min_gas: null,
        max_gas: null,
        min_sis: null,
        max_sis: null,
        total_filas: 0,
        descartadas: 0,
        coincide: 0,
        diferencia: 0,
        solo_gasolinera: 0,
        solo_sistema: 0,
        ambiguo: 0,
      },
    ] as never);

    const [item] = await listarConciliacionesCombustible(20);

    expect(item.periodoDesde).toBeNull();
    expect(item.periodoHasta).toBeNull();
  });
});

const FILA_COINCIDE = {
  id: 501,
  fila_excel: 2,
  estado: "COINCIDE",
  motivo: null,
  carga_combustible_id: 1,
  estado_sistema: "APROBADO",
  vale_gasolinera: "4334",
  fecha_gasolinera: "2026-09-04",
  placa_gasolinera: "035 BXR",
  piloto_gasolinera: "Piloto",
  producto_gasolinera: "diesel",
  galones_gasolinera: 7.15,
  precio_gasolinera: 43.69,
  monto_gasolinera: 312.38,
  vale_sistema: "4334",
  fecha_sistema: "2026-09-04",
  placa_sistema: "C-035BXR",
  piloto_sistema: "Piloto",
  producto_sistema: "diesel",
  galones_sistema: 7.15,
  precio_sistema: 43.69,
  monto_sistema: 312.38,
  diferencias: null,
};

describe("obtenerConciliacionCombustible", () => {
  it("rechaza empresaId/conciliacionId inválidos sin consultar", async () => {
    await expect(obtenerConciliacionCombustible(0, 1)).rejects.toThrow(
      "empresaId inválido.",
    );
    await expect(obtenerConciliacionCombustible(20, 0)).rejects.toThrow(
      "conciliacionId inválido.",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("conciliación de otra empresa (o inexistente) => null, sin consultar las filas", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);

    const detalle = await obtenerConciliacionCombustible(20, 999);

    expect(detalle).toBeNull();
    // Solo la consulta de cabecera — nunca se llega a pedir las filas de
    // una conciliación que no existe para esta empresa.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("busca la cabecera por id + empresa_id", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);

    await obtenerConciliacionCombustible(20, 5);

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("WHERE id = ? AND empresa_id = ?");
    expect(params).toEqual([5, 20]);
  });

  it("devuelve cabecera + snapshots de gasolinera y sistema, y estadoSistema histórico", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([FILA_COINCIDE] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);

    expect(detalle).not.toBeNull();
    expect(detalle?.id).toBe(5);
    expect(detalle?.filas).toHaveLength(1);

    const fila = detalle!.filas[0];
    expect(fila.estado).toBe("COINCIDE");
    expect(fila.estadoSistema).toBe("APROBADO");
    expect(fila.cargaCombustibleId).toBe(1);
    expect(fila.gasolinera).toEqual({
      numeroVale: "4334",
      fechaConsumo: "2026-09-04",
      placa: "035 BXR",
      pilotoNombre: "Piloto",
      producto: "diesel",
      galones: 7.15,
      precioGalon: 43.69,
      monto: 312.38,
    });
    expect(fila.sistema).toEqual({
      numeroVale: "4334",
      fechaConsumo: "2026-09-04",
      placa: "C-035BXR",
      pilotoNombre: "Piloto",
      producto: "diesel",
      galones: 7.15,
      precioGalon: 43.69,
      monto: 312.38,
    });
  });

  it("SOLO_SISTEMA: sin snapshot de gasolinera (vale_gasolinera NULL) pero con snapshot de sistema", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 502,
          fila_excel: null,
          estado: "SOLO_SISTEMA",
          motivo: null,
          carga_combustible_id: 77,
          estado_sistema: "PENDIENTE",
          vale_gasolinera: null,
          fecha_gasolinera: null,
          placa_gasolinera: null,
          piloto_gasolinera: null,
          producto_gasolinera: null,
          galones_gasolinera: null,
          precio_gasolinera: null,
          monto_gasolinera: null,
          vale_sistema: "A-123",
          fecha_sistema: "2026-09-02",
          placa_sistema: "C-111ABC",
          piloto_sistema: "Piloto",
          producto_sistema: "diesel",
          galones_sistema: 12.5,
          precio_sistema: 40,
          monto_sistema: 500,
          diferencias: null,
        },
      ] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);
    const fila = detalle!.filas[0];

    expect(fila.gasolinera).toBeNull();
    expect(fila.sistema).not.toBeNull();
    expect(fila.sistema?.numeroVale).toBe("A-123");
  });

  it("DESCARTADA: sin snapshot de gasolinera ni de sistema, conserva filaExcel + motivo", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 503,
          fila_excel: 9,
          estado: "DESCARTADA",
          motivo: "Vale sin número",
          carga_combustible_id: null,
          estado_sistema: null,
          vale_gasolinera: null,
          fecha_gasolinera: null,
          placa_gasolinera: null,
          piloto_gasolinera: null,
          producto_gasolinera: null,
          galones_gasolinera: null,
          precio_gasolinera: null,
          monto_gasolinera: null,
          vale_sistema: null,
          fecha_sistema: null,
          placa_sistema: null,
          piloto_sistema: null,
          producto_sistema: null,
          galones_sistema: null,
          precio_sistema: null,
          monto_sistema: null,
          diferencias: null,
        },
      ] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);
    const fila = detalle!.filas[0];

    expect(fila.estado).toBe("DESCARTADA");
    expect(fila.gasolinera).toBeNull();
    expect(fila.sistema).toBeNull();
    expect(fila.filaExcel).toBe(9);
    expect(fila.motivo).toBe("Vale sin número");
  });

  it("diferencias: JSON válido se parsea a un arreglo de DiferenciaCampo", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          ...FILA_COINCIDE,
          estado: "DIFERENCIA",
          diferencias: JSON.stringify([
            { campo: "monto", sistema: "Q500.00", gasolinera: "Q510.00" },
          ]),
        },
      ] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);

    expect(detalle?.filas[0].diferencias).toEqual([
      { campo: "monto", sistema: "Q500.00", gasolinera: "Q510.00" },
    ]);
  });

  it("diferencias NULL => []", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([{ ...FILA_COINCIDE, diferencias: null }] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);

    expect(detalle?.filas[0].diferencias).toEqual([]);
  });

  it("diferencias con JSON inválido (dato histórico corrupto) no rompe el endpoint: devuelve []", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        { ...FILA_COINCIDE, diferencias: "{esto no es json válido" },
      ] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);

    expect(detalle?.filas[0].diferencias).toEqual([]);
  });

  it("diferencias con JSON válido pero de forma inesperada (no arreglo de objetos con los 3 campos) se descarta de forma defensiva", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-04 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        { ...FILA_COINCIDE, diferencias: JSON.stringify({ no: "es un arreglo" }) },
      ] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);

    expect(detalle?.filas[0].diferencias).toEqual([]);
  });

  it("período del detalle se deriva de las fechas snapshot de las filas, no de creado_at", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: 5,
          nombre_original: "reporte.xlsx",
          hoja: "2026",
          subido_por: "ops",
          creado_at: "2026-09-20 10:00:00",
        },
      ] as never)
      .mockResolvedValueOnce([
        { ...FILA_COINCIDE, fecha_gasolinera: "2026-09-01", fecha_sistema: "2026-09-01" },
        { ...FILA_COINCIDE, id: 504, fecha_gasolinera: "2026-09-10", fecha_sistema: "2026-09-10" },
      ] as never);

    const detalle = await obtenerConciliacionCombustible(20, 5);

    expect(detalle?.periodoDesde).toBe("2026-09-01");
    expect(detalle?.periodoHasta).toBe("2026-09-10");
  });
});

describe("obtenerArchivoConciliacionCombustible", () => {
  it("rechaza empresaId/conciliacionId inválidos sin consultar", async () => {
    await expect(
      obtenerArchivoConciliacionCombustible(0, 1),
    ).rejects.toThrow("empresaId inválido.");
    await expect(
      obtenerArchivoConciliacionCombustible(20, 0),
    ).rejects.toThrow("conciliacionId inválido.");
    expect(query).not.toHaveBeenCalled();
  });

  it("devuelve la ruta relativa solo cuando el registro pertenece a la empresa", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      {
        ruta_relativa: "empresas/20/flota/conciliacion_combustible_x.xlsx",
        nombre_original: "reporte.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ] as never);

    const archivo = await obtenerArchivoConciliacionCombustible(20, 5);

    expect(archivo).toEqual({
      rutaRelativa: "empresas/20/flota/conciliacion_combustible_x.xlsx",
      nombreOriginal: "reporte.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("WHERE id = ? AND empresa_id = ?");
    expect(params).toEqual([5, 20]);
  });

  it("conciliación de otra empresa (o inexistente) => null", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);

    const archivo = await obtenerArchivoConciliacionCombustible(999, 5);

    expect(archivo).toBeNull();
  });
});
