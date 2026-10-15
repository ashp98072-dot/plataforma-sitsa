import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/rrhh/export-files", () => ({ tablaAExcel: vi.fn(async () => Buffer.from("xlsx")), tablaAPdf: vi.fn(async () => Buffer.from("pdf")) }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionExportar: vi.fn() }));

import { query } from "@/lib/db";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import { requireTenantProgramacionExportar } from "@/lib/tenant";
import { obtenerReporteViajes } from "./reportes-viajes";
import { GET as exportar } from "../../app/api/empresas/[slug]/tms/reportes/viajes/export/route";

/**
 * TMS Fase 5 — Reporte de viajes / Excel: cargos adicionales y subtotal comercial por viaje, calculados por LOTE (una sola
 * consulta agrupada por plan), sin costos internos y sin IVA.
 */
const fila = (over: Record<string, unknown> = {}) => ({
  id: 1, codigo: "PLAN-1", fecha_plan: "2026-10-10", estado: "Cerrado", pendiente_cierre: 0, evidencias: 0, tarifa_comercial: "1000.00",
  tc_vehiculo_id: null, tc_placa_historica: null, tc_externo_placa: null, tc_placa_actual: null, ...over,
});

let filasBD: Record<string, unknown>[];
let cargosBD: { plan_id: number; cantidad: number; total: string; moneda: string | null }[];
const sqls = () => vi.mocked(query).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.resetAllMocks();
  filasBD = [];
  cargosBD = [];
  vi.mocked(query).mockImplementation((async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM tms_planes_viaje p") && s.includes("LEFT JOIN tms_clientes")) return filasBD;
    if (s.includes("FROM tms_viaje_cargos_adicionales")) return cargosBD;
    if (s.includes("COUNT(")) return [{ total: filasBD.length }];
    return [];
  }) as never);
});

describe("Reporte de viajes · Fase 5 · cargos y subtotal comercial por lote", () => {
  it("cada fila trae cargos vigentes y subtotal = tarifa + cargos (sin tarifa ⇒ null)", async () => {
    filasBD = [fila({ id: 1, tarifa_comercial: "1000.00" }), fila({ id: 2, tarifa_comercial: "500.00" }), fila({ id: 3, tarifa_comercial: null })];
    cargosBD = [{ plan_id: 1, cantidad: 2, total: "150.50", moneda: "GTQ" }, { plan_id: 3, cantidad: 1, total: "20.00", moneda: "GTQ" }];
    const r = await obtenerReporteViajes(7, {});
    expect(r.map((p) => [p.id, p.cargosAdicionales, p.subtotalComercial])).toEqual([
      [1, { cantidad: 2, total: "150.50" }, "1150.50"],
      [2, { cantidad: 0, total: "0.00" }, "500.00"],
      [3, { cantidad: 1, total: "20.00" }, null],
    ]);
  });

  it("anti N+1: UNA sola consulta de cargos para todos los viajes, acotada por empresa", async () => {
    filasBD = Array.from({ length: 25 }, (_, i) => fila({ id: i + 1 }));
    await obtenerReporteViajes(7, {});
    const deCargos = vi.mocked(query).mock.calls.filter((c) => String(c[0]).includes("FROM tms_viaje_cargos_adicionales"));
    expect(deCargos).toHaveLength(1);
    expect(String(deCargos[0][0])).toContain("c.empresa_id = ?");
    expect(String(deCargos[0][0])).toContain("c.activo = 1");
    const params = deCargos[0][1] as unknown[];
    expect(params[0]).toBe(7);
    expect(params.slice(1)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("el reporte NO consulta gastos ni fondos (costos internos fuera del reporte comercial)", async () => {
    filasBD = [fila()];
    await obtenerReporteViajes(7, {});
    expect(sqls().some((s) => /tms_gastos_operativos|tms_solicitud_fondo|tms_solicitudes_fondo/.test(s))).toBe(false);
  });

  it("el Excel agrega al FINAL «Cargos adicionales», «Subtotal comercial» y «Estado liquidación»", async () => {
    vi.mocked(requireTenantProgramacionExportar).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" } } as never);
    filasBD = [fila({ id: 1 }), fila({ id: 2, tarifa_comercial: null, estado: "Programado" })];
    cargosBD = [{ plan_id: 1, cantidad: 1, total: "150.00", moneda: "GTQ" }];
    const r = await exportar(new Request("http://x/api/x/export?formato=xlsx&fechaDesde=2026-10-01&fechaHasta=2026-10-31"), { params: Promise.resolve({ slug: "kt" }) });
    expect(r.status).toBe(200);
    const arg = vi.mocked(tablaAExcel).mock.calls[0][0] as { headers: string[]; rows: string[][] };
    expect(arg.headers.slice(-3)).toEqual(["Cargos adicionales", "Subtotal comercial (antes de impuestos)", "Estado liquidación"]);
    expect(arg.rows.every((f) => f.length === arg.headers.length)).toBe(true);
    const cola = arg.rows.map((f) => f.slice(-3));
    expect(cola[0].slice(0, 2)).toEqual(["150.00", "1150.00"]);
    expect(cola[1].slice(0, 2)).toEqual(["0.00", "Pendiente"]);
    // Ninguna columna de costos internos ni de IVA en la exportación comercial.
    expect(arg.headers.join("|")).not.toMatch(/gasto|costo|margen|iva/i);
  });
});

describe("Planes/Viajes · Fase 5 · pantalla (cableado)", () => {
  const cliente = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");
  const tarjeta = readFileSync("src/components/tms/resumen-liquidacion-viaje.tsx", "utf8");

  it("la tabla tiene «Cargos» y «Subtotal com.» y el detalle integra el resumen sin navegación nueva", () => {
    expect(cliente).toMatch(/"Tarifa", "Cargos", "Subtotal com\.", "Estado"/);
    expect(cliente).toMatch(/<ResumenLiquidacionViajeCard\s+slug=\{slug\}\s+planId=\{p\.id\}/);
    expect(cliente).toContain('from "@/components/tms/resumen-liquidacion-viaje"');
  });

  it("la tarjeta es solo lectura: un único GET, sin POST/PUT/PATCH/DELETE ni botones de acción", () => {
    expect(tarjeta.match(/fetch\(/g)).toHaveLength(1);
    expect(tarjeta).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/);
    expect(tarjeta).not.toMatch(/<button/);
  });

  it("textos de negocio: sujeto a cambios (EN_AJUSTE), finalizado (LIQUIDADO), subtotal antes de impuestos y margen no disponible", () => {
    expect(tarjeta).toContain("Sujeto a cambios");
    expect(tarjeta).toContain("finalizado");
    expect(tarjeta).toContain("ETIQUETA_SUBTOTAL_COMERCIAL");
    expect(tarjeta).toContain("Margen informativo no disponible");
    expect(tarjeta).not.toMatch(/total factura|Total factura/);
  });

  it("los costos internos viven en un bloque separado y solo se pintan con costosAutorizado", () => {
    expect(tarjeta).toContain('data-bloque="comercial"');
    expect(tarjeta).toContain('data-bloque="costos-internos"');
    expect(tarjeta).toMatch(/!resumen\.costosAutorizado \|\| !costos/);
  });
});
