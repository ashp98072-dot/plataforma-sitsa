import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));

import { query } from "@/lib/db";
import {
  calcularDiasRuta,
  calcularKmRecorridos,
  calcularKpisReporte,
  contarReporteViajes,
  derivarEstadoCobro,
  derivarEstadoFacturacion,
  filtrosReporteDesdeUrl,
  LIMITE_EXPORTACION_MAXIMO,
  LIMITE_EXPORTACION_SIN_RANGO,
  LIMITE_PAGINA_DEFECTO,
  obtenerKpisReporte,
  obtenerReporteViajes,
  obtenerReporteViajesParaExportar,
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
    estadoFacturacion: "No aplica", facturaId: null, numeroFactura: null, estadoAdminFactura: null,
    estadoFinancieroFactura: null, montoFacturadoViaje: null, montoBorradorViaje: null,
    totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
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

  it("[HALLAZGO 3] sin paginación explícita usa LIMIT/OFFSET por defecto (no LIMIT 2000 fijo)", async () => {
    await obtenerReporteViajes(7, {});
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(sql).not.toContain("LIMIT 2000");
    expect(params?.slice(-2)).toEqual([LIMITE_PAGINA_DEFECTO, 0]);
  });

  it("[HALLAZGO 3 · 1] listado paginado: respeta limit/offset explícitos", async () => {
    await obtenerReporteViajes(7, {}, { limit: 50, offset: 100 });
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params?.slice(-2)).toEqual([50, 100]);
  });
});

describe("[HALLAZGO 3] contarReporteViajes — mismo criterio de filtros que el listado", () => {
  afterEach(() => vi.restoreAllMocks());

  it("[2] totalReal puede ser mayor que el tamaño de una página — es un COUNT(*) independiente", async () => {
    vi.mocked(query).mockResolvedValue([{ total: 350 }] as unknown as Awaited<ReturnType<typeof query>>);
    const total = await contarReporteViajes(7, { estado: "Cerrado" });
    expect(total).toBe(350);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("COUNT(*) AS total");
    expect(sql).toContain("p.estado = ?");
    expect(params).toContain("Cerrado");
  });
});

describe("[HALLAZGO 3 · 3] obtenerKpisReporte — agregación SQL sobre TODO el filtro, no una página", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calcula KPI vía SUM/COUNT en una sola consulta, con las mismas condiciones que el listado", async () => {
    vi.mocked(query).mockResolvedValue([{
      total_viajes: 500, cerrados: 300, pendientes_cierre: 20, en_ruta: 50, cancelados: 10,
      total_evidencias: 900, total_km_recorridos: 123456,
      valor_programado: 500000, valor_cerrado: 300000, viajes_con_tarifa: 480,
    }] as unknown as Awaited<ReturnType<typeof query>>);
    const kpi = await obtenerKpisReporte(7, { fechaDesde: "2026-08-01" });
    expect(kpi.totalViajes).toBe(500); // > que cualquier página de 200
    expect(kpi.cerrados).toBe(300);
    expect(kpi.pendientesCierre).toBe(20);
    expect(kpi.valorProgramado).toBe(500000);
    expect(kpi.valorCerrado).toBe(300000);
    expect(kpi.promedioIngresoPorViaje).toBeCloseTo(500000 / 480);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("SUM(p.estado = 'Cerrado')");
    expect(sql).toContain("p.fecha_plan >= ?");
    expect(params).toContain("2026-08-01");
    // Agregación sobre TODO el filtro: sin límite de página (el único LIMIT
    // que puede aparecer es el "LIMIT 1" interno del JOIN que elige un
    // único flota_viajes por plan — no un LIMIT/OFFSET de paginación).
    expect(sql).not.toContain("LIMIT ? OFFSET ?");
    expect(sql).not.toContain("LIMIT 2000");
  });

  it("viajes_con_tarifa = 0 no produce división por cero", async () => {
    vi.mocked(query).mockResolvedValue([{
      total_viajes: 0, cerrados: 0, pendientes_cierre: 0, en_ruta: 0, cancelados: 0,
      total_evidencias: 0, total_km_recorridos: 0, valor_programado: 0, valor_cerrado: 0, viajes_con_tarifa: 0,
    }] as unknown as Awaited<ReturnType<typeof query>>);
    const kpi = await obtenerKpisReporte(7, {});
    expect(kpi.promedioIngresoPorViaje).toBe(0);
  });
});

describe("[HALLAZGO 3] obtenerReporteViajesParaExportar — exporta TODO el filtro, nunca trunca en silencio", () => {
  afterEach(() => vi.restoreAllMocks());

  it("[4] con un rango de fechas, trae TODAS las filas del filtro sin el límite de página (LIMIT 2000 ya no existe)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("COUNT(*) AS total")) return [{ total: 3000 }];
      return [];
    }) as typeof query);
    const r = await obtenerReporteViajesParaExportar(7, { fechaDesde: "2026-08-01", fechaHasta: "2026-08-31" });
    expect(r.ok).toBe(true);
    // La consulta de filas (no la de COUNT) debe pedir las 3000, no 200 ni 2000.
    const filasCall = vi.mocked(query).mock.calls.find((c) => !String(c[0]).includes("COUNT(*) AS total"));
    expect(filasCall?.[1]?.slice(-2)).toEqual([3000, 0]);
  });

  it('sin ningún filtro que acote (ni fecha ni "solo pendientes") y volumen alto → rechaza con mensaje claro, NUNCA trunca en silencio', async () => {
    vi.mocked(query).mockResolvedValue([{ total: LIMITE_EXPORTACION_SIN_RANGO + 1 }] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await obtenerReporteViajesParaExportar(7, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(LIMITE_EXPORTACION_SIN_RANGO + 1));
  });

  it("sin filtro pero volumen bajo → exporta igual (no rechaza innecesariamente)", async () => {
    vi.mocked(query).mockResolvedValue([{ total: 10 }] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await obtenerReporteViajesParaExportar(7, {});
    expect(r.ok).toBe(true);
  });

  it('con "soloPendientesCierre" (naturalmente acotado) no exige rango de fechas', async () => {
    vi.mocked(query).mockResolvedValue([{ total: 8 }] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await obtenerReporteViajesParaExportar(7, { soloPendientesCierre: true });
    expect(r.ok).toBe(true);
  });

  it("incluso CON filtro de fecha, si el total supera el máximo absoluto exportable → rechaza", async () => {
    vi.mocked(query).mockResolvedValue([{ total: LIMITE_EXPORTACION_MAXIMO + 1 }] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await obtenerReporteViajesParaExportar(7, { fechaDesde: "2020-01-01", fechaHasta: "2026-12-31" });
    expect(r.ok).toBe(false);
  });
});

describe("[HALLAZGO 3 · 5] filtros del listado, KPI y exportador siguen siendo equivalentes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("la MISMA condición de filtro (estado) aparece en obtenerReporteViajes, contarReporteViajes y obtenerKpisReporte", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await obtenerReporteViajes(7, { estado: "Cerrado" });
    const sqlListado = String(vi.mocked(query).mock.calls[0][0]);

    vi.mocked(query).mockClear();
    vi.mocked(query).mockResolvedValue([{ total: 0 }] as unknown as Awaited<ReturnType<typeof query>>);
    await contarReporteViajes(7, { estado: "Cerrado" });
    const sqlConteo = String(vi.mocked(query).mock.calls[0][0]);

    vi.mocked(query).mockClear();
    vi.mocked(query).mockResolvedValue([{
      total_viajes: 0, cerrados: 0, pendientes_cierre: 0, en_ruta: 0, cancelados: 0,
      total_evidencias: 0, total_km_recorridos: 0, valor_programado: 0, valor_cerrado: 0, viajes_con_tarifa: 0,
    }] as unknown as Awaited<ReturnType<typeof query>>);
    await obtenerKpisReporte(7, { estado: "Cerrado" });
    const sqlKpi = String(vi.mocked(query).mock.calls[0][0]);

    for (const sql of [sqlListado, sqlConteo, sqlKpi]) {
      expect(sql).toContain("p.estado = ?");
      expect(sql).toContain("p.empresa_id = ?");
    }
  });
});

/**
 * CORRECCIÓN PR #112 (último detalle 2): auxiliaresDePlanesReporte ya NO
 * atrapa su propio error genéricamente. tms_plan_auxiliares es parte del
 * esquema real de producción — si esa consulta falla (SQL, conexión,
 * timeout, columna, permisos), el reporte debe fallar explícitamente, no
 * devolver silenciosamente "Auxiliares: []" como si fuera un dato válido.
 */
describe("[último detalle] no silenciar errores de auxiliares", () => {
  afterEach(() => vi.restoreAllMocks());

  it("si la consulta de auxiliares falla, obtenerReporteViajes RECHAZA — nunca devuelve el plan con auxiliares=[] como si fuera válido", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("tms_plan_auxiliares")) throw new Error("ER_NO_SUCH_TABLE: tms_plan_auxiliares");
      if (sql.includes("FROM tms_planes_viaje p")) return [{ id: 1 }];
      return [];
    }) as typeof query);
    await expect(obtenerReporteViajes(7, {})).rejects.toThrow("ER_NO_SUCH_TABLE");
  });

  it("con la tabla disponible, sigue funcionando exactamente igual (sin regresión)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("tms_plan_auxiliares")) return [{ plan_id: 1, nombre: "Carlos Ruiz" }];
      if (sql.includes("FROM tms_planes_viaje p")) {
        return [{
          id: 1, codigo: "PLAN-1", fecha_plan: "2026-08-01", hora_carga: null, estado: "Programado",
          cerrado_por: null, cerrado_en: null, pendiente_cierre: 0, cliente_id: null, cliente: null,
          ruta_codigo: null, lugar_descarga_historico: null, referencia_cliente: null, tipo_traslado: null,
          regreso_estimado: null, tarifa_comercial: null, placa: null, unidad_tipo: null, unidad_capacidad: null,
          piloto_id: null, piloto: null, evidencias: 0, km_salida: null, km_llegada: null,
          hora_salida: null, hora_llegada: null,
        }];
      }
      return [];
    }) as typeof query);
    const [plan1] = await obtenerReporteViajes(7, {});
    expect(plan1.auxiliares).toEqual(["Carlos Ruiz"]);
  });
});

describe("FACT-1-TMS-REPORTES — derivarEstadoFacturacion (Fase B)", () => {
  it("1) Cerrado sin factura = Pendiente de facturación", () => {
    expect(derivarEstadoFacturacion("Cerrado", null)).toBe("Pendiente de facturación");
  });
  it("2) factura Borrador = En borrador de factura", () => {
    expect(derivarEstadoFacturacion("Cerrado", "Borrador")).toBe("En borrador de factura");
  });
  it("3) factura Emitida = Facturado", () => {
    expect(derivarEstadoFacturacion("Cerrado", "Emitida")).toBe("Facturado");
  });
  it("4) una relación inconsistente a 'Anulada' NUNCA se etiqueta Facturado — cae a Pendiente/No aplica según el estado del plan", () => {
    expect(derivarEstadoFacturacion("Cerrado", "Anulada")).toBe("Pendiente de facturación");
    expect(derivarEstadoFacturacion("Programado", "Anulada")).toBe("No aplica");
  });
  it("23) viaje NO Cerrado y sin factura = No aplica", () => {
    expect(derivarEstadoFacturacion("Programado", null)).toBe("No aplica");
    expect(derivarEstadoFacturacion("En ruta", null)).toBe("No aplica");
  });
});

describe("FACT-1-TMS-REPORTES — derivarEstadoCobro (Fase C)", () => {
  it("7) factura Emitida sin pagos = Sin pagos", () => {
    expect(derivarEstadoCobro("Emitida", 1000, 0)).toBe("Sin pagos");
  });
  it("8) pago parcial", () => {
    expect(derivarEstadoCobro("Emitida", 1000, 400)).toBe("Pago parcial");
  });
  it("9) pagado en su totalidad = Cobrado", () => {
    expect(derivarEstadoCobro("Emitida", 1000, 1000)).toBe("Cobrado");
  });
  it("solo tiene sentido para Emitida — Borrador/Anulada/sin factura devuelven null (la UI muestra '—')", () => {
    expect(derivarEstadoCobro("Borrador", 1000, 0)).toBeNull();
    expect(derivarEstadoCobro(null, null, null)).toBeNull();
  });
});

describe("FACT-1-TMS-REPORTES — obtenerReporteViajes: mapeo de campos financieros por fila", () => {
  afterEach(() => vi.restoreAllMocks());

  function filaConFacturacion(overrides: Record<string, unknown>) {
    return {
      id: 1, codigo: "PLAN-1", fecha_plan: "2026-08-01", hora_carga: null, estado: "Cerrado",
      cerrado_por: null, cerrado_en: null, pendiente_cierre: 0, cliente_id: null, cliente: null,
      ruta_codigo: null, lugar_descarga_historico: null, referencia_cliente: null, tipo_traslado: null,
      regreso_estimado: null, tarifa_comercial: 1000, placa: null, unidad_tipo: null, unidad_capacidad: null,
      piloto_id: null, piloto: null, evidencias: 0, km_salida: null, km_llegada: null,
      hora_salida: null, hora_llegada: null,
      factura_id: null, numero_factura: null, estado_admin_factura: null,
      total_factura: null, total_pagado_factura: null, monto_asignado_viaje: null,
      ...overrides,
    };
  }
  function mockFila(row: Record<string, unknown>) {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tms_planes_viaje p")) return [row];
      return [];
    }) as typeof query);
  }

  it("5) montoFacturadoViaje = monto_asignado cuando la factura está Emitida", async () => {
    mockFila(filaConFacturacion({
      factura_id: 10, numero_factura: "F-001", estado_admin_factura: "Emitida",
      total_factura: 1000, total_pagado_factura: 400, monto_asignado_viaje: 800,
    }));
    const [p] = await obtenerReporteViajes(7, {});
    expect(p.estadoFacturacion).toBe("Facturado");
    expect(p.montoFacturadoViaje).toBe(800);
    expect(p.montoBorradorViaje).toBeNull(); // nunca ambos a la vez
  });

  it("6) tarifa comercial puede diferir del monto facturado — ambos se conservan por separado", async () => {
    mockFila(filaConFacturacion({
      tarifa_comercial: 1000,
      factura_id: 10, estado_admin_factura: "Emitida", total_factura: 800,
      total_pagado_factura: 0, monto_asignado_viaje: 800,
    }));
    const [p] = await obtenerReporteViajes(7, {});
    expect(p.tarifaComercial).toBe(1000);
    expect(p.montoFacturadoViaje).toBe(800);
  });

  it("un Borrador usa montoBorradorViaje — NUNCA se llama 'facturado' a un Borrador", async () => {
    mockFila(filaConFacturacion({
      factura_id: 11, estado_admin_factura: "Borrador",
      total_factura: 500, total_pagado_factura: 0, monto_asignado_viaje: 500,
    }));
    const [p] = await obtenerReporteViajes(7, {});
    expect(p.estadoFacturacion).toBe("En borrador de factura");
    expect(p.montoBorradorViaje).toBe(500);
    expect(p.montoFacturadoViaje).toBeNull();
  });

  it("10) saldoFactura se deriva de totalFactura - totalPagadoFactura", async () => {
    mockFila(filaConFacturacion({
      factura_id: 10, estado_admin_factura: "Emitida",
      total_factura: 1000, total_pagado_factura: 400, monto_asignado_viaje: 1000,
    }));
    const [p] = await obtenerReporteViajes(7, {});
    expect(p.saldoFactura).toBe(600);
    expect(p.estadoFinancieroFactura).toBe("Pago parcial");
  });

  it("24) nunca existe un campo montoCobradoViaje prorrateado — totalPagadoFactura/saldoFactura son SIEMPRE de la factura completa", async () => {
    mockFila(filaConFacturacion({
      factura_id: 10, estado_admin_factura: "Emitida",
      total_factura: 3000, total_pagado_factura: 1200, monto_asignado_viaje: 1000,
    }));
    const [p] = await obtenerReporteViajes(7, {});
    expect(p).not.toHaveProperty("montoCobradoViaje");
    // 1200 es el pago de TODA la factura (3 viajes posibles), no del viaje individual (1000 asignado):
    expect(p.totalPagadoFactura).toBe(1200);
    expect(p.montoFacturadoViaje).toBe(1000);
  });
});

describe("FACT-1-TMS-REPORTES — Fase F: filtro por estadoFacturacion/estadoCobro (JOIN_FACTURACION)", () => {
  beforeEach(() => vi.mocked(query).mockResolvedValue([]));
  afterEach(() => vi.restoreAllMocks());

  it("16) 'Pendiente de facturación' exige Cerrado + f.id IS NULL", async () => {
    await obtenerReporteViajes(7, { estadoFacturacion: "Pendiente de facturación" });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = 'Cerrado'");
    expect(sql).toContain("f.id IS NULL");
  });

  it("16) 'En borrador de factura' exige f.estado_admin = 'Borrador'", async () => {
    await obtenerReporteViajes(7, { estadoFacturacion: "En borrador de factura" });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("f.estado_admin = 'Borrador'");
  });

  it("16) 'Facturado' exige f.estado_admin = 'Emitida'", async () => {
    await obtenerReporteViajes(7, { estadoFacturacion: "Facturado" });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("f.estado_admin = 'Emitida'");
  });

  it("16) 'No aplica' exige estado <> Cerrado y sin factura", async () => {
    await obtenerReporteViajes(7, { estadoFacturacion: "No aplica" });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado <> 'Cerrado'");
    expect(sql).toContain("f.id IS NULL");
  });

  it("16) estadoCobro filtra sobre Emitida + el saldo derivado (nunca se mezcla con soloPendientesCierre)", async () => {
    await obtenerReporteViajes(7, { estadoCobro: "Pago parcial", soloPendientesCierre: true });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("f.estado_admin = 'Emitida'");
    expect(sql).toContain("COALESCE(pg.total_pagado, 0) > 0 AND COALESCE(pg.total_pagado, 0) < f.monto_total");
    expect(sql).toContain("p.estado NOT IN ('Cerrado', 'Cancelado')"); // soloPendientesCierre sigue intacto, criterio distinto
  });

  it("el mismo filtro estadoFacturacion está disponible también en contarReporteViajes (paginación/COUNT correcto)", async () => {
    vi.mocked(query).mockResolvedValue([{ total: 0 }] as unknown as Awaited<ReturnType<typeof query>>);
    await contarReporteViajes(7, { estadoFacturacion: "Facturado" });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("f.estado_admin = 'Emitida'");
  });

  it("17) la paginación (LIMIT ? OFFSET ?) sigue intacta tras agregar JOIN_FACTURACION", async () => {
    await obtenerReporteViajes(7, {}, { limit: 25, offset: 50 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(params?.slice(-2)).toEqual([25, 50]);
  });
});

describe("FACT-1-TMS-REPORTES — Fase E/18: obtenerKpisReporte financiero, universo completo (no una página)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("18) usa DOS consultas independientes (por-viaje seguro + por-factura, nunca un solo JOIN gigante con SUM directo)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      // OJO: la subconsulta de la consulta por-factura TAMBIÉN contiene
      // "FROM tms_planes_viaje p" (reutiliza el mismo `where`) — hay que
      // revisar primero la condición MÁS específica ("FROM fact_facturas
      // fx", que solo aparece en la consulta exterior por-factura).
      if (sql.includes("FROM fact_facturas fx")) {
        return [{ pendiente_cobro: 600, cobrado: 400 }];
      }
      if (sql.includes("FROM tms_planes_viaje p")) {
        return [{
          total_viajes: 3, cerrados: 3, pendientes_cierre: 0, en_ruta: 0, cancelados: 0,
          total_evidencias: 0, total_km_recorridos: 0, valor_programado: 3000, valor_cerrado: 3000,
          viajes_con_tarifa: 3, viajes_pend_facturacion: 0, valor_pend_facturacion: 0,
          viajes_facturados: 3, valor_facturado: 3000, facturas_pend_cobro: 1,
        }];
      }
      return [];
    }) as typeof query);
    const kpi = await obtenerKpisReporte(7, {});
    expect(kpi.viajesFacturados).toBe(3);
    expect(kpi.valorFacturado).toBe(3000); // suma monto_asignado por viaje — seguro
    expect(kpi.valorPendienteCobro).toBe(600); // viene de la consulta POR FACTURA, no multiplicado por viaje
    expect(kpi.cobrado).toBe(400);
    expect(vi.mocked(query).mock.calls.length).toBe(2);
    // La consulta por-factura filtra por facturas TOCADAS por el filtro actual, nunca todo el universo de la empresa sin relación al filtro.
    const [sqlFactura] = vi.mocked(query).mock.calls[1];
    expect(sqlFactura).toContain("fx.id IN");
  });

  it("no hay LIMIT/OFFSET de paginación en ninguna de las dos consultas — siempre TODO el filtro", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await obtenerKpisReporte(7, {});
    for (const call of vi.mocked(query).mock.calls) {
      expect(String(call[0])).not.toContain("LIMIT ? OFFSET ?");
    }
  });
});

describe("FACT-1-TMS-REPORTES — Fase E: calcularKpisReporte (en memoria) evita doble conteo en facturas multiviaje", () => {
  function filaFacturada(overrides: Partial<PlanReporte>): PlanReporte {
    return {
      id: 1, codigo: "PLAN-1", fechaPlan: "2026-08-01", horaCarga: null, estado: "Cerrado",
      pendienteCierre: false, cerradoPor: null, cerradoEn: null, clienteId: null, cliente: null,
      rutaCodigo: null, lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null,
      regresoEstimado: null, tarifaComercial: null, placa: null, unidadTipo: null, unidadCapacidad: null,
      pilotoId: null, piloto: null, auxiliares: [], paradas: [], evidencias: 0,
      horaSalida: null, horaLlegada: null, kmSalida: null, kmLlegada: null, kmRecorridos: null, diasRuta: null,
      estadoFacturacion: "Facturado", facturaId: 1, numeroFactura: "F-001", estadoAdminFactura: "Emitida",
      estadoFinancieroFactura: "Pago parcial", montoFacturadoViaje: 500, montoBorradorViaje: null,
      totalFactura: 1000, totalPagadoFactura: 400, saldoFactura: 600,
      ...overrides,
    };
  }

  it("11) valorFacturado suma monto_asignado POR VIAJE — nunca duplica el total de la factura", () => {
    const planes = [
      filaFacturada({ id: 1, montoFacturadoViaje: 400 }),
      filaFacturada({ id: 2, montoFacturadoViaje: 600 }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.valorFacturado).toBe(1000); // 400 + 600, cada uno su propio monto — no 2000 (2x el total de la factura)
  });

  it("12) cobrado NO se duplica cuando 2 viajes comparten la MISMA factura", () => {
    const planes = [
      filaFacturada({ id: 1, facturaId: 7, totalFactura: 1000, totalPagadoFactura: 1000 }),
      filaFacturada({ id: 2, facturaId: 7, totalFactura: 1000, totalPagadoFactura: 1000 }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.cobrado).toBe(1000); // UNA sola vez, no 2000
  });

  it("13) valorPendienteCobro NO se duplica cuando 2 viajes comparten la MISMA factura", () => {
    const planes = [
      filaFacturada({ id: 1, facturaId: 7, totalFactura: 1000, totalPagadoFactura: 400 }),
      filaFacturada({ id: 2, facturaId: 7, totalFactura: 1000, totalPagadoFactura: 400 }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.valorPendienteCobro).toBe(600); // (1000-400) UNA sola vez, no 1200
    expect(kpi.facturasPendientesCobro).toBe(1); // 1 factura, no 2
  });

  it("2 facturas distintas SÍ se suman ambas (la deduplicación es por facturaId, no anula facturas genuinamente distintas)", () => {
    const planes = [
      filaFacturada({ id: 1, facturaId: 7, totalFactura: 1000, totalPagadoFactura: 0 }),
      filaFacturada({ id: 2, facturaId: 8, totalFactura: 500, totalPagadoFactura: 0 }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.valorPendienteCobro).toBe(1500);
    expect(kpi.facturasPendientesCobro).toBe(2);
  });

  it("21) un viaje en Borrador NO suma a valorFacturado (solo Emitida cuenta como facturado)", () => {
    const planes = [
      filaFacturada({
        id: 1, estadoFacturacion: "En borrador de factura", estadoAdminFactura: "Borrador",
        montoFacturadoViaje: null, montoBorradorViaje: 500,
      }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.valorFacturado).toBe(0);
    expect(kpi.viajesFacturados).toBe(0);
  });

  it("22) un viaje cuya única relación fue a una factura Anulada (defensivo: estadoAdminFactura null) no suma a valorFacturado", () => {
    const planes = [
      filaFacturada({
        id: 1, estadoFacturacion: "Pendiente de facturación", facturaId: null, estadoAdminFactura: null,
        montoFacturadoViaje: null, montoBorradorViaje: null, totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
      }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.valorFacturado).toBe(0);
    expect(kpi.cobrado).toBe(0);
    expect(kpi.valorPendienteCobro).toBe(0);
  });

  it("15) viajesPendientesFacturacion/valorPendienteFacturacion cuentan solo los realmente pendientes", () => {
    const planes = [
      filaFacturada({ id: 1, estadoFacturacion: "Pendiente de facturación", facturaId: null, estadoAdminFactura: null, tarifaComercial: 700, montoFacturadoViaje: null }),
      filaFacturada({ id: 2, estadoFacturacion: "Facturado" }),
    ];
    const kpi = calcularKpisReporte(planes);
    expect(kpi.viajesPendientesFacturacion).toBe(1);
    expect(kpi.valorPendienteFacturacion).toBe(700);
  });
});
