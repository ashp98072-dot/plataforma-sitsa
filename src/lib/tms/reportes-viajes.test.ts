import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));

import { query } from "@/lib/db";
import {
  calcularDiasRuta,
  calcularKmRecorridos,
  calcularKpisReporte,
  filtrosReporteDesdeUrl,
  obtenerReporteViajes,
  type PlanReporte,
} from "./reportes-viajes";

function plan(overrides: Partial<PlanReporte>): PlanReporte {
  return {
    id: 1, codigo: "PLAN-1", fechaPlan: "2026-08-01", horaCarga: null, estado: "Programado",
    pendienteCierre: false, cerradoPor: null, cerradoEn: null, clienteId: null, cliente: null,
    rutaCodigo: null, lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null,
    regresoEstimado: null, tarifaComercial: null, placa: null, unidadTipo: null, unidadCapacidad: null,
    pilotoId: null, piloto: null, auxiliares: [], paradas: [], evidencias: 0,
    horaSalida: null, horaLlegada: null, kmSalida: null, kmLlegada: null, kmRecorridos: null, diasRuta: null,
    ...overrides,
  };
}

describe("calcularKmRecorridos", () => {
  it("4) resta km_llegada - km_salida cuando ambos existen", () => {
    expect(calcularKmRecorridos(1000, 1350)).toBe(350);
  });
  it("null si falta km_salida o km_llegada", () => {
    expect(calcularKmRecorridos(null, 1350)).toBeNull();
    expect(calcularKmRecorridos(1000, null)).toBeNull();
  });
  it("null (nunca negativo) si los datos son incoherentes", () => {
    expect(calcularKmRecorridos(1500, 1000)).toBeNull();
  });
});

describe("calcularDiasRuta", () => {
  it("mismo día calendario cuenta como 1 día", () => {
    expect(calcularDiasRuta("2026-08-27T07:00", "2026-08-27T18:00")).toBe(1);
  });
  it("días calendario de diferencia, +1 inclusivo", () => {
    expect(calcularDiasRuta("2026-08-27T07:00", "2026-08-29T10:00")).toBe(3);
  });
  it("null si falta salida o llegada real (no se inventa)", () => {
    expect(calcularDiasRuta(null, "2026-08-27T18:00")).toBeNull();
    expect(calcularDiasRuta("2026-08-27T07:00", null)).toBeNull();
  });
});

describe("calcularKpisReporte", () => {
  it("5/6/7) totales, cerrados y pendientes de cierre", () => {
    const kpi = calcularKpisReporte([
      plan({ id: 1, estado: "Cerrado" }),
      plan({ id: 2, estado: "En ruta", pendienteCierre: true }),
      plan({ id: 3, estado: "Programado" }),
      plan({ id: 4, estado: "Cancelado" }),
    ]);
    expect(kpi.totalViajes).toBe(4);
    expect(kpi.cerrados).toBe(1);
    expect(kpi.pendientesCierre).toBe(1);
    expect(kpi.cancelados).toBe(1);
  });

  it("8) suma tarifa_comercial en valorProgramado y valorCerrado", () => {
    const kpi = calcularKpisReporte([
      plan({ id: 1, estado: "Cerrado", tarifaComercial: 1000 }),
      plan({ id: 2, estado: "En ruta", tarifaComercial: 500 }),
    ]);
    expect(kpi.valorProgramado).toBe(1500);
    expect(kpi.valorCerrado).toBe(1000);
  });

  it("9) tarifa null NO cuenta como Q0 — se excluye del total y del denominador del promedio", () => {
    const kpi = calcularKpisReporte([
      plan({ id: 1, estado: "Programado", tarifaComercial: 1000 }),
      plan({ id: 2, estado: "Programado", tarifaComercial: null }),
    ]);
    expect(kpi.valorProgramado).toBe(1000);
    expect(kpi.promedioIngresoPorViaje).toBe(1000); // /1, no /2
  });

  it('10) Cancelado queda FUERA de "Valor programado" aunque tenga tarifa capturada', () => {
    const kpi = calcularKpisReporte([
      plan({ id: 1, estado: "Cancelado", tarifaComercial: 5000 }),
      plan({ id: 2, estado: "Programado", tarifaComercial: 200 }),
    ]);
    expect(kpi.valorProgramado).toBe(200);
  });

  it("15) evidencias NUNCA condicionan pendienteCierre/KPI — un plan sin evidencia igual cuenta si pendienteCierre=true", () => {
    const kpi = calcularKpisReporte([
      plan({ id: 1, estado: "En ruta", pendienteCierre: true, evidencias: 0 }),
    ]);
    expect(kpi.pendientesCierre).toBe(1);
    expect(kpi.totalEvidencias).toBe(0);
  });

  it("suma km recorridos, ignorando planes sin dato (no los cuenta como 0 negativo)", () => {
    const kpi = calcularKpisReporte([
      plan({ id: 1, kmRecorridos: 100 }),
      plan({ id: 2, kmRecorridos: null }),
      plan({ id: 3, kmRecorridos: 50 }),
    ]);
    expect(kpi.totalKmRecorridos).toBe(150);
  });
});

describe("filtrosReporteDesdeUrl", () => {
  it("1) parsea fechaDesde/fechaHasta válidas", () => {
    const f = filtrosReporteDesdeUrl(new URL("http://x?fechaDesde=2026-08-01&fechaHasta=2026-08-31"));
    expect(f.fechaDesde).toBe("2026-08-01");
    expect(f.fechaHasta).toBe("2026-08-31");
  });
  it("ignora fechas con formato inválido", () => {
    const f = filtrosReporteDesdeUrl(new URL("http://x?fechaDesde=27/08/2026"));
    expect(f.fechaDesde).toBeUndefined();
  });
  it("2) soloPendientesCierre se activa con '1'", () => {
    expect(filtrosReporteDesdeUrl(new URL("http://x?soloPendientesCierre=1")).soloPendientesCierre).toBe(true);
    expect(filtrosReporteDesdeUrl(new URL("http://x")).soloPendientesCierre).toBe(false);
  });
  it("3) estado se pasa tal cual", () => {
    expect(filtrosReporteDesdeUrl(new URL("http://x?estado=Cerrado")).estado).toBe("Cerrado");
  });
  it("14) el mismo parseo sirve tanto al listado como al exportador (una sola función, sin duplicar)", () => {
    const url = new URL("http://x?clienteId=5&pilotoId=9&unidadId=3");
    const f = filtrosReporteDesdeUrl(url);
    expect(f).toEqual({
      fechaDesde: undefined, fechaHasta: undefined, clienteId: 5, pilotoId: 9, unidadId: 3,
      estado: undefined, soloPendientesCierre: false, soloCerrados: false, soloSinCerrar: false,
    });
  });
});

describe("obtenerReporteViajes — construcción de filtros SQL", () => {
  beforeEach(() => {
    vi.mocked(query).mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("1) aplica rango de fechas en la consulta principal", async () => {
    await obtenerReporteViajes(7, { fechaDesde: "2026-08-01", fechaHasta: "2026-08-31" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.fecha_plan >= ?");
    expect(sql).toContain("p.fecha_plan <= ?");
    expect(params).toContain("2026-08-01");
    expect(params).toContain("2026-08-31");
  });

  it("2) soloPendientesCierre IGNORA el rango de fechas (mismo criterio ya establecido: un pendiente antiguo no debe desaparecer)", async () => {
    await obtenerReporteViajes(7, { fechaDesde: "2026-08-01", fechaHasta: "2026-08-31", soloPendientesCierre: true });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).not.toContain("p.fecha_plan >= ?");
    expect(params).not.toContain("2026-08-01");
  });

  it("3) filtra por estado exacto cuando se pasa", async () => {
    await obtenerReporteViajes(7, { estado: "Cerrado" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(params).toContain("Cerrado");
  });

  it("13) pendiente_cierre se calcula EXISTS(flota_viajes...estado='cerrado') — mismo criterio que tms/planes/route.ts, nunca un valor de estado nuevo", async () => {
    await obtenerReporteViajes(7, {});
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado NOT IN ('Cerrado', 'Cancelado')");
    expect(sql).toContain("fv.estado = 'cerrado'");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i); // 12) esta consulta es de solo lectura — nunca cierra nada por su cuenta
  });

  it("siempre filtra por empresa_id (aislamiento multiempresa)", async () => {
    await obtenerReporteViajes(7, {});
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.empresa_id = ?");
    expect(params?.[0]).toBe(7);
  });
});
