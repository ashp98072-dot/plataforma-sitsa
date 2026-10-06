import { describe, expect, it } from "vitest";
import {
  FECHA_LABORAL_MINIMA_PLAUSIBLE,
  analizarTraslapes,
  aIso,
  clasificarTraslape,
  deIso,
  diasSuperposicion,
  estadoVisualPeriodo,
  fechaLaboralSospechosa,
  periodoLaboral,
  planificarSincronizacion,
  type FilaSaldo,
} from "./vacaciones-periodos";

const d = (s: string) => deIso(s);
const fila = (id: number, anio: number | null, inicio: string, fin: string, extra: Partial<FilaSaldo> = {}): FilaSaldo => ({
  id, anioLaboral: anio, inicio, fin, otorgados: 15, disponibles: 15, estado: "Vigente", conConsumo: false, ...extra,
});

/** Aplica un plan sobre un estado en memoria (simula lo que escribe la BD) para probar idempotencia y secuencias. */
function aplicar(existentes: FilaSaldo[], plan: ReturnType<typeof planificarSincronizacion>): FilaSaldo[] {
  const salida = existentes.map((f) => ({ ...f }));
  let sig = Math.max(0, ...existentes.map((f) => f.id)) + 1;
  for (const u of plan.updates) {
    const f = salida.find((x) => x.id === u.id)!;
    Object.assign(f, { inicio: u.inicio, fin: u.fin, otorgados: u.otorgados, disponibles: u.disponibles });
  }
  for (const i of plan.inserts) salida.push(fila(sig++, i.anioLaboral, i.inicio, i.fin, { otorgados: i.otorgados, disponibles: i.otorgados }));
  return salida;
}

describe("períodos laborales: fechas inclusivas, sin traslape", () => {
  it("el siguiente período empieza EXACTAMENTE el día después de que termina el anterior", () => {
    const base = d("2024-10-31");
    const p1 = periodoLaboral(base, 1), p2 = periodoLaboral(base, 2);
    expect([aIso(p1.inicio), aIso(p1.fin)]).toEqual(["2024-10-31", "2025-10-30"]);
    expect([aIso(p2.inicio), aIso(p2.fin)]).toEqual(["2025-10-31", "2026-10-30"]);
    for (let n = 1; n <= 40; n++) {
      const a = periodoLaboral(base, n), b = periodoLaboral(base, n + 1);
      expect(aIso(b.inicio)).toBe(aIso(new Date(a.fin.getFullYear(), a.fin.getMonth(), a.fin.getDate() + 1)));
      expect(diasSuperposicion(a, b)).toBe(0);
    }
  });
  it("año bisiesto / 29 de febrero: sin hueco ni traslape durante todos los años", () => {
    const base = d("2020-02-29");
    const marca = [1, 2, 3, 4, 5].map((n) => { const p = periodoLaboral(base, n); return [aIso(p.inicio), aIso(p.fin)]; });
    expect(marca[0]).toEqual(["2020-02-29", "2021-02-27"]);
    expect(marca[1]).toEqual(["2021-02-28", "2022-02-27"]); // el 29/feb cae al 28 en año no bisiesto
    expect(marca[4][0]).toBe("2024-02-29");                  // vuelve al 29 en bisiesto
    for (let n = 1; n <= 30; n++) expect(diasSuperposicion(periodoLaboral(base, n), periodoLaboral(base, n + 1))).toBe(0);
  });
  it("cada período dura un año calendario (no se encadena desde el anterior: sin deriva)", () => {
    const base = d("2000-01-31");
    expect(aIso(periodoLaboral(base, 25).inicio)).toBe("2024-01-31");
    expect(aIso(periodoLaboral(base, 25).fin)).toBe("2025-01-30");
  });
});

describe("traslapes: borde vs real", () => {
  it("compartir solo la fecha límite es BORDE (1 día) — ejemplo real de Álvaro", () => {
    const a = { inicio: d("2022-10-31"), fin: d("2023-10-30") }, b = { inicio: d("2023-10-30"), fin: d("2024-10-29") };
    expect(clasificarTraslape(a, b)).toEqual({ tipo: "BORDE", dias: 1 });
  });
  it("superposición de varios días es REAL y cuenta los días — ejemplo real de Amílcar (> 1 mes)", () => {
    const a = { inicio: d("2024-05-31"), fin: d("2025-05-30") }, b = { inicio: d("2025-04-13"), fin: d("2026-04-12") };
    const r = clasificarTraslape(a, b);
    expect(r.tipo).toBe("REAL");
    expect(r.dias).toBe(48);
  });
  it("períodos consecutivos sin tocarse no se reportan", () => {
    expect(clasificarTraslape({ inicio: d("2024-10-31"), fin: d("2025-10-30") }, { inicio: d("2025-10-31"), fin: d("2026-10-30") }).tipo).toBe("NINGUNO");
  });
  it("analizarTraslapes distingue los dos tipos en un conjunto de filas", () => {
    const r = analizarTraslapes([
      fila(1, 1, "2022-10-31", "2023-10-30"), fila(2, 2, "2023-10-30", "2024-10-29"),
      fila(3, 3, "2024-05-31", "2025-05-30"), fila(4, 4, "2025-04-13", "2026-04-12"),
    ]);
    expect(r.map((x) => x.codigo)).toContain("TRASLAPE_BORDE");
    expect(r.map((x) => x.codigo)).toContain("TRASLAPE_REAL");
  });
});

describe("fecha laboral sospechosa", () => {
  it("< 1980 o inválida es sospechosa; una fecha normal no", () => {
    expect(FECHA_LABORAL_MINIMA_PLAUSIBLE).toBe("1980-01-01");
    expect(fechaLaboralSospechosa(d("1899-12-31"))).toBe(true);
    expect(fechaLaboralSospechosa(d("1979-12-31"))).toBe(true);
    expect(fechaLaboralSospechosa(new Date("x"))).toBe(true);
    expect(fechaLaboralSospechosa(d("1980-01-01"))).toBe(false);
    expect(fechaLaboralSospechosa(d("2022-10-31"))).toBe(false);
  });
  it("caso Elisa (1899-12-31): el motor NO genera períodos ni modifica nada; solo advierte", () => {
    const plan = planificarSincronizacion(d("1899-12-31"), d("2026-10-06"), [fila(1, 1, "1900-01-01", "1900-12-31", { estado: "Vencido" })]);
    expect(plan.omitido).toBe("FECHA_SOSPECHOSA");
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.advertencias[0].codigo).toBe("FECHA_LABORAL_SOSPECHOSA");
  });
});

describe("planificarSincronizacion — historial y períodos", () => {
  const hoy = d("2026-10-06");
  it("empleado con 1 período (en curso): se crea una sola fila proporcional", () => {
    const plan = planificarSincronizacion(d("2026-04-01"), hoy, []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ anioLaboral: 1, inicio: "2026-04-01", fin: "2027-03-31" });
    expect(plan.inserts[0].otorgados).toBeGreaterThan(0);
    expect(plan.inserts[0].otorgados).toBeLessThan(15);
  });
  it("empleado con 10 períodos: históricos completos de 15 días + el período en curso; ninguno se omite ni se superpone", () => {
    const plan = planificarSincronizacion(d("2016-03-15"), hoy, []);
    expect(plan.inserts.map((i) => i.anioLaboral)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(plan.inserts.slice(0, 10).every((i) => i.otorgados === 15)).toBe(true);
    const estado = aplicar([], plan);
    expect(analizarTraslapes(estado)).toEqual([]);
  });
  it("HISTÓRICO COMPLETO: sincronizar nunca elimina ni oculta períodos antiguos (incluidos Vencidos)", () => {
    const base = d("2016-03-15");
    const inicial = aplicar([], planificarSincronizacion(base, hoy, []));
    const vencidos = inicial.map((f, i) => (i < 8 ? { ...f, estado: "Vencido", disponibles: 0 } : f));
    const plan = planificarSincronizacion(base, hoy, vencidos);
    expect(plan.inserts).toEqual([]);
    const final = aplicar(vencidos, plan);
    expect(final).toHaveLength(vencidos.length);
    expect(final.filter((f) => f.estado === "Vencido")).toHaveLength(8); // los vencidos no se tocan
  });
  it("período vencido: no se modifica (ni fechas ni días) aunque difiera de lo esperado", () => {
    const plan = planificarSincronizacion(d("2022-10-31"), hoy, [fila(1, 1, "2022-10-30", "2023-10-29", { estado: "Vencido", disponibles: 0 })]);
    expect(plan.updates.find((u) => u.id === 1)).toBeUndefined();
  });
  it("NO DUPLICA: sincronizar dos veces seguidas no genera inserts ni updates la segunda vez", () => {
    const base = d("2018-06-01");
    const primera = planificarSincronizacion(base, hoy, []);
    const estado = aplicar([], primera);
    const segunda = planificarSincronizacion(base, hoy, estado);
    expect(segunda.inserts).toEqual([]);
    expect(segunda.updates).toEqual([]);
  });
  it("PREVENCIÓN DE TRASLAPE: un período nuevo que se superpone con una fila existente NO se inserta", () => {
    // fila vieja (otra serie, anio 9) ocupa el rango del año laboral 1 esperado
    const plan = planificarSincronizacion(d("2025-10-31"), hoy, [fila(7, 9, "2025-09-01", "2026-08-31", { estado: "Vencido" })]);
    expect(plan.inserts).toEqual([]);
    expect(plan.advertencias.map((a) => a.codigo)).toContain("NUEVO_PERIODO_OMITIDO_POR_TRASLAPE");
  });
  it("fila con año laboral NULO o repetido no participa y no provoca duplicados", () => {
    const nulo = planificarSincronizacion(d("2025-10-31"), hoy, [fila(5, null, "2025-10-31", "2026-10-30")]);
    expect(nulo.inserts).toEqual([]); // se superpone con la fila sin año: no se duplica
    expect(nulo.advertencias.map((a) => a.codigo)).toEqual(expect.arrayContaining(["ANIO_LABORAL_NULO"]));
    const dup = planificarSincronizacion(d("2025-10-31"), hoy, [fila(5, 1, "2025-10-31", "2026-10-30"), fila(6, 1, "2025-10-31", "2026-10-30")]);
    expect(dup.updates).toEqual([]);
    expect(dup.advertencias.map((a) => a.codigo)).toContain("ANIO_LABORAL_DUPLICADO");
  });
});

describe("cambio de fecha laboral", () => {
  const hoy = d("2026-10-06");
  it("SIN consumos: se realinean las fechas del período existente (sin crear una segunda serie encima)", () => {
    const existentes = [fila(1, 1, "2024-05-31", "2025-05-30", { disponibles: 15 }), fila(2, 2, "2025-05-31", "2026-05-30", { disponibles: 15 })];
    const plan = planificarSincronizacion(d("2024-04-13"), hoy, existentes);
    const final = aplicar(existentes, plan);
    expect(plan.updates.filter((u) => u.realineado).length).toBeGreaterThan(0);
    expect(final.filter((f) => f.anioLaboral === 1)).toHaveLength(1);
    expect(final.filter((f) => f.anioLaboral === 2)).toHaveLength(1);
    expect(analizarTraslapes(final).filter((a) => a.codigo === "TRASLAPE_REAL")).toEqual([]);
  });
  it("CON consumos: NO se recalculan las fechas del saldo consumido; se advierte para reparación administrada", () => {
    const existentes = [fila(1, 1, "2024-05-31", "2025-05-30", { disponibles: 6, conConsumo: true })];
    const plan = planificarSincronizacion(d("2024-04-13"), hoy, existentes);
    expect(plan.updates.find((u) => u.id === 1)).toBeUndefined();
    expect(plan.advertencias.map((a) => a.codigo)).toContain("FECHAS_DISTINTAS_CON_CONSUMO");
    // y tampoco crea un período nuevo que se superponga con el consumido
    const final = aplicar(existentes, plan);
    expect(final.find((f) => f.id === 1)).toMatchObject({ inicio: "2024-05-31", fin: "2025-05-30", disponibles: 6 });
    expect(analizarTraslapes(final).filter((a) => a.codigo === "TRASLAPE_REAL")).toEqual([]);
  });
  it("las VACACIONES EXISTENTES no cambian: un saldo con consumo coherente conserva sus días y solo crece lo nuevo", () => {
    const base = d("2024-10-31");
    const existentes = [fila(1, 1, "2024-10-31", "2025-10-30", { disponibles: 5, conConsumo: true })];
    const plan = planificarSincronizacion(base, hoy, existentes);
    const final = aplicar(existentes, plan);
    expect(final.find((f) => f.id === 1)).toMatchObject({ otorgados: 15, disponibles: 5 });
    expect(final.some((f) => f.anioLaboral === 2)).toBe(true);
  });
});

describe("estado visual del historial", () => {
  it("En curso / Vigente / Consumido / Vencido", () => {
    const p = { estado: "Vigente", anioLaboral: 3, disponibles: 15, consumidos: 0 };
    expect(estadoVisualPeriodo(p, 3)).toBe("En curso");
    expect(estadoVisualPeriodo(p, 5)).toBe("Vigente");
    expect(estadoVisualPeriodo({ ...p, disponibles: 0, consumidos: 15 }, 5)).toBe("Consumido");
    expect(estadoVisualPeriodo({ ...p, estado: "Vencido", disponibles: 0 }, 5)).toBe("Vencido");
  });
});
