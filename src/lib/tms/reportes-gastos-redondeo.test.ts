import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { exportarReporteFondosExcel } from "./gastos-export-excel";
import {
  agruparSolicitudesFondo,
  REGLA_REDONDEO_FONDOS,
  reporteSolicitudesFondo,
  resumenMensualFondos,
  resumirSolicitudesFondo,
  sumaSubtotalesPorSolicitud,
  type FilaSolicitudFondoReporte,
} from "./reportes-gastos";

/**
 * OP-FONDOS-REP-01 (corrección de auditoría PR #557) — REGLA ÚNICA DE REDONDEO.
 *
 * cantidad DECIMAL(10,2) × monto DECIMAL(12,2) produce hasta 4 decimales (p. ej. 0.50 × 0.01 = 0.005) y la API acepta cualquier
 * número positivo. Regla: cada SOLICITUD se redondea UNA vez a centavos (half-up) sobre la suma exacta de sus líneas (así
 * también se guarda tms_solicitudes_fondo.total) y TODO total general (pantalla, Excel, PDF) es la suma de esos subtotales
 * por solicitud ya redondeados: los totales concilian con los subtotales visibles.
 */
type R = Record<string, unknown>;
function fila(o: R): R {
  return {
    linea_id: 1, solicitud_id: 10, solicitud_codigo: "F-10", fecha_solicitud: "2026-09-03", fecha_viaje: null, empleado_id: null, empleado_nombre: "Piloto", cuenta: null,
    metodo_pago: null, cargo: null, vehiculo_id: null, placa: null, cliente_id: null, cliente_nombre: null, plan_id: null, categoria: "Combustible", cantidad: "0.50",
    descripcion: null, monto: "0.01", total_solicitud: "0.01", estado: "Autorizada", observaciones: null, ...o,
  };
}
const FRACCION = [
  fila({ linea_id: 1, solicitud_id: 10, solicitud_codigo: "F-A", estado: "Autorizada" }), // 0.005
  fila({ linea_id: 2, solicitud_id: 11, solicitud_codigo: "F-B", estado: "Autorizada" }), // 0.005
];
async function filas(rows: R[], categoria = "Combustible") {
  vi.mocked(query).mockResolvedValue(rows as never);
  return reporteSolicitudesFondo(7, { categoria });
}
/** Suma de los subtotales VISIBLES (uno por solicitud) en centavos, con aritmética entera. */
function sumaVisible(f: FilaSolicitudFondoReporte[], aceptar: (e: string) => boolean = () => true): number {
  const vistos = new Map<number, FilaSolicitudFondoReporte>();
  for (const x of f) vistos.set(x.solicitudId, x);
  let c = 0;
  for (const x of vistos.values()) if (aceptar(x.estadoFondo)) c += Math.round((x.subtotalCategoria ?? 0) * 100);
  return c;
}

beforeEach(() => vi.resetAllMocks());

describe("redondeo — dos solicitudes con subtotal exacto de Q0.005 cada una", () => {
  it("cada solicitud se redondea a Q0.01 y el resumen es Q0.02 (suma de subtotales visibles), no Q0.01", async () => {
    const f = await filas(FRACCION);
    expect(f.map((x) => [x.totalExacto, x.subtotalCategoria])).toEqual([["0.0050", 0.01], ["0.0050", 0.01]]);
    const r = resumirSolicitudesFondo(f, "Combustible");
    expect(r).toMatchObject({ cantidad: 2, totalSolicitado: 0.02, totalAutorizado: 0.02 });
    expect(Math.round(r.totalSolicitado * 100)).toBe(sumaVisible(f));
  });

  it("el total del mes del PDF concilia con los subtotales por solicitud (Q0.02)", async () => {
    const grupos = agruparSolicitudesFondo(await filas(FRACCION));
    expect(grupos.map((g) => g.subtotalCategoria)).toEqual([0.01, 0.01]);
    expect(resumenMensualFondos(grupos, "Combustible").totalGeneral).toBe(0.02);
  });

  it("el total del PDF tabular concilia con los subtotales por solicitud (Q0.02)", async () => {
    expect(sumaSubtotalesPorSolicitud(await filas(FRACCION))).toBe(0.02);
  });
});

describe("redondeo — múltiples líneas de una misma solicitud", () => {
  it("3 líneas de 0.005 = 0.015 exacto → UN redondeo de la solicitud (0.02), no tres de línea (0.03) ni cero", async () => {
    const f = await filas([1, 2, 3].map((i) => fila({ linea_id: i, solicitud_id: 10, solicitud_codigo: "F-A" })));
    expect(f.every((x) => x.subtotalCategoria === 0.02)).toBe(true);
    expect(resumirSolicitudesFondo(f, "Combustible")).toMatchObject({ cantidad: 1, totalSolicitado: 0.02 });
    expect(sumaSubtotalesPorSolicitud(f)).toBe(0.02);
    expect(agruparSolicitudesFondo(f)[0].subtotalCategoria).toBe(0.02);
  });

  it("líneas que suman un centavo exacto no pierden ni ganan nada (2 × 0.005 = 0.01)", async () => {
    const f = await filas([1, 2].map((i) => fila({ linea_id: i, solicitud_id: 10 })));
    expect(f[0].subtotalCategoria).toBe(0.01);
    expect(resumirSolicitudesFondo(f, "Combustible").totalSolicitado).toBe(0.01);
  });
});

describe("redondeo — suma de subtotales visibles frente al resumen, por estado", () => {
  it("escenario mixto con fracciones: cada total del resumen = suma de los subtotales visibles de sus solicitudes", async () => {
    const rows = [
      fila({ linea_id: 1, solicitud_id: 1, estado: "Autorizada" }),                                  // 0.005 -> 0.01
      fila({ linea_id: 2, solicitud_id: 2, estado: "Autorizada", cantidad: "12.50", monto: "0.99" }), // 12.375 -> 12.38
      fila({ linea_id: 3, solicitud_id: 2, estado: "Autorizada", cantidad: "1.00", monto: "0.10" }),  // + 0.10 = 12.475 -> 12.48
      fila({ linea_id: 4, solicitud_id: 3, estado: "Liquidada", cantidad: "1.50", monto: "0.67" }),  // 1.005 -> 1.01
      fila({ linea_id: 5, solicitud_id: 4, estado: "Rechazada", cantidad: "1.00", monto: "50.00" }),
      fila({ linea_id: 6, solicitud_id: 5, estado: "Pendiente" }),                                   // 0.005 -> 0.01
    ];
    const f = await filas(rows);
    const r = resumirSolicitudesFondo(f, "Combustible");
    const c = (n: number) => Math.round(n * 100);
    expect(c(r.totalSolicitado)).toBe(sumaVisible(f));
    expect(c(r.totalAutorizado)).toBe(sumaVisible(f, (e) => e === "Autorizada" || e === "Liquidada"));
    expect(c(r.totalLiquidado)).toBe(sumaVisible(f, (e) => e === "Liquidada"));
    expect(c(r.totalRechazado)).toBe(sumaVisible(f, (e) => e === "Rechazada"));
    expect(c(r.totalPendiente ?? 0)).toBe(sumaVisible(f, (e) => e === "Pendiente"));
    expect(r).toMatchObject({ cantidad: 5, totalSolicitado: 63.51 });
    expect(c(sumaSubtotalesPorSolicitud(f))).toBe(sumaVisible(f));
    expect(c(resumenMensualFondos(agruparSolicitudesFondo(f), "Combustible").totalGeneral)).toBe(sumaVisible(f, (e) => e === "Autorizada" || e === "Liquidada"));
  });
});

describe("redondeo — importes enteros en centavos (caso normal) y sin categoría", () => {
  it("sin fracciones, el resultado es el de siempre", async () => {
    const f = await filas([
      fila({ linea_id: 1, solicitud_id: 1, cantidad: "2.00", monto: "100.50" }),
      fila({ linea_id: 2, solicitud_id: 2, cantidad: "3.00", monto: "20.05", estado: "Liquidada" }),
    ]);
    expect(resumirSolicitudesFondo(f, "Combustible")).toMatchObject({ cantidad: 2, totalSolicitado: 261.15, totalAutorizado: 261.15, totalLiquidado: 60.15 });
    expect(sumaSubtotalesPorSolicitud(f)).toBe(261.15);
  });

  it("sin categoría no cambia: total de cabecera por solicitud, sin campos nuevos", async () => {
    vi.mocked(query).mockResolvedValue(FRACCION as never);
    const f = await reporteSolicitudesFondo(7, {});
    const r = resumirSolicitudesFondo(f);
    expect(r).toEqual({ cantidad: 2, totalSolicitado: 0.02, totalAutorizado: 0.02, totalLiquidado: 0, totalRechazado: 0 }); // total_solicitud 0.01 × 2 (cabecera guardada)
    expect(f.every((x) => x.subtotalCategoria === undefined)).toBe(true);
  });
});

describe("redondeo — pantalla, Excel y PDF muestran los mismos números", () => {
  it("Excel: hoja Resumen y subtotales por solicitud coinciden con el resumen; las columnas informativas lo dicen", async () => {
    const f = await filas(FRACCION);
    const resumen = resumirSolicitudesFondo(f, "Combustible");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await exportarReporteFondosExcel(f, resumen, "Combustible")) as never);
    const ws = wb.getWorksheet("Solicitudes de fondo")!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    expect(headers[18]).toMatch(/informativo.*no sumar/i);
    expect(headers[21]).toMatch(/informativo.*no sumar/i);
    const subtotales = [2, 3].map((i) => (ws.getRow(i).values as unknown[])[22] as number);
    expect(subtotales).toEqual([0.01, 0.01]);
    const pares = new Map<string, unknown>(); wb.getWorksheet("Resumen")!.eachRow((row) => pares.set(String(row.values && (row.values as unknown[])[1]), (row.values as unknown[])[2]));
    expect(pares.get("Subtotal Combustible solicitado (todas las solicitudes del filtro)")).toBe(0.02);
    expect(Math.round(subtotales.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round(resumen.totalSolicitado * 100));
    const textoResumen = [...pares.keys()].join("\n");
    expect(textoResumen).toContain(REGLA_REDONDEO_FONDOS);
  });

  it("la regla documentada está redactada una sola vez y menciona solicitud, centavos y suma de subtotales", () => {
    expect(REGLA_REDONDEO_FONDOS).toMatch(/solicitud/i);
    expect(REGLA_REDONDEO_FONDOS).toMatch(/centavo/i);
    expect(REGLA_REDONDEO_FONDOS).toMatch(/suma de (esos )?subtotales/i);
  });
});
