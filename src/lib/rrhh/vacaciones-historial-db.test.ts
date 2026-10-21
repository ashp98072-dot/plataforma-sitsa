import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Motor de vacaciones contra una BD EN MEMORIA que respeta lo que ejecuta el código real (INSERT IGNORE / UPDATE / SELECT de
 * saldos_vacaciones y detalle_consumo_vacaciones). Verifica historial completo, FIFO, vencimiento, tope de 30, idempotencia
 * y que NUNCA se borra un saldo.
 */
type Saldo = { id: number; empresa_id: number; id_empleado: number; anio_laboral: number | null; periodo_inicio: string; periodo_fin: string; dias_otorgados: number; dias_disponibles: number; estado: string };
type Detalle = { incidencia_id: number; saldo_id: number; dias_tomados: number };

const mem = vi.hoisted(() => ({
  fechaAlta: "2016-03-15" as string | null,
  saldos: [] as Saldo[],
  detalles: [] as Detalle[],
  ejecutados: [] as { sql: string; params: unknown[] }[],
  siguienteId: 1,
  incidenciaId: 500,
}));

function responder(sql: string, params: unknown[] = []): [unknown[]] {
  if (sql.includes("SELECT fecha_alta FROM empleados")) return [mem.fechaAlta ? [{ fecha_alta: mem.fechaAlta }] : []];
  if (sql.includes("FROM detalle_consumo_vacaciones d") && sql.includes("SELECT DISTINCT d.saldo_id")) {
    return [[...new Set(mem.detalles.map((d) => d.saldo_id))].map((saldo_id) => ({ saldo_id }))];
  }
  if (sql.includes("FROM saldos_vacaciones s") && sql.includes("dias_consumidos")) {
    return [[...mem.saldos].sort((a, b) => (a.anio_laboral ?? 99999) - (b.anio_laboral ?? 99999) || a.periodo_inicio.localeCompare(b.periodo_inicio) || a.id - b.id)
      .map((s) => ({ ...s, dias_consumidos: mem.detalles.filter((d) => d.saldo_id === s.id).reduce((x, d) => x + d.dias_tomados, 0) }))];
  }
  if (sql.includes("FROM saldos_vacaciones") && sql.includes("estado = 'Vigente' AND dias_disponibles > 0")) {
    return [mem.saldos.filter((s) => s.estado === "Vigente" && s.dias_disponibles > 0).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0))];
  }
  if (sql.includes("FROM saldos_vacaciones") && sql.includes("ORDER BY anio_laboral DESC")) {
    return [[...mem.saldos].sort((a, b) => (b.anio_laboral ?? 0) - (a.anio_laboral ?? 0))];
  }
  if (sql.includes("FROM saldos_vacaciones") && sql.includes("FOR UPDATE")) return [mem.saldos.map((s) => ({ ...s }))];
  if (sql.includes("FROM saldos_vacaciones") && sql.includes("estado = 'Vigente'")) {
    return [mem.saldos.filter((s) => s.estado === "Vigente").sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0))];
  }
  void params;
  return [[]];
}

function ejecutar(sql: string, params: unknown[] = []): [{ insertId: number; affectedRows: number }] {
  mem.ejecutados.push({ sql, params });
  if (sql.includes("INSERT IGNORE INTO saldos_vacaciones")) {
    const [emp, idEmp, anio, inicio, fin, otorg, disp] = params as [number, number, number, string, string, number, number];
    if (!mem.saldos.some((s) => s.id_empleado === idEmp && s.periodo_inicio === inicio && s.periodo_fin === fin)) {
      mem.saldos.push({ id: mem.siguienteId++, empresa_id: emp, id_empleado: idEmp, anio_laboral: anio, periodo_inicio: inicio, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp, estado: "Vigente" });
    }
  } else if (sql.includes("SET periodo_inicio = ?")) {
    const [inicio, fin, otorg, disp, id] = params as [string, string, number, number, number];
    Object.assign(mem.saldos.find((s) => s.id === id)!, { periodo_inicio: inicio, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp });
  } else if (sql.includes("SET estado = 'Vencido'")) {
    Object.assign(mem.saldos.find((s) => s.id === (params[0] as number))!, { estado: "Vencido", dias_disponibles: 0 });
  } else if (sql.includes("SET dias_disponibles = ? WHERE id = ?")) {
    Object.assign(mem.saldos.find((s) => s.id === (params[1] as number))!, { dias_disponibles: params[0] as number });
  } else if (sql.includes("INSERT INTO detalle_consumo_vacaciones")) {
    const [incidencia_id, saldo_id, dias_tomados] = params as number[];
    mem.detalles.push({ incidencia_id, saldo_id, dias_tomados });
  }
  return [{ insertId: mem.incidenciaId++, affectedRows: 1 }];
}

vi.mock("@/lib/db", () => {
  const conn = {
    beginTransaction: vi.fn(async () => undefined), commit: vi.fn(async () => undefined), rollback: vi.fn(async () => undefined), release: vi.fn(),
    query: vi.fn(async (sql: string, params?: unknown[]) => responder(sql, params)),
    execute: vi.fn(async (sql: string, params?: unknown[]) => ejecutar(sql, params)),
  };
  return { getPool: () => ({ getConnection: async () => conn }), query: vi.fn(async (sql: string, params?: unknown[]) => responder(sql, params)[0]) };
});

import { obtenerHistorialPeriodos, registrarVacacionesFifoEnConexion, sincronizarPeriodosVacaciones } from "./vacaciones";
import { getPool } from "@/lib/db";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0)); // 2026-10-06 (hora local)
  mem.fechaAlta = "2016-03-15"; mem.saldos = []; mem.detalles = []; mem.ejecutados = []; mem.siguienteId = 1; mem.incidenciaId = 500;
});
afterEach(() => vi.useRealTimers());

const sync = () => sincronizarPeriodosVacaciones(7, 1);
const sqlEjecutado = () => mem.ejecutados.map((e) => e.sql).join("\n");

describe("historial completo (BD en memoria)", () => {
  it("empleado con 10+ períodos: se conservan TODOS (los antiguos quedan Vencidos, no se borran) y no hay traslapes", async () => {
    await sync();
    expect(mem.saldos).toHaveLength(11); // 10 completos + 1 en curso
    expect(mem.saldos.filter((s) => s.estado === "Vencido")).toHaveLength(8);
    expect(sqlEjecutado()).not.toMatch(/DELETE\s+FROM\s+saldos_vacaciones/i);
    const ordenados = [...mem.saldos].sort((a, b) => a.periodo_inicio.localeCompare(b.periodo_inicio));
    for (let i = 1; i < ordenados.length; i++) {
      const fin = new Date(ordenados[i - 1].periodo_fin + "T00:00:00"); fin.setDate(fin.getDate() + 1);
      expect(ordenados[i].periodo_inicio).toBe(`${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, "0")}-${String(fin.getDate()).padStart(2, "0")}`);
    }
  });

  it("empleado con 1 período: una sola fila, en curso", async () => {
    mem.fechaAlta = "2026-04-01";
    await sync();
    expect(mem.saldos).toHaveLength(1);
    expect(mem.saldos[0]).toMatchObject({ anio_laboral: 1, periodo_inicio: "2026-04-01", periodo_fin: "2027-03-31", estado: "Vigente" });
  });

  it("vencimiento y tope de 30 siguen vigentes: solo 2 períodos completos utilizables (+ el en curso)", async () => {
    await sync();
    const vigentes = mem.saldos.filter((s) => s.estado === "Vigente");
    expect(vigentes.map((s) => s.anio_laboral).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([9, 10, 11]);
    const completos = vigentes.filter((s) => s.anio_laboral !== 11).reduce((x, s) => x + s.dias_disponibles, 0);
    const total = vigentes.reduce((x, s) => x + s.dias_disponibles, 0);
    expect(completos).toBeLessThanOrEqual(30);
    expect(Math.round(total * 100) / 100).toBeLessThanOrEqual(30); // el excedente del período en curso se recorta del más viejo
  });

  it("período vencido: dias_disponibles = 0 pero conserva los otorgados en el historial", async () => {
    await sync();
    const vencido = mem.saldos.find((s) => s.estado === "Vencido")!;
    expect(vencido.dias_disponibles).toBe(0);
    expect(vencido.dias_otorgados).toBe(15);
  });

  it("NO DUPLICA: sincronizar dos veces no inserta ningún período nuevo", async () => {
    await sync();
    const antes = mem.saldos.length;
    mem.ejecutados = [];
    await sync();
    expect(mem.saldos).toHaveLength(antes);
    expect(mem.ejecutados.filter((e) => e.sql.includes("INSERT IGNORE"))).toHaveLength(0);
  });

  it("fecha laboral sospechosa (Elisa, 1899-12-31): no se escribe NADA", async () => {
    mem.fechaAlta = "1899-12-31";
    mem.saldos = [{ id: 1, empresa_id: 7, id_empleado: 1, anio_laboral: 127, periodo_inicio: "2026-01-01", periodo_fin: "2026-12-30", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" }];
    mem.siguienteId = 2;
    const r = await sync();
    expect(mem.ejecutados).toEqual([]);
    expect(mem.saldos).toHaveLength(1);
    expect(r.advertencias.map((a) => a.codigo)).toContain("FECHA_LABORAL_SOSPECHOSA");
  });

  it("cambio de fecha laboral CON consumo: CONGELACIÓN TOTAL — ningún INSERT/UPDATE de saldos, sin vencimientos ni tope, detalle intacto", async () => {
    await sync();
    const consumido = mem.saldos.find((s) => s.anio_laboral === 10)!;
    mem.detalles.push({ incidencia_id: 24, saldo_id: consumido.id, dias_tomados: 9 });
    consumido.dias_disponibles = 6;
    const saldosAntes = JSON.parse(JSON.stringify(mem.saldos));
    const detalleAntes = JSON.parse(JSON.stringify(mem.detalles));
    mem.fechaAlta = "2016-02-10"; // RRHH cambió la fecha laboral: la serie con consumo ya no coincide
    mem.ejecutados = [];
    const r = await sync();
    expect(r.requiereReparacion).toBe(true);
    expect(r.omitido).toBe("SERIE_HISTORICA_CON_CONSUMO");
    expect(r.advertencias.map((a) => a.codigo)).toContain("SERIE_HISTORICA_CON_CONSUMO");
    expect(mem.ejecutados).toEqual([]); // NINGUNA escritura: ni INSERT, ni UPDATE (fechas, estado Vencido, dias_disponibles = 0, tope)
    expect(mem.saldos).toEqual(saldosAntes);
    expect(mem.detalles).toEqual(detalleAntes);
    expect(mem.saldos.find((s) => s.id === consumido.id)!.dias_disponibles).toBe(6);
  });

  it("congelado: un saldo SIN consumo de la misma serie vieja tampoco se realinea ni se vence, y no se crean períodos futuros", async () => {
    mem.fechaAlta = "2024-05-31";
    await sync();
    const antes = mem.saldos.length;
    mem.detalles.push({ incidencia_id: 7, saldo_id: mem.saldos[0].id, dias_tomados: 3 });
    mem.saldos[0].dias_disponibles = 12;
    const foto = JSON.parse(JSON.stringify(mem.saldos));
    mem.fechaAlta = "2024-04-13";
    mem.ejecutados = [];
    await sync();
    expect(mem.ejecutados).toEqual([]);
    expect(mem.saldos).toHaveLength(antes);
    expect(mem.saldos).toEqual(foto);
  });

  it("5) idempotencia del estado bloqueado: sincronizar varias veces no cambia nada ni escribe", async () => {
    await sync();
    mem.detalles.push({ incidencia_id: 24, saldo_id: mem.saldos.find((s) => s.anio_laboral === 10)!.id, dias_tomados: 9 });
    mem.fechaAlta = "2016-02-10";
    const foto = JSON.parse(JSON.stringify(mem.saldos));
    mem.ejecutados = [];
    for (let i = 0; i < 3; i++) await sync();
    expect(mem.ejecutados).toEqual([]);
    expect(mem.saldos).toEqual(foto);
  });

  it("SERIE CORRECTA + consumo: el historial sigue creciendo con normalidad y se aplican vencimiento y tope (sin bloqueo global)", async () => {
    mem.fechaAlta = "2024-10-31";
    mem.saldos = [{ id: 1, empresa_id: 7, id_empleado: 1, anio_laboral: 1, periodo_inicio: "2024-10-31", periodo_fin: "2025-10-30", dias_otorgados: 15, dias_disponibles: 5, estado: "Vigente" }];
    mem.siguienteId = 2;
    mem.detalles = [{ incidencia_id: 24, saldo_id: 1, dias_tomados: 10 }];
    const r = await sync();
    expect(r.requiereReparacion).toBe(false);
    expect(mem.saldos.find((s) => s.id === 1)).toMatchObject({ dias_otorgados: 15, dias_disponibles: 5, periodo_inicio: "2024-10-31", periodo_fin: "2025-10-30" });
    expect(mem.saldos.find((s) => s.anio_laboral === 2)).toMatchObject({ periodo_inicio: "2025-10-31", periodo_fin: "2026-10-30" });
    expect(mem.detalles).toEqual([{ incidencia_id: 24, saldo_id: 1, dias_tomados: 10 }]);
  });

  it("FAIL-SAFE de estructura (año laboral duplicado): no se escribe nada, tampoco vencimientos ni tope", async () => {
    mem.fechaAlta = "2024-10-31";
    mem.saldos = [
      { id: 1, empresa_id: 7, id_empleado: 1, anio_laboral: 1, periodo_inicio: "2024-10-31", periodo_fin: "2025-10-30", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
      { id: 2, empresa_id: 7, id_empleado: 1, anio_laboral: 1, periodo_inicio: "2024-11-30", periodo_fin: "2025-11-29", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
    ];
    mem.siguienteId = 3;
    const r = await sync();
    expect(r.omitido).toBe("ESTRUCTURA_INCONSISTENTE");
    expect(mem.ejecutados).toEqual([]);
  });

  it("el historial sigue legible con el empleado congelado y lo señala (requiereReparacion)", async () => {
    await sync();
    mem.detalles.push({ incidencia_id: 24, saldo_id: mem.saldos.find((s) => s.anio_laboral === 10)!.id, dias_tomados: 9 });
    mem.fechaAlta = "2016-02-10";
    mem.ejecutados = [];
    const h = await obtenerHistorialPeriodos(7, 1);
    expect(h.requiereReparacion).toBe(true);
    expect(h.periodos).toHaveLength(11); // la lectura continúa
    expect(h.advertencias.some((a) => a.bloqueante)).toBe(true);
    expect(mem.ejecutados).toEqual([]);
  });

  it("cambio de fecha laboral SIN consumo: se realinea sin crear una segunda serie encima", async () => {
    mem.fechaAlta = "2024-05-31";
    await sync();
    mem.fechaAlta = "2024-04-13";
    await sync();
    const porAnio = new Map<number | null, number>();
    for (const s of mem.saldos) porAnio.set(s.anio_laboral, (porAnio.get(s.anio_laboral) ?? 0) + 1);
    expect([...porAnio.values()].every((n) => n === 1)).toBe(true);
    expect(mem.saldos.find((s) => s.anio_laboral === 1)).toMatchObject({ periodo_inicio: "2024-04-13", periodo_fin: "2025-04-12" });
  });
});

describe("FIFO entre varios períodos (semántica sin cambios)", () => {
  const saldo = (id: number, anio: number, disp: number): Saldo => ({ id, empresa_id: 7, id_empleado: 1, anio_laboral: anio, periodo_inicio: `20${20 + anio}-01-01`, periodo_fin: `20${20 + anio}-12-31`, dias_otorgados: 15, dias_disponibles: disp, estado: "Vigente" });

  it("una incidencia que consume 2 saldos conserva incidencia_id, saldo_id y dias_tomados exactos (ej. 9 + 1)", async () => {
    mem.saldos = [saldo(69, 1, 9), saldo(70, 2, 15)];
    const conn = await getPool().getConnection();
    const r = await registrarVacacionesFifoEnConexion(conn, { empresaId: 7, idEmpleado: 1, fechaInicio: "2026-10-01", fechaFin: "2026-10-12", diasATomar: 10 });
    expect(r.ok).toBe(true);
    expect(mem.detalles).toEqual([{ incidencia_id: r.incidenciaId, saldo_id: 69, dias_tomados: 9 }, { incidencia_id: r.incidenciaId, saldo_id: 70, dias_tomados: 1 }]);
    expect(mem.saldos.find((s) => s.id === 69)!.dias_disponibles).toBe(0);
    expect(mem.saldos.find((s) => s.id === 70)!.dias_disponibles).toBe(14);
  });

  it("consume del año laboral más antiguo primero, aunque haya muchos períodos", async () => {
    mem.saldos = [saldo(3, 3, 15), saldo(1, 1, 4), saldo(2, 2, 15)];
    const conn = await getPool().getConnection();
    await registrarVacacionesFifoEnConexion(conn, { empresaId: 7, idEmpleado: 1, fechaInicio: "2026-10-01", fechaFin: "2026-10-30", diasATomar: 20 });
    expect(mem.detalles.map((d) => [d.saldo_id, d.dias_tomados])).toEqual([[1, 4], [2, 15], [3, 1]]);
  });

  it("saldo insuficiente no consume nada", async () => {
    mem.saldos = [saldo(1, 1, 2)];
    const conn = await getPool().getConnection();
    const r = await registrarVacacionesFifoEnConexion(conn, { empresaId: 7, idEmpleado: 1, fechaInicio: "2026-10-01", fechaFin: "2026-10-05", diasATomar: 5 });
    expect(r.ok).toBe(false);
    expect(mem.detalles).toEqual([]);
  });
});

describe("obtenerHistorialPeriodos", () => {
  it("devuelve TODOS los períodos (otorgados, consumidos, disponibles, estado); el saldo actual es solo lo utilizable", async () => {
    await sync();
    const vencido = mem.saldos.find((s) => s.anio_laboral === 1)!;
    mem.detalles.push({ incidencia_id: 1, saldo_id: vencido.id, dias_tomados: 10 });
    const h = await obtenerHistorialPeriodos(7, 1);
    expect(h.periodos).toHaveLength(11);
    expect(h.periodos[0]).toMatchObject({ anioLaboral: 1, diasOtorgados: 15, diasConsumidos: 10, diasDisponibles: 0, estadoVisual: "Vencido" });
    expect(h.periodos.at(-1)!.estadoVisual).toBe("En curso");
    const suma = h.periodos.reduce((x, p) => x + p.diasDisponibles, 0);
    expect(h.saldoActual).toBeCloseTo(suma, 2); // los vencidos tienen 0: el historial NO se suma al saldo
    expect(h.saldoActual).toBeLessThanOrEqual(30);
    expect(h.fechaLaboralSospechosa).toBe(false);
    expect(h.historialOculto).toBe(false);
  });

  it("con fecha laboral sospechosa NO presenta decenas de períodos como válidos: oculta los vencidos y advierte", async () => {
    mem.fechaAlta = "1899-12-31";
    for (let n = 1; n <= 127; n++) {
      mem.saldos.push({ id: n, empresa_id: 7, id_empleado: 1, anio_laboral: n, periodo_inicio: `${1899 + n}-01-01`, periodo_fin: `${1899 + n}-12-30`, dias_otorgados: 15, dias_disponibles: n >= 126 ? 15 : 0, estado: n >= 126 ? "Vigente" : "Vencido" });
    }
    const h = await obtenerHistorialPeriodos(7, 1);
    expect(h.fechaLaboralSospechosa).toBe(true);
    expect(h.historialOculto).toBe(true);
    expect(h.periodos.length).toBe(2); // solo los vigentes
    expect(h.advertencias.map((a) => a.codigo)).toContain("FECHA_LABORAL_SOSPECHOSA");
    expect(mem.ejecutados).toEqual([]); // y no se modificó nada
  });

  it("reporta traslapes existentes (borde vs real) sin modificar los datos", async () => {
    mem.fechaAlta = "2022-10-31";
    mem.saldos = [
      { id: 1, empresa_id: 7, id_empleado: 1, anio_laboral: 1, periodo_inicio: "2022-10-31", periodo_fin: "2023-10-30", dias_otorgados: 15, dias_disponibles: 0, estado: "Vencido" },
      { id: 2, empresa_id: 7, id_empleado: 1, anio_laboral: 2, periodo_inicio: "2023-10-30", periodo_fin: "2024-10-29", dias_otorgados: 15, dias_disponibles: 0, estado: "Vencido" },
    ];
    const h = await obtenerHistorialPeriodos(7, 1);
    expect(h.advertencias.map((a) => a.codigo)).toContain("TRASLAPE_BORDE");
    expect(mem.saldos[1]).toMatchObject({ periodo_inicio: "2023-10-30", periodo_fin: "2024-10-29" });
  });
});
