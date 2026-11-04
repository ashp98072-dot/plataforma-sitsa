import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { CATEGORIAS_GASTO } from "./gastos";
import {
  aCentavos,
  aCentesimas,
  agruparSolicitudesFondo,
  filtrosReporteGastosDesdeUrl,
  formatearDiezMilesimas,
  mensajeCategoriaFondosInvalida,
  obtenerReporteGastosPorTipo,
  productoExacto,
  reporteSolicitudesFondo,
  resumenMensualFondos,
  resumirSolicitudesFondo,
} from "./reportes-gastos";

/**
 * OP-FONDOS-REP-01 — filtro por categoría del reporte de solicitudes de fondo.
 * Las filas simulan lo que devuelve mysql2 para DECIMAL: TEXTO ("2.00", "100.50"), no número.
 */
type RowSql = Record<string, unknown>;
function fila(over: RowSql): RowSql {
  return {
    linea_id: 1, solicitud_id: 10, solicitud_codigo: "FONDO-000010", fecha_solicitud: "2026-09-03", fecha_viaje: "2026-09-04",
    empleado_id: 4, empleado_nombre: "Heber Sitan", cuenta: null, metodo_pago: null, cargo: "Piloto", vehiculo_id: 9, placa: "C-130BQ",
    cliente_id: 5, cliente_nombre: "Cliente A", plan_id: null, categoria: "Combustible", cantidad: "1.00", descripcion: "x", monto: "100.00",
    entidad_requirente_nombre: "Kuiqtrans", requirente_nombre: "Mario", solicitante_nombre: "Ana", autorizante_nombre: "Heber",
    fecha_autorizacion: "2026-09-04", total_solicitud: "501.00", estado: "Autorizada", observaciones: null,
    ...over,
  };
}

// Escenario: sol. 10 (Autorizada) = combustible + hospedaje; sol. 11 (Liquidada) = 2 líneas de combustible; sol. 13 (Rechazada) = combustible;
// sol. 14 (Autorizada) = decimales que en punto flotante NO suman exacto; sol. 12 (Pendiente) = solo hospedaje.
const ESCENARIO: RowSql[] = [
  fila({ linea_id: 1, solicitud_id: 10, solicitud_codigo: "F-10", categoria: "Combustible", cantidad: "2.00", monto: "100.50", total_solicitud: "501.00", estado: "Autorizada" }),
  fila({ linea_id: 2, solicitud_id: 10, solicitud_codigo: "F-10", categoria: "Hospedaje", cantidad: "1.00", monto: "300.00", total_solicitud: "501.00", estado: "Autorizada" }),
  fila({ linea_id: 3, solicitud_id: 11, solicitud_codigo: "F-11", categoria: "Combustible", cantidad: "1.00", monto: "50.10", total_solicitud: "110.25", estado: "Liquidada" }),
  fila({ linea_id: 4, solicitud_id: 11, solicitud_codigo: "F-11", categoria: "Combustible", cantidad: "3.00", monto: "20.05", total_solicitud: "110.25", estado: "Liquidada" }),
  fila({ linea_id: 5, solicitud_id: 13, solicitud_codigo: "F-13", categoria: "Combustible", cantidad: "1.00", monto: "1000.00", total_solicitud: "1000.00", estado: "Rechazada" }),
  fila({ linea_id: 6, solicitud_id: 14, solicitud_codigo: "F-14", categoria: "Combustible", cantidad: "3.00", monto: "0.10", total_solicitud: "0.50", estado: "Autorizada" }),
  fila({ linea_id: 7, solicitud_id: 14, solicitud_codigo: "F-14", categoria: "Combustible", cantidad: "1.00", monto: "0.20", total_solicitud: "0.50", estado: "Autorizada" }),
  fila({ linea_id: 8, solicitud_id: 12, solicitud_codigo: "F-12", categoria: "Hospedaje", cantidad: "1.00", monto: "75.00", total_solicitud: "75.00", estado: "Pendiente" }),
];
const SOLO_COMBUSTIBLE = ESCENARIO.filter((r) => r.categoria === "Combustible");

beforeEach(() => vi.resetAllMocks());

describe("OP-FONDOS-REP-01 · validación de la categoría contra el catálogo real", () => {
  it("acepta exactamente las categorías de CATEGORIAS_GASTO (sin lista paralela)", () => {
    for (const c of CATEGORIAS_GASTO) expect(mensajeCategoriaFondosInvalida("fondos", c)).toBeNull();
  });
  it("rechaza lo que no está en el catálogo: no la degrada a búsqueda general", () => {
    for (const c of ["Inexistente", "combustible", " Combustible", "Combustible ", "Combustible%", "' OR 1=1 --", "Gasolina vieja", " "]) {
      expect(mensajeCategoriaFondosInvalida("fondos", c), JSON.stringify(c)).toMatch(/Categoría inválida/);
    }
    expect(mensajeCategoriaFondosInvalida("fondos", "Inexistente")).toContain("Combustible");
  });
  it("sin categoría no hay validación; otros tipos de reporte conservan su comportamiento (no validan)", () => {
    expect(mensajeCategoriaFondosInvalida("fondos", undefined)).toBeNull();
    expect(mensajeCategoriaFondosInvalida("gastosDetalle", "Inexistente")).toBeNull();
    expect(mensajeCategoriaFondosInvalida("categoria", "Inexistente")).toBeNull();
  });
  it("categoria= (vacía) equivale a sin filtro; el parámetro se conserva tal cual cuando viene", () => {
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x/?categoria=")).categoria).toBeUndefined();
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x/?categoria=Combustible")).categoria).toBe("Combustible");
    expect(filtrosReporteGastosDesdeUrl(new URL("http://x/?categoria=%20")).categoria).toBe(" "); // luego rechazada por el validador
  });
});

describe("OP-FONDOS-REP-01 · aritmética exacta", () => {
  it("productoExacto: cantidad × monto sin error de punto flotante", () => {
    expect(formatearDiezMilesimas(productoExacto("3.00", "0.10"))).toBe("0.3000"); // 3 * 0.1 en float = 0.30000000000000004
    expect(formatearDiezMilesimas(productoExacto("1.50", "10.05"))).toBe("15.0750");
    expect(formatearDiezMilesimas(productoExacto(2, 100.5))).toBe("201.0000");
    expect(formatearDiezMilesimas(productoExacto("0.00", "99.99"))).toBe("0.0000");
  });
  it("redondea la SUMA half-up a centavos, no cada línea", () => {
    expect(aCentavos(productoExacto("1.50", "10.05"))).toBe(BigInt(1508)); // 15.075 -> 15.08
    const dosLineas = productoExacto("1.50", "10.05") + productoExacto("1.50", "10.05"); // 30.15 exacto
    expect(aCentavos(dosLineas)).toBe(BigInt(3015));
  });
  it("aCentesimas tolera número, texto y notación científica", () => {
    expect(aCentesimas("12.30")).toBe(BigInt(1230));
    expect(aCentesimas(12.3)).toBe(BigInt(1230));
    expect(aCentesimas(1e-7)).toBe(BigInt(0));
    expect(aCentesimas(null)).toBe(BigInt(0));
  });
});

describe("OP-FONDOS-REP-01 · consulta del reporte (reporteSolicitudesFondo)", () => {
  it("con categoría filtra por la LÍNEA (l.categoria) con parámetro, junto a empresa y los demás filtros", async () => {
    vi.mocked(query).mockResolvedValue(SOLO_COMBUSTIBLE as never);
    await reporteSolicitudesFondo(7, {
      categoria: "Combustible", fechaSolicitudDesde: "2026-09-01", fechaSolicitudHasta: "2026-09-30", clienteId: 5, placa: "C-130BQ", empleadoNombre: "Heber Sitan", estadoFondo: "Autorizada",
    });
    const [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("l.categoria = ?");
    expect(sql).toContain("l.empresa_id = ?");
    expect(sql).not.toMatch(/s\.categoria/); // la cabecera no tiene categoría
    expect(sql).not.toContain("GROUP BY"); // una fila por línea: no se duplican ni se colapsan solicitudes
    expect(params).toEqual([7, "2026-09-01", "2026-09-30", 5, "C-130BQ", "Heber Sitan", "Autorizada", "Combustible"]);
  });
  it("sin categoría la consulta NO cambia (sin condición de categoría, sin parámetro extra)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteSolicitudesFondo(7, { clienteId: 5 });
    const [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toContain("l.categoria = ?");
    expect(params).toEqual([7, 5]);
  });
  it("cada fila trae su categoría, el total de línea exacto y el subtotal de la categoría de SU solicitud", async () => {
    vi.mocked(query).mockResolvedValue(SOLO_COMBUSTIBLE as never);
    const filas = await reporteSolicitudesFondo(7, { categoria: "Combustible" });
    expect(filas.map((f) => f.categoria)).toEqual(Array(6).fill("Combustible"));
    const l1 = filas.find((f) => f.lineaId === 1)!;
    expect([l1.total, l1.totalExacto, l1.subtotalCategoria, l1.totalSolicitud]).toEqual([201, "201.0000", 201, 501]); // subtotal ≠ total de la solicitud (501)
    const l3 = filas.find((f) => f.lineaId === 3)!;
    expect([l3.totalExacto, l3.subtotalCategoria]).toEqual(["50.1000", 110.25]); // 50.10 + 3 × 20.05
    expect(filas.find((f) => f.lineaId === 6)!.subtotalCategoria).toBe(0.5); // exacto, no 0.5000000000000001
  });
  it("sin filtro de categoría NO agrega subtotalCategoria (la respuesta conserva su forma)", async () => {
    vi.mocked(query).mockResolvedValue(ESCENARIO as never);
    const filas = await reporteSolicitudesFondo(7, {});
    expect(filas.every((f) => f.subtotalCategoria === undefined)).toBe(true);
    expect(filas).toHaveLength(8);
  });
  it("obtenerReporteGastosPorTipo(fondos): el resumen sale del MISMO conjunto filtrado", async () => {
    vi.mocked(query).mockResolvedValue(SOLO_COMBUSTIBLE as never);
    const r = await obtenerReporteGastosPorTipo(7, "fondos", { categoria: "Combustible" });
    if (r.tipo !== "fondos") throw new Error("tipo");
    expect(r.resumen.categoria).toBe("Combustible");
    expect(r.resumen.cantidad).toBe(new Set(r.filas.map((f) => f.solicitudId)).size);
  });
});

describe("OP-FONDOS-REP-01 · resumen por categoría (sin doble conteo ni importes ajenos)", () => {
  async function filasCombustible() {
    vi.mocked(query).mockResolvedValue(SOLO_COMBUSTIBLE as never);
    return reporteSolicitudesFondo(7, { categoria: "Combustible" });
  }
  it("cuenta solicitudes DISTINTAS aunque tengan varias líneas de la categoría", async () => {
    const r = resumirSolicitudesFondo(await filasCombustible(), "Combustible");
    expect(r.cantidad).toBe(4); // F-10, F-11 (2 líneas), F-13, F-14 (2 líneas)
  });
  it("suma SOLO las líneas de la categoría, agrupadas por el estado real de su solicitud", async () => {
    const r = resumirSolicitudesFondo(await filasCombustible(), "Combustible");
    // F-10: 201.00 (Autorizada; su hospedaje de 300 NO entra) · F-11: 110.25 (Liquidada) · F-13: 1000 (Rechazada) · F-14: 0.50 (Autorizada)
    expect(r).toEqual({
      categoria: "Combustible", cantidad: 4,
      totalSolicitado: 1311.75, totalAutorizado: 311.75, totalLiquidado: 110.25, totalRechazado: 1000, totalPendiente: 0,
    });
    expect(r.totalAutorizado).not.toBe(501 + 110.25 + 0.5); // nunca el total de cabecera de la solicitud
  });
  it("categoría con solicitudes Pendientes: aparece en totalPendiente y en solicitado", () => {
    const filas: RowSql[] = ESCENARIO.map((r) => ({ ...r, fecha_solicitud: "2026-09-03" }));
    vi.mocked(query).mockResolvedValue(filas.filter((r) => r.categoria === "Hospedaje") as never);
    return reporteSolicitudesFondo(7, { categoria: "Hospedaje" }).then((f) => {
      const r = resumirSolicitudesFondo(f, "Hospedaje");
      expect(r).toMatchObject({ cantidad: 2, totalSolicitado: 375, totalAutorizado: 300, totalLiquidado: 0, totalRechazado: 0, totalPendiente: 75 });
    });
  });
  it("solicitudes de una sola categoría: el subtotal coincide con el total de la solicitud", async () => {
    vi.mocked(query).mockResolvedValue(ESCENARIO.filter((r) => r.solicitud_id === 13) as never);
    const f = await reporteSolicitudesFondo(7, { categoria: "Combustible" });
    expect(f[0].subtotalCategoria).toBe(f[0].totalSolicitud);
  });
  it("sin categoría conserva el comportamiento anterior (total de cabecera, una vez por solicitud)", async () => {
    vi.mocked(query).mockResolvedValue(ESCENARIO as never);
    const filas = await reporteSolicitudesFondo(7, {});
    const r = resumirSolicitudesFondo(filas);
    expect(r).toEqual({ cantidad: 5, totalSolicitado: 501 + 110.25 + 1000 + 0.5 + 75, totalAutorizado: 501 + 110.25 + 0.5, totalLiquidado: 110.25, totalRechazado: 1000 });
    expect("categoria" in r).toBe(false);
  });
  it("categoría histórica fuera del catálogo: sin filtro se incluye tal cual; con ese nombre como filtro se rechaza (400) y nada se modifica", async () => {
    const historica = fila({ linea_id: 9, solicitud_id: 20, solicitud_codigo: "F-20", categoria: "Gasolina vieja", cantidad: "1.00", monto: "40.00", total_solicitud: "40.00" });
    vi.mocked(query).mockResolvedValue([historica, ...SOLO_COMBUSTIBLE] as never);
    const filas = await reporteSolicitudesFondo(7, {});
    expect(filas.find((f) => f.solicitudCodigo === "F-20")!.categoria).toBe("Gasolina vieja");
    expect(resumirSolicitudesFondo(filas).cantidad).toBe(5);
    expect(mensajeCategoriaFondosInvalida("fondos", "Gasolina vieja")).toMatch(/Categoría inválida/);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1); // solo lecturas
  });
});

describe("OP-FONDOS-REP-01 · agrupación y resumen mensual", () => {
  it("con categoría: subtotal por solicitud y TOTAL del mes = suma exacta de subtotales de Autorizada + Liquidada", async () => {
    vi.mocked(query).mockResolvedValue(SOLO_COMBUSTIBLE as never);
    const filas = await reporteSolicitudesFondo(7, { categoria: "Combustible" });
    const grupos = agruparSolicitudesFondo(filas);
    expect(grupos.map((g) => [g.solicitudCodigo, g.subtotalCategoria, g.totalSolicitud])).toEqual([
      ["F-10", 201, 501], ["F-11", 110.25, 110.25], ["F-13", 1000, 1000], ["F-14", 0.5, 0.5],
    ]);
    const mes = resumenMensualFondos(grupos, "Combustible");
    expect(mes).toMatchObject({ categoria: "Combustible", totalSolicitudes: 4, autorizadas: 2, liquidadas: 1, rechazadas: 1, pendientes: 0, totalGeneral: 311.75 });
  });
  it("sin categoría el resumen mensual conserva su criterio (total de cabecera) y no trae 'categoria'", async () => {
    vi.mocked(query).mockResolvedValue(ESCENARIO as never);
    const grupos = agruparSolicitudesFondo(await reporteSolicitudesFondo(7, {}));
    const mes = resumenMensualFondos(grupos);
    expect(mes.totalGeneral).toBe(501 + 110.25 + 0.5);
    expect("categoria" in mes).toBe(false);
    expect(grupos.every((g) => g.subtotalCategoria === undefined)).toBe(true);
  });
});
