import { describe, expect, it } from "vitest";
import {
  contarDiasHabilesPuro,
  reconstruirEmpleado,
  type EmpleadoReconstruccion,
  type ResultadoReconstruccion,
  type VacacionReconstruccion,
} from "./vacaciones-reconstruccion";
import { analizarTraslapes, calcularDiasAcumuladosProporcional, deIso } from "./vacaciones-periodos";

const HOY = new Date(2026, 9, 6); // 2026-10-06
const emp = (fechaAlta: string | null, extra: Partial<EmpleadoReconstruccion> = {}): EmpleadoReconstruccion => ({
  id: 1, codigo: "E-1", nombre: "Empleado Prueba", fechaAlta, fechaInicioLaboral: fechaAlta, ...extra,
});
const vac = (origen: number, inicio: string, fin: string, dias: number, tipo = "Vacaciones"): VacacionReconstruccion => ({ origen, inicio, fin, dias, tipo });
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const codigos = (r: ResultadoReconstruccion) => r.advertencias.map((a) => a.codigo);

describe("períodos regenerados desde la fecha base", () => {
  it("empleado con 1 año: 1 período completo de 15 días + el período en curso proporcional", () => {
    const r = reconstruirEmpleado(emp("2025-04-01"), [], HOY);
    expect(r.bloqueado).toBeNull();
    expect(r.periodos).toHaveLength(2);
    expect(r.periodos[0]).toMatchObject({ anioLaboral: 1, inicio: "2025-04-01", fin: "2026-03-31", otorgados: 15, disponibles: 15, estado: "Vigente", enCurso: false });
    expect(r.periodos[1]).toMatchObject({ anioLaboral: 2, inicio: "2026-04-01", fin: "2027-03-31", enCurso: true });
    expect(r.periodos[1].otorgados).toBeGreaterThan(0);
    expect(r.periodos[1].otorgados).toBeLessThan(15);
    expect(r.saldoFinal).toBe(sum([15, r.periodos[1].disponibles]));
  });

  it("empleado con 10 años: 15 días por cada año completo; los más antiguos quedan en el historial como vencidos", () => {
    const r = reconstruirEmpleado(emp("2016-03-15"), [], HOY);
    expect(r.periodos).toHaveLength(11);
    expect(r.periodos.slice(0, 10).every((p) => p.otorgados === 15)).toBe(true);
    expect(r.periodos.filter((p) => p.estado === "Vencido")).toHaveLength(8);
    expect(r.periodos.filter((p) => p.estado === "Vencido").every((p) => p.perdidosPorVencimiento === 15 && p.disponibles === 0)).toBe(true);
    expect(r.periodos.filter((p) => p.estado === "Vigente").map((p) => p.anioLaboral)).toEqual([9, 10, 11]);
  });

  it("período proporcional actual: usa la MISMA fórmula histórica del motor", () => {
    const r = reconstruirEmpleado(emp("2025-04-01"), [], HOY);
    expect(r.periodos[1].otorgados).toBe(calcularDiasAcumuladosProporcional(deIso("2026-04-01"), deIso("2027-03-31"), HOY, 15));
  });

  it("ejemplo del ticket: 13/04/2023 → 12/04/2024, 13/04/2024 → 12/04/2025, 13/04/2025 → 12/04/2026 (sin traslapes)", () => {
    const r = reconstruirEmpleado(emp("2023-04-13"), [], HOY);
    expect(r.periodos.slice(0, 3).map((p) => [p.inicio, p.fin])).toEqual([
      ["2023-04-13", "2024-04-12"], ["2024-04-13", "2025-04-12"], ["2025-04-13", "2026-04-12"],
    ]);
  });

  it("año bisiesto (29 de febrero): sin hueco ni traslape", () => {
    const r = reconstruirEmpleado(emp("2020-02-29"), [], HOY);
    expect(r.periodos.slice(0, 3).map((p) => [p.inicio, p.fin])).toEqual([
      ["2020-02-29", "2021-02-27"], ["2021-02-28", "2022-02-27"], ["2022-02-28", "2023-02-27"],
    ]);
    expect(r.periodos.find((p) => p.anioLaboral === 5)!.inicio).toBe("2024-02-29");
  });

  it("la reconstrucción simulada produce 0 traslapes (todos los empleados de prueba)", () => {
    for (const alta of ["2016-03-15", "2020-02-29", "2023-04-13", "2025-04-01", "2000-12-31"]) {
      const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-14", 10)], HOY);
      const filas = r.periodos.map((p, i) => ({ id: i + 1, anioLaboral: p.anioLaboral, inicio: p.inicio, fin: p.fin, otorgados: p.otorgados, disponibles: p.disponibles, estado: p.estado, conConsumo: p.consumidos > 0 }));
      expect(analizarTraslapes(filas), alta).toEqual([]);
      expect(new Set(r.periodos.map((p) => p.anioLaboral)).size).toBe(r.periodos.length); // sin años repetidos
    }
  });
});

describe("reaplicación cronológica con FIFO", () => {
  const alta = "2023-04-13";

  it("FIFO entre dos períodos: primero el más antiguo, luego el siguiente", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2024-12-02", "2024-12-17", 12)], HOY);
    expect(r.vacaciones.map((v) => [v.origen, v.consumido, v.deficit])).toEqual([[1, 10, 0], [2, 12, 0]]);
    expect(r.consumos).toEqual([
      { origen: 1, anioLaboral: 1, dias: 10, fecha: "2024-06-03" },
      { origen: 2, anioLaboral: 1, dias: 5, fecha: "2024-12-02" },
      { origen: 2, anioLaboral: 2, dias: 7, fecha: "2024-12-02" },
    ]);
  });

  it("varias vacaciones históricas: el resultado NO depende del orden de las filas del archivo (se ordena por fecha y origen)", () => {
    const base = [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2024-12-02", "2024-12-17", 12), vac(3, "2025-08-04", "2025-08-15", 8), vac(4, "2026-02-02", "2026-02-13", 6)];
    const a = reconstruirEmpleado(emp(alta), base, HOY);
    const b = reconstruirEmpleado(emp(alta), [...base].reverse(), HOY);
    expect(b).toEqual(a);
    expect(a.totalDiasHistorial).toBe(36);
    expect(a.advertencias.filter((w) => w.severidad === "DECISION")).toEqual([]);
  });

  it("desempate por origen cuando dos vacaciones empiezan el mismo día", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(7, "2024-06-03", "2024-06-05", 3), vac(5, "2024-06-03", "2024-06-04", 2)], HOY);
    expect(r.vacaciones.map((v) => v.origen)).toEqual([5, 7]);
  });

  it("vacación que CRUZA un aniversario: reparto por TRAMOS con fechas reales, FIFO por tramo; con saldo insuficiente exige decisión", () => {
    // Aniversario 2024-04-13 (sábado). Tramo 1: 2024-04-05..04-12 = 7 hábiles. Tramo 2: 2024-04-13..04-25 = 11 hábiles.
    // A la fecha del tramo 1 el año 1 aún está en curso (acumula proporcional); al 04-13 se completa (15) y el año 2 apenas empieza (0.05).
    // Disponible total = 15 (año 1) + 0.05 (año 2) = 15.05 < 18 → faltan 2.95. (Evaluar todo a la fecha de fin habría dado otro reparto.)
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-04-05", "2024-04-25", 18)], HOY);
    expect(contarDiasHabilesPuro("2024-04-05", "2024-04-12", new Set())).toBe(7);
    expect(contarDiasHabilesPuro("2024-04-13", "2024-04-25", new Set())).toBe(11);
    expect(r.consumos).toEqual([
      { origen: 1, anioLaboral: 1, dias: 7, fecha: "2024-04-05" },
      { origen: 1, anioLaboral: 1, dias: 8, fecha: "2024-04-13" },
      { origen: 1, anioLaboral: 2, dias: 0.05, fecha: "2024-04-13" },
    ]);
    expect(r.vacaciones[0].deficit).toBe(2.95);
    const w = r.advertencias.find((x) => x.codigo === "VACACION_CRUZA_ANIVERSARIO")!;
    expect(w.severidad).toBe("DECISION");
    expect(w.mensaje).toContain("2024-04-13");
    expect(w.mensaje).toContain("PROVISIONAL");
    expect(codigos(r)).toContain("SALDO_INSUFICIENTE");
  });

  it("cruce con saldo suficiente en ambos tramos: sin faltante y sigue exigiendo decisión", () => {
    // alta 2023-04-13; vacación 2025-04-07..04-19 cruza 2025-04-13: 6 hábiles antes y 6 después, todo del año 1 (el más antiguo, FIFO)
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2025-04-07", "2025-04-19", 12)], HOY);
    expect(r.consumos).toEqual([
      { origen: 1, anioLaboral: 1, dias: 6, fecha: "2025-04-07" },
      { origen: 1, anioLaboral: 1, dias: 6, fecha: "2025-04-13" },
    ]);
    expect(r.vacaciones[0].deficit).toBe(0);
    expect(codigos(r)).toContain("VACACION_CRUZA_ANIVERSARIO");
    expect(codigos(r)).not.toContain("SALDO_INSUFICIENTE");
  });

  it("cruce de aniversario: los días ANTERIORES no pueden consumir el período que aún no existía", () => {
    // Empleado con un solo período completado antes del aniversario: año 1 = 15 días. Vacación 2024-04-08..04-20 (cruza 2024-04-13),
    // 5 hábiles antes (8-12) y 6 después (13-20 sin domingo 14: 13,15,16,17,18,19,20 = 7). Tramo 1 solo puede usar el año 1.
    const r = reconstruirEmpleado(emp("2023-04-13"), [vac(1, "2024-04-08", "2024-04-20", 12)], HOY);
    const antes = r.consumos.filter((c) => c.fecha === "2024-04-08");
    expect(antes.every((c) => c.anioLaboral === 1)).toBe(true);
    expect(sum(antes.map((c) => c.dias))).toBe(5);
    const despues = r.consumos.filter((c) => c.fecha === "2024-04-13");
    expect(sum(despues.map((c) => c.dias))).toBe(7);
    expect(sum(r.consumos.map((c) => c.dias))).toBe(12);
  });

  it("vacación SIN cruce de aniversario: no emite VACACION_CRUZA_ANIVERSARIO y consume a la fecha de inicio", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-14", 10)], HOY);
    expect(codigos(r)).not.toContain("VACACION_CRUZA_ANIVERSARIO");
    expect(r.consumos.every((c) => c.fecha === "2024-06-03")).toBe(true);
  });

  it("vacación que EMPIEZA el día del aniversario no se considera cruce", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-04-13", "2024-04-25", 11)], HOY);
    expect(codigos(r)).not.toContain("VACACION_CRUZA_ANIVERSARIO");
  });

  it("el cruce usa los feriados recibidos para contar los días hábiles de cada tramo", () => {
    const sin = reconstruirEmpleado(emp(alta), [vac(1, "2024-04-08", "2024-04-20", 11)], HOY, new Set());
    const con = reconstruirEmpleado(emp(alta), [vac(1, "2024-04-08", "2024-04-20", 11)], HOY, new Set(["2024-04-09"]));
    // con feriado en el tramo previo (5 → 4 hábiles) el reparto cambia, el total no
    expect(sum(sin.consumos.filter((c) => c.fecha === "2024-04-08").map((c) => c.dias))).toBe(5);
    expect(sum(con.consumos.filter((c) => c.fecha === "2024-04-08").map((c) => c.dias))).toBe(4);
    expect(sum(con.consumos.map((c) => c.dias))).toBe(11);
  });

  it("SUMA del detalle FIFO = días tomados, por vacación y en total", () => {
    const hist = [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2024-12-02", "2024-12-17", 12), vac(3, "2025-08-04", "2025-08-15", 8)];
    const r = reconstruirEmpleado(emp(alta), hist, HOY);
    for (const v of r.vacaciones) expect(sum(r.consumos.filter((c) => c.origen === v.origen).map((c) => c.dias))).toBe(v.dias);
    expect(sum(r.consumos.map((c) => c.dias))).toBe(sum(hist.map((h) => h.dias)));
    expect(sum(r.periodos.map((p) => p.consumidos))).toBe(30);
  });

  it("saldo insuficiente a esa fecha: NO se descarta la vacación; consume lo disponible y exige decisión de RRHH", () => {
    const r = reconstruirEmpleado(emp("2026-03-01"), [vac(1, "2026-04-06", "2026-04-17", 10)], HOY);
    expect(codigos(r)).toContain("SALDO_INSUFICIENTE");
    expect(r.vacaciones[0].deficit).toBeGreaterThan(0);
    expect(r.vacaciones[0].consumido + r.vacaciones[0].deficit).toBe(10);
    expect(r.advertencias.find((a) => a.codigo === "SALDO_INSUFICIENTE")!.severidad).toBe("DECISION");
  });

  it("vacaciones superpuestas: ERROR + empleado BLOQUEADO; no se simula (sin consumos ni saldo) y se informan filas, fechas y días", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2024-06-10", "2024-06-21", 10)], HOY);
    const w = r.advertencias.find((x) => x.codigo === "VACACIONES_SUPERPUESTAS")!;
    expect(w.severidad).toBe("ERROR");
    expect(w.dias).toBe(5); // 10..14 de junio
    expect(w.mensaje).toContain("2024-06-03");
    expect(w.mensaje).toContain("2024-06-21");
    expect(w.mensaje).toContain("no es confiable");
    expect(r.bloqueado).toBe("VACACIONES_SUPERPUESTAS");
    expect(r.consumos).toEqual([]);
    expect(r.periodos).toEqual([]);
    expect(r.saldoFinal).toBe(0);
    expect(r.vacaciones.map((v) => [v.consumido, v.deficit, v.excluida])).toEqual([[0, 0, "EMPLEADO_BLOQUEADO"], [0, 0, "EMPLEADO_BLOQUEADO"]]);
    expect(r.totalDiasHistorial).toBe(20); // las filas siguen visibles en el reporte
  });

  it("A cruza un aniversario y B empieza DENTRO de A: se detecta la superposición y NO se simula (el orden cronológico no es confiable)", () => {
    // A = 2024-04-05..04-25 (cruza el aniversario 2024-04-13); B = 2024-04-10..04-12 empieza dentro de A (después de A por fecha_inicio,
    // pero su fecha real es anterior al avance interno de A hasta el 13/04).
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-04-05", "2024-04-25", 18), vac(2, "2024-04-10", "2024-04-12", 3)], HOY);
    expect(r.bloqueado).toBe("VACACIONES_SUPERPUESTAS");
    expect(r.advertencias.filter((x) => x.codigo === "VACACIONES_SUPERPUESTAS")).toHaveLength(1);
    expect(r.advertencias.find((x) => x.codigo === "VACACIONES_SUPERPUESTAS")!.dias).toBe(3);
    expect(r.consumos).toEqual([]);
    expect(codigos(r)).not.toContain("VACACION_CRUZA_ANIVERSARIO"); // nunca se llegó a repartir
    expect(r.saldoFinal).toBe(0);
  });

  it("un empleado sin superposición no se bloquea aunque tenga vacaciones contiguas (fin de una = día anterior al inicio de la otra)", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-07", 5), vac(2, "2024-06-08", "2024-06-14", 6)], HOY);
    expect(r.bloqueado).toBeNull();
    expect(codigos(r)).not.toContain("VACACIONES_SUPERPUESTAS");
  });

  it("vacación anterior a la fecha base: no consume saldo y se advierte", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2023-01-02", "2023-01-10", 6)], HOY);
    expect(r.vacaciones[0].excluida).toBe("ANTERIOR_A_FECHA_BASE");
    expect(r.consumos).toEqual([]);
    expect(codigos(r)).toContain("VACACION_ANTERIOR_A_FECHA_BASE");
  });

  it("vacación FUTURA (archivo = solo vacaciones ya tomadas): ERROR, no consume saldo, no genera FIFO y queda visible", () => {
    const sin = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-14", 10)], HOY);
    const con = reconstruirEmpleado(emp(alta), [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2026-12-01", "2026-12-12", 8)], HOY);
    const w = con.advertencias.find((x) => x.codigo === "VACACION_FUTURA")!;
    expect(w.severidad).toBe("ERROR");
    expect(w.origen).toBe(2);
    expect(w.mensaje).toContain("únicamente vacaciones ya tomadas");
    expect(w.mensaje).toContain("No se incluyó en el saldo simulado");
    const futura = con.vacaciones.find((v) => v.origen === 2)!; // sigue en el reporte
    expect(futura.excluida).toBe("VACACION_FUTURA");
    expect(futura.consumido).toBe(0);
    expect(futura.deficit).toBe(0);
    expect(con.consumos.some((c) => c.origen === 2)).toBe(false);
    // el saldo y los períodos son EXACTAMENTE los de la reconstrucción sin la fila futura
    expect(con.saldoFinal).toBe(sin.saldoFinal);
    expect(con.periodos).toEqual(sin.periodos);
    expect(con.resumenDias).toEqual(sin.resumenDias);
    expect(con.totalDiasHistorial).toBe(18); // la fila se conserva en el total del archivo
  });

  it("vacación futura sola: saldo intacto, sin consumos, sin faltante", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2026-12-01", "2026-12-12", 8)], HOY);
    const base = reconstruirEmpleado(emp(alta), [], HOY);
    expect(r.consumos).toEqual([]);
    expect(r.saldoFinal).toBe(base.saldoFinal);
    expect(r.vacaciones[0]).toMatchObject({ excluida: "VACACION_FUTURA", consumido: 0, deficit: 0 });
    expect(codigos(r)).not.toContain("SALDO_INSUFICIENTE");
  });

  it("una vacación que empieza HOY no es futura", () => {
    const r = reconstruirEmpleado(emp(alta), [vac(1, "2026-10-06", "2026-10-09", 4)], HOY);
    expect(codigos(r)).not.toContain("VACACION_FUTURA");
    expect(r.vacaciones[0].consumido).toBe(4);
  });
});

describe("tope de 30 y vencimiento", () => {
  it("el saldo utilizable final nunca supera 30 días (tope de 2 períodos), sin importar los años", () => {
    for (const alta of ["2016-03-15", "2021-01-10", "2023-04-13", "2024-09-01"]) {
      const r = reconstruirEmpleado(emp(alta), [], HOY);
      expect(r.saldoFinal, alta).toBeLessThanOrEqual(30);
    }
  });

  it("el excedente del período en curso se recorta del período completo más viejo (15 + 15 + proporcional → 30)", () => {
    const r = reconstruirEmpleado(emp("2023-04-13"), [], HOY);
    const recortados = sum(r.periodos.map((p) => p.recortadosPorTope));
    expect(recortados).toBeGreaterThan(0);
    expect(r.saldoFinal).toBe(30);
  });

  it("período vencido: los días no tomados se pierden (disponibles 0) pero otorgados y consumidos quedan en el historial", () => {
    const r = reconstruirEmpleado(emp("2020-06-01"), [vac(1, "2021-03-01", "2021-03-12", 10)], HOY);
    const p1 = r.periodos.find((p) => p.anioLaboral === 1)!;
    expect(p1).toMatchObject({ estado: "Vencido", otorgados: 15, consumidos: 10, disponibles: 0, perdidosPorVencimiento: 5 });
  });
});

describe("casos que bloquean o informan", () => {
  it("fecha base inválida (sin fecha de alta): BLOQUEANTE, sin períodos", () => {
    const r = reconstruirEmpleado(emp(null), [vac(1, "2024-06-03", "2024-06-14", 10)], HOY);
    expect(r.bloqueado).toBe("SIN_FECHA_BASE");
    expect(r.periodos).toEqual([]);
    expect(r.advertencias[0].severidad).toBe("BLOQUEANTE");
  });

  it("ELISA (fecha_alta 1899-12-31): BLOQUEANTE; no se reconstruye ni se generan 127 períodos", () => {
    const r = reconstruirEmpleado(emp("1899-12-31", { id: 37, nombre: "Elisa Jiménez López" }), [vac(1, "2025-06-02", "2025-06-13", 10)], HOY);
    expect(r.bloqueado).toBe("FECHA_SOSPECHOSA");
    expect(r.periodos).toEqual([]);
    expect(r.consumos).toEqual([]);
    expect(r.vacaciones[0].excluida).toBe("EMPLEADO_BLOQUEADO");
    expect(r.advertencias[0]).toMatchObject({ codigo: "FECHA_SOSPECHOSA", severidad: "BLOQUEANTE" });
    expect(r.totalDiasHistorial).toBe(10);
  });

  it("fecha de alta futura: BLOQUEANTE", () => {
    expect(reconstruirEmpleado(emp("2027-01-01"), [], HOY).bloqueado).toBe("FECHA_FUTURA");
  });

  it("AMÍLCAR (fecha_inicio_laboral 13/02/2023 ≠ fecha_alta 13/04/2023): reconstruye según fecha_alta y advierte la diferencia", () => {
    const r = reconstruirEmpleado(emp("2023-04-13", { id: 14, fechaInicioLaboral: "2023-02-13" }), [vac(1, "2024-06-03", "2024-06-14", 10)], HOY);
    expect(r.bloqueado).toBeNull();
    expect(r.periodos[0]).toMatchObject({ inicio: "2023-04-13", fin: "2024-04-12" }); // base = fecha_alta, NO fecha_inicio_laboral
    const aviso = r.advertencias.find((a) => a.codigo === "FECHA_INICIO_LABORAL_DISTINTA")!;
    expect(aviso.severidad).toBe("INFO");
    expect(aviso.mensaje).toContain("Diferencia entre fecha entrada laboral y base de vacaciones");
  });

  it("si fecha_alta = fecha_inicio_laboral NO hay advertencia de diferencia", () => {
    expect(codigos(reconstruirEmpleado(emp("2023-04-13"), [], HOY))).not.toContain("FECHA_INICIO_LABORAL_DISTINTA");
  });
});

describe("determinismo e idempotencia", () => {
  it("reconstruir dos veces el mismo historial produce EXACTAMENTE el mismo resultado", () => {
    const hist = [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2024-12-02", "2024-12-17", 12)];
    const a = reconstruirEmpleado(emp("2023-04-13"), hist, HOY);
    const b = reconstruirEmpleado(emp("2023-04-13"), hist, HOY);
    expect(b).toEqual(a);
  });

  it("no muta el historial de entrada", () => {
    const hist = [vac(2, "2024-12-02", "2024-12-17", 12), vac(1, "2024-06-03", "2024-06-14", 10)];
    const copia = JSON.parse(JSON.stringify(hist));
    reconstruirEmpleado(emp("2023-04-13"), hist, HOY);
    expect(hist).toEqual(copia);
  });

  it("el motor es PURO: reconstruye un empleado completo sin depender de filas viejas (no recibe saldos ni detalle)", () => {
    expect(reconstruirEmpleado.length).toBe(3); // (empleado, historial, hoy) + feriados opcionales: ninguna fuente de saldos/consumos viejos
  });
});

describe("días hábiles calculados (misma regla que contarDiasHabiles)", () => {
  it("excluye domingos y feriados", () => {
    expect(contarDiasHabilesPuro("2024-06-03", "2024-06-09", new Set())).toBe(6); // lun-dom: 6 (sin domingo)
    expect(contarDiasHabilesPuro("2024-06-03", "2024-06-09", new Set(["2024-06-05"]))).toBe(5);
    expect(contarDiasHabilesPuro("2024-06-10", "2024-06-03", new Set())).toBe(0);
  });
});

describe("otorgado / consumido / saldo utilizable (el historial no se descarta por vencimiento posterior)", () => {
  it("otorgado = consumido + recortado por tope + perdido por vencimiento + saldo utilizable", () => {
    const hist = [vac(1, "2024-06-03", "2024-06-14", 10), vac(2, "2025-08-04", "2025-08-15", 8)];
    for (const alta of ["2023-04-13", "2016-03-15", "2020-02-29"]) {
      const r = reconstruirEmpleado(emp(alta), hist, HOY);
      const d = r.resumenDias;
      expect(sum([d.consumido, d.recortadoPorTope, d.perdidoPorVencimiento, d.saldoUtilizable])).toBe(d.otorgado);
    }
  });

  it("una vacación antigua se conserva aunque su período hoy esté vencido (se explica cronológicamente)", () => {
    // alta 2016-03-15: en 2017 el año 1 estaba vigente; hoy (2026) está vencido, pero su consumo histórico NO se pierde.
    const r = reconstruirEmpleado(emp("2016-03-15"), [vac(1, "2017-05-02", "2017-05-12", 9)], HOY);
    expect(r.vacaciones[0].excluida).toBeNull();
    expect(r.vacaciones[0].consumido).toBe(9);
    expect(r.vacaciones[0].deficit).toBe(0);
    const p1 = r.periodos.find((p) => p.anioLaboral === 1)!;
    expect(p1.estado).toBe("Vencido");
    expect(p1.consumidos).toBe(9);
    expect(p1.perdidosPorVencimiento).toBe(6); // 15 otorgados − 9 tomados
    expect(r.resumenDias.consumido).toBe(9);
  });

  it("el empleado bloqueado no genera desglose de días", () => {
    const r = reconstruirEmpleado(emp(null), [vac(1, "2024-06-03", "2024-06-14", 10)], HOY);
    expect(r.resumenDias).toEqual({ otorgado: 0, consumido: 0, recortadoPorTope: 0, perdidoPorVencimiento: 0, saldoUtilizable: 0 });
  });
});

describe("reparto manual aprobado por RRHH (vacación que cruza un aniversario)", () => {
  const alta = "2022-10-30";
  const v = [vac(1, "2025-10-20", "2025-11-05", 15)];

  it("sin reparto manual: decisión pendiente (propuesta FIFO por tramos)", () => {
    const r = reconstruirEmpleado(emp(alta), v, HOY);
    expect(codigos(r)).toContain("VACACION_CRUZA_ANIVERSARIO");
    expect(r.advertencias.find((a) => a.codigo === "VACACION_CRUZA_ANIVERSARIO")!.severidad).toBe("DECISION");
  });

  it("con reparto manual: consume exactamente los días indicados de cada año laboral y la advertencia pasa a INFO", () => {
    const r = reconstruirEmpleado(emp(alta), v, HOY, new Set(), { repartoManual: new Map([[1, [{ anioLaboral: 2, dias: 10 }, { anioLaboral: 3, dias: 5 }]]]) });
    expect(r.consumos.map((c) => [c.anioLaboral, c.dias])).toEqual([[2, 10], [3, 5]]);
    expect(codigos(r)).not.toContain("VACACION_CRUZA_ANIVERSARIO");
    expect(r.advertencias.find((a) => a.codigo === "REPARTO_MANUAL_APLICADO")!.severidad).toBe("INFO");
    expect(r.vacaciones[0]).toMatchObject({ consumido: 15, deficit: 0 });
    expect(r.advertencias.some((a) => a.severidad === "DECISION")).toBe(false);
  });

  it("un reparto manual que pide más de lo disponible en un año genera SALDO_INSUFICIENTE (nueva decisión), nunca consume de otro año en silencio", () => {
    const r = reconstruirEmpleado(emp(alta), v, HOY, new Set(), { repartoManual: new Map([[1, [{ anioLaboral: 4, dias: 15 }]]]) });
    expect(r.vacaciones[0].deficit).toBeGreaterThan(0);
    expect(codigos(r)).toContain("SALDO_INSUFICIENTE");
    expect(r.consumos.every((c) => c.anioLaboral === 4)).toBe(true);
  });
});
