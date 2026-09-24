import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agruparViaticos,
  alternarEnSeleccion,
  etiquetaSemana,
  fechaCalendario,
  grupoCompletoSeleccionado,
  idsAAutorizarDelGrupo,
  limpiarSeleccionDelGrupo,
  lunesDeSemana,
  periodoDe,
  resumenGrupo,
  seleccionadosDelGrupo,
  seleccionarTodosDelGrupo,
  type ViaticoAgrupable,
} from "./viaticos-agrupacion";

/**
 * TMS-VIATICOS-AGRUPACION-1 (PR 1) — agrupación Día / Semana / Mes del listado de viáticos y selección POR GRUPO.
 * Referencia de calendario 2026: 21/09 = lunes, 24/09 = jueves, 27/09 = domingo, 28/09 = lunes, 31/12 = jueves.
 */
const v = (id: number, fechaPlan: string, estado = "PROGRAMADO", montoAsignado = 100): ViaticoAgrupable => ({ id, fechaPlan, estado, montoAsignado });
const q = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe("períodos: día, semana (lunes–domingo) y mes calendario", () => {
  it("DÍA: una sección por fecha de viaje", () => {
    expect(periodoDe("2026-09-24", "DIA")).toEqual({ clave: "2026-09-24", desde: "2026-09-24", hasta: "2026-09-24", etiqueta: "24/09/2026" });
  });

  it("SEMANA exacta lunes–domingo: cualquier día de la semana cae en el mismo lunes", () => {
    for (const f of ["2026-09-21", "2026-09-22", "2026-09-24", "2026-09-26", "2026-09-27"]) {
      expect(periodoDe(f, "SEMANA")).toMatchObject({ clave: "2026-09-21", desde: "2026-09-21", hasta: "2026-09-27", etiqueta: "Semana 21–27 septiembre 2026" });
    }
  });

  it("el DOMINGO cierra la semana (27/09) y el LUNES abre la siguiente (28/09)", () => {
    expect(lunesDeSemana("2026-09-27")).toBe("2026-09-21");
    expect(lunesDeSemana("2026-09-28")).toBe("2026-09-28");
    expect(periodoDe("2026-09-28", "SEMANA").clave).not.toBe(periodoDe("2026-09-27", "SEMANA").clave);
  });

  it("semana que cruza de MES: 28 sep – 4 oct 2026", () => {
    expect(periodoDe("2026-09-30", "SEMANA")).toEqual({ clave: "2026-09-28", desde: "2026-09-28", hasta: "2026-10-04", etiqueta: "Semana 28 sep – 4 oct 2026" });
    expect(periodoDe("2026-10-02", "SEMANA").clave).toBe("2026-09-28"); // los dos meses caen en la MISMA semana
  });

  it("semana que cruza de AÑO: 28 dic 2026 – 3 ene 2027", () => {
    expect(periodoDe("2026-12-31", "SEMANA")).toEqual({ clave: "2026-12-28", desde: "2026-12-28", hasta: "2027-01-03", etiqueta: "Semana 28 dic 2026 – 3 ene 2027" });
    expect(periodoDe("2027-01-02", "SEMANA").clave).toBe("2026-12-28");
    expect(etiquetaSemana("2026-12-28", "2027-01-03")).toBe("Semana 28 dic 2026 – 3 ene 2027");
  });

  it("MES calendario (incluye febrero y años bisiestos)", () => {
    expect(periodoDe("2026-09-24", "MES")).toEqual({ clave: "2026-09", desde: "2026-09-01", hasta: "2026-09-30", etiqueta: "Septiembre 2026" });
    expect(periodoDe("2026-02-10", "MES").hasta).toBe("2026-02-28");
    expect(periodoDe("2028-02-10", "MES").hasta).toBe("2028-02-29");
    expect(periodoDe("2026-12-31", "MES").etiqueta).toBe("Diciembre 2026");
  });

  it("fechas de calendario SIN reinterpretación de zona horaria (el resultado no depende del TZ del proceso)", () => {
    const previa = process.env.TZ;
    for (const tz of ["UTC", "America/Guatemala", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      process.env.TZ = tz;
      expect(periodoDe("2026-09-27", "SEMANA").clave).toBe("2026-09-21");
      expect(periodoDe("2026-09-28", "SEMANA").clave).toBe("2026-09-28");
    }
    if (previa === undefined) delete process.env.TZ; else process.env.TZ = previa;
  });

  it("fechaCalendario acepta solo fechas reales (y recorta hora si viene)", () => {
    expect(fechaCalendario("2026-09-24")).toBe("2026-09-24");
    expect(fechaCalendario("2026-09-24T10:00:00")).toBe("2026-09-24");
    expect(fechaCalendario("2026-02-30")).toBeNull();
    expect(fechaCalendario("24/09/2026")).toBeNull();
  });
});

describe("agruparViaticos", () => {
  const datos = [v(1, "2026-09-24"), v(2, "2026-09-24"), v(3, "2026-09-22"), v(4, "2026-09-28"), v(5, "2026-08-31"), v(6, "2026-09-27")];

  it("DÍA: un grupo por fecha, ordenado del más reciente al más antiguo", () => {
    expect(agruparViaticos(datos, "DIA").map((g) => g.clave)).toEqual(["2026-09-28", "2026-09-27", "2026-09-24", "2026-09-22", "2026-08-31"]);
  });

  it("SEMANA: lunes–domingo; el domingo 27 va con la semana del 21; el 28 abre otra; el 31/08 es de la semana anterior", () => {
    const g = agruparViaticos(datos, "SEMANA");
    expect(g.map((x) => x.clave)).toEqual(["2026-09-28", "2026-09-21", "2026-08-31"]);
    expect(g.find((x) => x.clave === "2026-09-21")!.items.map((i) => i.id).sort()).toEqual([1, 2, 3, 6]);
  });

  it("MES: mes calendario, más reciente primero", () => {
    const g = agruparViaticos(datos, "MES");
    expect(g.map((x) => x.etiqueta)).toEqual(["Septiembre 2026", "Agosto 2026"]);
    expect(g[0].total).toBe(5);
  });

  it("orden reciente → antiguo también entre años", () => {
    const g = agruparViaticos([v(1, "2026-01-05"), v(2, "2025-12-30"), v(3, "2027-01-01")], "MES");
    expect(g.map((x) => x.clave)).toEqual(["2027-01", "2026-01", "2025-12"]);
  });

  it("conserva el orden de entrada dentro de cada grupo y no pierde viáticos (ni sin fecha válida)", () => {
    const g = agruparViaticos([v(9, "2026-09-24"), v(3, "2026-09-24"), v(5, "2026-09-24"), v(7, "no-es-fecha")], "DIA");
    expect(g[0].items.map((i) => i.id)).toEqual([9, 3, 5]);
    expect(g.at(-1)).toMatchObject({ clave: "SIN-FECHA", etiqueta: "Sin fecha", total: 1 });
    expect(g.reduce((n, x) => n + x.total, 0)).toBe(4);
  });

  it("sin viáticos -> sin grupos", () => {
    expect(agruparViaticos([], "MES")).toEqual([]);
  });
});

describe("filtrar primero, agrupar después", () => {
  it("los grupos reflejan SOLO las filas ya filtradas (un filtro que deja 2 filas produce grupos de esas 2)", () => {
    const todos = [v(1, "2026-09-24", "PROGRAMADO"), v(2, "2026-09-24", "AUTORIZADO"), v(3, "2026-09-25", "PROGRAMADO"), v(4, "2026-09-26", "RECHAZADO")];
    const filtrados = todos.filter((x) => x.estado === "PROGRAMADO"); // p. ej. la pestaña "Por autorizar"
    const g = agruparViaticos(filtrados, "DIA");
    expect(g.map((x) => [x.clave, x.total])).toEqual([["2026-09-25", 1], ["2026-09-24", 1]]);
    expect(g.flatMap((x) => x.items.map((i) => i.id))).toEqual([3, 1]);
    expect(agruparViaticos(todos.filter((x) => x.montoAsignado > 999), "MES")).toEqual([]);
  });

  it("el componente agrupa el resultado de `filtrados` (no de `items`)", () => {
    const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8");
    expect(src).toContain("agruparViaticos(filtrados, modoAgrupacion)");
    expect(src).not.toContain("agruparViaticos(items");
  });
});

describe("totales por grupo", () => {
  it("suma monto asignado y conteos por estado; RECHAZADO NO suma al monto pero se cuenta aparte", () => {
    const [g] = agruparViaticos([
      v(1, "2026-09-24", "PROGRAMADO", 100), v(2, "2026-09-24", "PROGRAMADO", 50.5), v(3, "2026-09-24", "AUTORIZADO", 200),
      v(4, "2026-09-24", "RECHAZADO", 999), v(5, "2026-09-24", "ENTREGADO", 300), v(6, "2026-09-24", "LIQUIDADO", 10),
    ], "DIA");
    expect(g.total).toBe(6);
    expect(g.montoNoRechazado).toBe(660.5); // sin el rechazado de 999
    expect(g.conteos).toEqual({ PROGRAMADO: 2, AUTORIZADO: 1, RECHAZADO: 1, ENTREGADO: 1, LIQUIDADO: 1 });
    expect(g.items).toHaveLength(6); // el rechazado sigue visible
  });

  it("un grupo solo de rechazados tiene monto 0 y su conteo", () => {
    const [g] = agruparViaticos([v(1, "2026-09-24", "RECHAZADO", 500)], "MES");
    expect(g.montoNoRechazado).toBe(0);
    expect(g.conteos.RECHAZADO).toBe(1);
  });

  it("sin errores de coma flotante al sumar centavos", () => {
    const [g] = agruparViaticos([v(1, "2026-09-24", "PROGRAMADO", 0.1), v(2, "2026-09-24", "PROGRAMADO", 0.2), v(3, "2026-09-24", "PROGRAMADO", 0.3)], "DIA");
    expect(g.montoNoRechazado).toBe(0.6);
  });

  it("encabezados: '35 viáticos · 30 pendientes · Q2,450.00'; 1 viático en singular; sin pendientes no los nombra", () => {
    const g35 = agruparViaticos([...Array.from({ length: 30 }, (_, i) => v(i + 1, "2026-09-24", "PROGRAMADO", 70)), ...Array.from({ length: 5 }, (_, i) => v(100 + i, "2026-09-24", "AUTORIZADO", 70))], "DIA")[0];
    expect(g35.total).toBe(35);
    expect(resumenGrupo(g35, q)).toBe("35 viáticos · 30 pendientes · Q2,450.00");
    const uno = agruparViaticos([v(1, "2026-09-24", "AUTORIZADO", 10)], "DIA")[0];
    expect(resumenGrupo(uno, q)).toBe("1 viático · Q10.00");
  });
});

describe("selección POR GRUPO", () => {
  const [hoy, ayer] = agruparViaticos([v(1, "2026-09-24"), v(2, "2026-09-24"), v(3, "2026-09-24"), v(4, "2026-09-23"), v(5, "2026-09-23")], "DIA");

  it("seleccionar individual", () => {
    const s = alternarEnSeleccion(new Set(), 2);
    expect([...s]).toEqual([2]);
    expect(seleccionadosDelGrupo(s, hoy)).toEqual([2]);
    expect([...alternarEnSeleccion(s, 2)]).toEqual([]); // desmarca
  });

  it("seleccionar todos del grupo NO toca otros grupos", () => {
    const s = seleccionarTodosDelGrupo(new Set(), hoy);
    expect(seleccionadosDelGrupo(s, hoy)).toEqual([1, 2, 3]);
    expect(seleccionadosDelGrupo(s, ayer)).toEqual([]);
    expect(grupoCompletoSeleccionado(s, hoy)).toBe(true);
    expect(grupoCompletoSeleccionado(s, ayer)).toBe(false);
  });

  it("limpiar el grupo quita solo sus ids: la selección de otro grupo se conserva", () => {
    const s = new Set([1, 2, 4]);
    const tras = limpiarSeleccionDelGrupo(s, hoy);
    expect([...tras]).toEqual([4]);
    expect(seleccionadosDelGrupo(tras, ayer)).toEqual([4]);
  });

  it("la selección del grupo A NO se autoriza al pulsar el botón del grupo B", () => {
    const s = new Set([1, 2]); // solo grupo A (hoy)
    expect(idsAAutorizarDelGrupo(s, hoy)).toEqual([1, 2]);
    expect(idsAAutorizarDelGrupo(s, ayer)).toEqual([]);
    const mixta = new Set([1, 4]);
    expect(idsAAutorizarDelGrupo(mixta, ayer)).toEqual([4]); // B solo autoriza lo suyo
    expect(idsAAutorizarDelGrupo(mixta, hoy)).toEqual([1]);
  });

  it("un id seleccionado que ya no está en el grupo (p. ej. tras recargar) no se envía", () => {
    expect(idsAAutorizarDelGrupo(new Set([999]), hoy)).toEqual([]);
  });
});
