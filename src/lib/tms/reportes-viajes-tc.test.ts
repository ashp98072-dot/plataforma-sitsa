import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/rrhh/export-files", () => ({ tablaAExcel: vi.fn(async () => Buffer.from("xlsx")), tablaAPdf: vi.fn(async () => Buffer.from("pdf")) }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/reporte-viajes-historial-pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tms/reporte-viajes-historial-pdf")>()),
  reporteViajesHistorialPdf: vi.fn(async () => Buffer.from("pdf")),
}));

import { query } from "@/lib/db";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { calcularKpisReporte, obtenerReporteViajes, resolverTcReporte, type PlanReporte } from "./reportes-viajes";
import { filaOperativa, HEADERS_OPERATIVOS, reporteViajesHistorialPdf } from "./reporte-viajes-historial-pdf";
import { etiquetaOrigenTc } from "./tc-viaje-shared";
import { GET as exportar } from "../../app/api/empresas/[slug]/tms/reportes/viajes/export/route";

/**
 * TMS-TC-PLANES-REPORTES-1 — TC / caja / remolque en Planes, Reportes y exportaciones. Dato DESCRIPTIVO:
 * no interviene en KPIs. El snapshot histórico (tc_placa_historica) manda sobre la placa actual del catálogo.
 */
const fila = (over: Record<string, unknown> = {}) => ({
  id: 1, codigo: "PLAN-1", fecha_plan: "2026-09-21", estado: "Programado", pendiente_cierre: 0, evidencias: 0,
  tc_vehiculo_id: null, tc_placa_historica: null, tc_externo_placa: null, tc_placa_actual: null, ...over,
});

let filasBD: Record<string, unknown>[];
beforeEach(() => {
  vi.resetAllMocks();
  filasBD = [];
  vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("LEFT JOIN tms_clientes") ? filasBD : [])) as never);
});
const primero = async () => (await obtenerReporteViajes(7, {}))[0];

describe("resolverTcReporte (regla única de resolución)", () => {
  it("snapshot histórico presente => INTERNO con esa placa (aunque el catálogo tenga otra hoy)", () => {
    expect(resolverTcReporte({ tc_vehiculo_id: 5, tc_placa_historica: "TC-VIEJA", tc_placa_actual: "TC-NUEVA" })).toEqual({ tcPlaca: "TC-VIEJA", tcOrigen: "INTERNO", tcVehiculoId: 5 });
  });
  it("sin snapshot y con texto externo => EXTERNO", () => {
    expect(resolverTcReporte({ tc_externo_placa: "TX-900" })).toEqual({ tcPlaca: "TX-900", tcOrigen: "EXTERNO", tcVehiculoId: null });
  });
  it("sin TC => null / null", () => {
    expect(resolverTcReporte({})).toEqual({ tcPlaca: null, tcOrigen: null, tcVehiculoId: null });
    expect(resolverTcReporte({ tc_placa_historica: "  ", tc_externo_placa: "" })).toEqual({ tcPlaca: null, tcOrigen: null, tcVehiculoId: null });
  });
  it("fallback visual: sin snapshot pero con tc_vehiculo_id vivo => placa ACTUAL (INTERNO); sin vehículo vivo no se inventa nada", () => {
    expect(resolverTcReporte({ tc_vehiculo_id: 5, tc_placa_actual: "TC-ACTUAL" })).toEqual({ tcPlaca: "TC-ACTUAL", tcOrigen: "INTERNO", tcVehiculoId: 5 });
    expect(resolverTcReporte({ tc_vehiculo_id: null, tc_placa_actual: "TC-HUERFANA" })).toEqual({ tcPlaca: null, tcOrigen: null, tcVehiculoId: null });
  });
  it("el fallback NUNCA pisa a un externo ni a un snapshot", () => {
    expect(resolverTcReporte({ tc_vehiculo_id: 5, tc_externo_placa: "TX-1", tc_placa_actual: "TC-ACTUAL" }).tcPlaca).toBe("TX-1");
  });
  it("si por datos legados coexistieran interno y externo, gana el snapshot interno (sin ambigüedad)", () => {
    expect(resolverTcReporte({ tc_placa_historica: "TC-1", tc_externo_placa: "TX-1" })).toMatchObject({ tcPlaca: "TC-1", tcOrigen: "INTERNO" });
  });
});

describe("obtenerReporteViajes — TC en el contrato del reporte", () => {
  it("PROPIO con tc_placa_historica", async () => {
    filasBD = [fila({ tc_vehiculo_id: 5, tc_placa_historica: "TC-456XYZ", tc_placa_actual: "TC-456XYZ" })];
    expect(await primero()).toMatchObject({ tcPlaca: "TC-456XYZ", tcOrigen: "INTERNO", tcVehiculoId: 5 });
  });
  it("TERCERIZADO con tc_externo_placa", async () => {
    filasBD = [fila({ tc_externo_placa: "TX-900" })];
    expect(await primero()).toMatchObject({ tcPlaca: "TX-900", tcOrigen: "EXTERNO", tcVehiculoId: null });
  });
  it("sin TC", async () => {
    filasBD = [fila()];
    expect(await primero()).toMatchObject({ tcPlaca: null, tcOrigen: null, tcVehiculoId: null });
  });
  it("HISTÓRICO Cerrado/Cancelado: prioriza el snapshot aunque el TC haya cambiado de placa después", async () => {
    filasBD = [fila({ id: 1, estado: "Cerrado", tc_vehiculo_id: 5, tc_placa_historica: "TC-PLACA-ORIGINAL", tc_placa_actual: "TC-PLACA-NUEVA" }),
      fila({ id: 2, estado: "Cancelado", tc_vehiculo_id: 5, tc_placa_historica: "TC-PLACA-ORIGINAL", tc_placa_actual: "TC-PLACA-NUEVA" })];
    const r = await obtenerReporteViajes(7, {});
    expect(r.map((p) => p.tcPlaca)).toEqual(["TC-PLACA-ORIGINAL", "TC-PLACA-ORIGINAL"]);
  });
  it("la consulta selecciona los 3 campos, une el TC por id SIN filtrarlo (LEFT JOIN) y sigue acotada por empresa", async () => {
    await obtenerReporteViajes(7, {});
    const [sql, params] = vi.mocked(query).mock.calls[0];
    for (const c of ["p.tc_vehiculo_id", "p.tc_placa_historica", "p.tc_externo_placa", "tcv.placa AS tc_placa_actual"]) expect(String(sql)).toContain(c);
    expect(String(sql)).toContain("LEFT JOIN flota_vehiculos tcv ON tcv.id = p.tc_vehiculo_id");
    expect(String(sql)).toContain("p.empresa_id = ?");
    expect((params as unknown[])[0]).toBe(7); // aislamiento: la empresa de la sesión; el JOIN no amplía el conjunto
  });
  it("instalación sin las columnas de TC: reintenta sin ellas y el reporte sigue funcionando (sin TC)", async () => {
    let n = 0;
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("LEFT JOIN tms_clientes")) {
        n += 1;
        if (String(sql).includes("p.tc_vehiculo_id")) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
        return [fila()];
      }
      return [];
    }) as never);
    expect(await primero()).toMatchObject({ tcPlaca: null, tcOrigen: null });
    expect(n).toBe(2);
  });
  it("otro error de BD NO se traga", async () => {
    vi.mocked(query).mockImplementation((async () => { throw Object.assign(new Error("boom"), { code: "ER_LOCK_DEADLOCK" }); }) as never);
    await expect(obtenerReporteViajes(7, {})).rejects.toThrow("boom");
  });
  it("no cambia los KPIs: el TC es descriptivo, no monetario", () => {
    const base = { estado: "Cerrado", tarifaComercial: 1000, pendienteCierre: false } as PlanReporte;
    const conTc = { ...base, tcPlaca: "TC-1", tcOrigen: "INTERNO", tcVehiculoId: 3 } as PlanReporte;
    expect(calcularKpisReporte([conTc, conTc])).toEqual(calcularKpisReporte([base, base]));
  });
});

const plan = (over: Partial<PlanReporte> = {}) => ({
  id: 1, codigo: "PLAN-1", fechaPlan: "2026-09-21", horaCarga: null, estado: "Cerrado", pendienteCierre: false, cerradoPor: null, cerradoEn: null,
  clienteId: 1, cliente: "Acme", rutaCodigo: "1001", lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null, regresoEstimado: null,
  tarifaComercial: 1000, tarifaId: null, tarifaNombre: null, tarifaMontoSnapshot: null, tarifaMoneda: null, placa: "C-123ABC", unidadTipo: "Camion",
  unidadCapacidad: null, pilotoId: 1, piloto: "Juan", auxiliares: [], paradas: [], evidencias: 0, horaSalida: null, horaLlegada: null, kmSalida: null,
  kmLlegada: null, kmRecorridos: null, diasRuta: null, estadoFacturacion: "No aplica", facturaId: null, numeroFactura: null, estadoAdminFactura: null,
  estadoFinancieroFactura: null, montoFacturadoViaje: null, montoBorradorViaje: null, totalFactura: null, totalPagadoFactura: null, saldoFactura: null, ...over,
}) as PlanReporte;

describe("exportación Excel de viajes", () => {
  beforeEach(() => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ empresa: { id: 7, nombre: "ACME" }, session: {} } as never);
  });
  const exportarConPlanes = async (planes: PlanReporte[]) => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (s.includes("COUNT(")) return [{ total: planes.length }];
      return [];
    }) as never);
    // La ruta usa obtenerReporteViajesParaExportar (BD); se prueba la construcción de filas con los planes ya resueltos.
    return planes;
  };

  it("agrega 'TC / Caja / Remolque' y 'Origen TC' AL FINAL sin renombrar ni mover columnas existentes", () => {
    const src = readFileSync("src/app/api/empresas/[slug]/tms/reportes/viajes/export/route.ts", "utf8").replace(/\r?\n/g, "\n");
    const headers = src.slice(src.indexOf("const HEADERS_EXCEL"), src.indexOf("export async function GET"));
    expect(headers).toContain('"Estado cobro factura", "Total factura", "Total pagado factura", "Saldo factura",\n  ETIQUETA_TC, "Origen TC",');
    expect(headers.indexOf('"Fecha", "Cliente", "Equipo asignado", "Identificación vehículo"')).toBeGreaterThan(-1);
    expect(src).toContain('p.tcPlaca ?? ""'); // sin TC: celda vacía
    expect(src).toContain("etiquetaOrigenTc(p.tcOrigen)");
  });

  it("propio usa el snapshot (Propio) y tercerizado el texto externo (Tercerizado); sin TC celdas vacías", async () => {
    const planes = await exportarConPlanes([
      plan({ id: 1, tcPlaca: "TC-456XYZ", tcOrigen: "INTERNO", tcVehiculoId: 3 }),
      plan({ id: 2, tcPlaca: "TX-900", tcOrigen: "EXTERNO", tcVehiculoId: null }),
      plan({ id: 3 }),
    ]);
    const filas = planes.map((p) => [p.tcPlaca ?? "", etiquetaOrigenTc(p.tcOrigen)]);
    expect(filas).toEqual([["TC-456XYZ", "Propio"], ["TX-900", "Tercerizado"], ["", ""]]);
    expect(tablaAExcel).not.toHaveBeenCalled();
  });

  it("el endpoint real genera el Excel con las dos columnas nuevas en cada fila", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (s.includes("LEFT JOIN tms_clientes")) return [fila({ id: 1, estado: "Cerrado", tc_vehiculo_id: 5, tc_placa_historica: "TC-456XYZ", tc_placa_actual: "OTRA" }), fila({ id: 2, tc_externo_placa: "TX-900" })];
      if (s.includes("COUNT(")) return [{ total: 2 }];
      return [];
    }) as never);
    const r = await exportar(new Request("http://x/api/x/export?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-30"), { params: Promise.resolve({ slug: "acme" }) });
    expect(r.status).toBe(200);
    const arg = vi.mocked(tablaAExcel).mock.calls[0][0] as { headers: string[]; rows: string[][] };
    const i = arg.headers.indexOf("TC / Caja / Remolque");
    expect(i).toBe(arg.headers.length - 2);
    expect(arg.headers.at(-1)).toBe("Origen TC");
    expect(arg.rows.map((f) => [f[i], f[i + 1]])).toEqual([["TC-456XYZ", "Propio"], ["TX-900", "Tercerizado"]]);
    expect(arg.rows.every((f) => f.length === arg.headers.length)).toBe(true);
  });
});

describe("exportación PDF de viajes", () => {
  it("la tabla operativa incluye 'TC / Caja / Remolque' (al final del arreglo; no se mueven las demás)", () => {
    expect(HEADERS_OPERATIVOS.at(-1)).toBe("TC / Caja / Remolque");
    expect(HEADERS_OPERATIVOS.slice(0, 5)).toEqual(["Fecha", "Código", "Cliente", "Ruta", "Unidad / placa"]);
    expect(filaOperativa(plan({ tcPlaca: "TC-456XYZ", tcOrigen: "INTERNO" })).at(-1)).toBe("TC-456XYZ");
    expect(filaOperativa(plan({ tcPlaca: "TX-900", tcOrigen: "EXTERNO" })).at(-1)).toBe("TX-900 (Tercerizado)");
    expect(filaOperativa(plan()).at(-1)).toBe("—");
  });
  it("el layout compacta el TC junto a la unidad (misma fila, sin agregar filas ni ensanchar la tabla)", () => {
    const src = readFileSync("src/lib/tms/reporte-viajes-historial-pdf.ts", "utf8");
    expect(src).toContain("label: HEADERS_OPERATIVOS[16], valor: v[16]");
  });
  it("genera un PDF válido con y sin TC (el generador real no falla)", async () => {
    const real = await vi.importActual<typeof import("./reporte-viajes-historial-pdf")>("./reporte-viajes-historial-pdf");
    const kpis = calcularKpisReporte([plan()]);
    const buf = await real.reporteViajesHistorialPdf({ empresaNombre: "ACME", generadoEn: "hoy", filtros: {}, kpis, planes: [plan({ tcPlaca: "TC-456XYZ", tcOrigen: "INTERNO" }), plan({ id: 2 })] });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(reporteViajesHistorialPdf).not.toHaveBeenCalled();
  });
});

describe("pantalla Planes / Reportes (mismo componente)", () => {
  const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");
  it("la fila muestra la unidad y, debajo, 'TC: …' solo si hay TC (no ensancha la tabla)", () => {
    expect(src).toContain("{p.tcPlaca ? (");
    expect(src).toContain("TC: {p.tcPlaca}");
    expect(src).not.toMatch(/"Placa", "Piloto", "TC/); // no se agregó columna
  });
  it("el expediente muestra Unidad, TC / Caja / Remolque (— si no hay) y el origen Propio/Tercerizado cuando aplica", () => {
    expect(src).toContain("<li>Unidad: {p.placa ?? \"—\"}</li>");
    expect(src).toContain("{ETIQUETA_TC}: {p.tcPlaca ?? \"—\"}");
    expect(src).toContain("Origen del TC: {etiquetaOrigenTc(p.tcOrigen)}");
    expect(etiquetaOrigenTc("INTERNO")).toBe("Propio");
    expect(etiquetaOrigenTc("EXTERNO")).toBe("Tercerizado");
    expect(etiquetaOrigenTc(null)).toBe("");
  });
  it("Reportes / Viajes comparte el componente: ve el TC y no obtiene acciones operativas nuevas", () => {
    expect(readFileSync("src/app/e/[slug]/reportes/viajes/page.tsx", "utf8")).toContain('modo="reporte"');
  });
});
