import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-registro-bd.testutil");
  return {
    query: (sql: string, p?: unknown[]) => m.bd.consulta(sql, p),
    execute: async () => { throw new Error("no usar execute del pool"); },
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
  };
});

import { bd, EMPRESA, type Saldo, type Tablas } from "./vacaciones-registro-bd.testutil";
import {
  ReparacionBloqueadaError, ReparacionCambioError, ReparacionEmpleadoNoEncontradoError, listarPendientesReparacion, previsualizarReparacion,
  repararSerieVacaciones, type PreviaReparacion,
} from "./vacaciones-reparacion-db";
import { diagnosticarSerie, planificarReparacion } from "./vacaciones-reparacion";
import { analizarTraslapes, aIso, deIso, periodoLaboral } from "./vacaciones-periodos";
import { obtenerHistorialPeriodos } from "./vacaciones";
import { registrarVacaciones } from "./vacaciones-registro";
import { eliminarRegistroVacaciones } from "./vacaciones-eliminar";

/**
 * Datos 100 % sintéticos (sin nombres, DPI ni IDs reales). Fecha de alta del ejemplo del ticket: 2023-04-13; "hoy" = 2026-10-08.
 */
const EMP = 1;
const OTRO = 2;
const OTRA_EMPRESA = 8;
const ALTA = "2023-04-13";
const hoyFijo = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), 12)); };
const r2 = (n: number) => Math.round(n * 100) / 100;

const sal = (id: number, anio: number | null, ini: string, fin: string, otorg: number, disp: number, estado = "Vigente", emp = EMP, empresa = EMPRESA): Saldo =>
  ({ id, empresa_id: empresa, id_empleado: emp, anio_laboral: anio, periodo_inicio: ini, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp, estado });
const empleado = (over: Partial<Tablas["empleados"][number]> = {}) => ({ id: EMP, empresa_id: EMPRESA, nombre: "Colaborador Sintético", fecha_alta: ALTA, ...over });
const inc = (id: number, ini: string, fin: string, dias: number, emp = EMP, empresa = EMPRESA, tipo = "Vacaciones") => ({ id, empresa_id: empresa, id_empleado: emp, tipo, fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias });
const vac = (id: number, ini: string, fin: string, dias: number, emp = EMP, empresa = EMPRESA) => ({ id, empresa_id: empresa, id_empleado: emp, fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias, estado: "Aprobado" });

/** Serie CORRUPTA del ejemplo del ticket: cuatro filas con bases distintas y traslapes, sobre una fecha de alta actual de 2023-04-13. */
const serieCorrupta = (): Saldo[] => [
  sal(1, 1, "2023-06-01", "2024-05-31", 15, 15),
  sal(2, 2, "2024-05-31", "2025-05-30", 15, 15),
  sal(3, 3, "2025-04-13", "2026-04-12", 15, 15),
  sal(4, 4, "2026-04-13", "2027-04-12", 7.5, 7.5),
];
/** Serie CORRECTA derivada de la fecha de alta (años 1..4). */
const serieCorrecta = (emp = EMP, empresa = EMPRESA, idBase = 100): Saldo[] => [1, 2, 3, 4].map((n) => {
  const p = periodoLaboral(deIso(ALTA), n);
  return sal(idBase + n, n, aIso(p.inicio), aIso(p.fin), n === 4 ? 7.5 : 15, n === 4 ? 7.5 : 15, n === 1 ? "Vencido" : "Vigente", emp, empresa);
});
const esperada = [1, 2, 3, 4].map((n) => { const p = periodoLaboral(deIso(ALTA), n); return [n, aIso(p.inicio), aIso(p.fin)]; });

const periodos = (emp = EMP, empresa = EMPRESA) => bd.t.saldos.filter((s) => s.id_empleado === emp && s.empresa_id === empresa).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
const fechasSerie = () => periodos().map((s) => [s.anio_laboral, s.periodo_inicio, s.periodo_fin]);
const sumaDetalle = (t: Tablas, emp = EMP) => {
  const ids = new Set(t.saldos.filter((s) => s.id_empleado === emp).map((s) => s.id));
  return r2(t.detalle.filter((d) => ids.has(d.saldo_id)).reduce((a, d) => a + d.dias_tomados, 0));
};
const porIncidencia = (t: Tablas) => { const m = new Map<number, number>(); for (const d of t.detalle) m.set(d.incidencia_id, r2((m.get(d.incidencia_id) ?? 0) + d.dias_tomados)); return [...m].sort((a, b) => a[0] - b[0]); };
const sinEscrituras = () => bd.ejecutadas.every((s) => !/^(INSERT|UPDATE|DELETE)/.test(s));
const traslapesReales = () => analizarTraslapes(periodos().map((s) => ({ id: s.id, anioLaboral: s.anio_laboral, inicio: s.periodo_inicio, fin: s.periodo_fin, otorgados: s.dias_otorgados, disponibles: s.dias_disponibles, estado: s.estado, conConsumo: false }))).filter((a) => a.codigo === "TRASLAPE_REAL").length;

async function previa(empresa = EMPRESA, emp = EMP): Promise<PreviaReparacion> { return (await previsualizarReparacion(empresa, emp))!; }
async function reparar(huella?: string, usuario = "rrhh.ana") {
  const h = huella ?? (await previa()).huella;
  return repararSerieVacaciones(EMPRESA, EMP, { huella: h, usuario });
}

/** Caso base con consumo: una vacación de 5 días en agosto de 2024 (ligada a la serie corrupta), con su fila espejo y una evidencia. */
function conConsumo(extra: Partial<Tablas> = {}) {
  bd.reiniciar({
    empleados: [empleado()],
    saldos: serieCorrupta(),
    incidencias: [inc(10, "2024-08-05", "2024-08-09", 5)],
    vacaciones: [vac(10, "2024-08-05", "2024-08-09", 5)],
    detalle: [{ id: 1, incidencia_id: 10, saldo_id: 2, dias_tomados: 5 }],
    evidencias: [{ id: 1, empresa_id: EMPRESA, incidencia_id: 10, ruta_archivo: "sintetica/evidencia-1.pdf" }],
    ...extra,
  });
}

afterEach(() => vi.useRealTimers());
beforeEach(() => hoyFijo("2026-10-08"));

describe("diagnosticarSerie (puro): ¿la serie guardada coincide estructuralmente con la fecha de alta?", () => {
  const hoy = new Date(2026, 9, 8);
  const filas = (xs: Saldo[]) => xs.map((s) => ({ id: s.id, anioLaboral: s.anio_laboral, inicio: s.periodo_inicio, fin: s.periodo_fin, otorgados: s.dias_otorgados, disponibles: s.dias_disponibles, estado: s.estado, conConsumo: false }));

  it("una serie derivada de la fecha de alta NO requiere reparación (tener períodos vencidos no es un error)", () => {
    const d = diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: filas(serieCorrecta()) });
    expect(d).toMatchObject({ requiereReparacion: false, congelada: false, defectos: [], traslapesReales: 0, aniosDuplicados: [], fueraDeBase: [] });
  });
  it("sin saldos, o sin fecha de alta, no hay nada que diagnosticar", () => {
    expect(diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: [] }).requiereReparacion).toBe(false);
    expect(diagnosticarSerie({ fechaAlta: null, hoy, filas: filas(serieCorrupta()) }).requiereReparacion).toBe(false);
  });
  it("la serie del ejemplo (bases distintas + traslapes) requiere reparación: períodos fuera de base y traslapes reales", () => {
    const d = diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: filas(serieCorrupta()) });
    expect(d.requiereReparacion).toBe(true);
    expect(d.fueraDeBase.sort()).toEqual([1, 2]);
    expect(d.traslapesReales).toBeGreaterThan(0);
    expect(d.defectos.map((x) => x.codigo)).toEqual(expect.arrayContaining(["PERIODO_FUERA_DE_BASE", "TRASLAPE_REAL"]));
  });
  it("detecta año laboral duplicado, año fuera de la serie y año laboral nulo dentro de la serie; un nulo fuera de la serie y sin consumo no cuenta", () => {
    const dup = [...serieCorrecta(), sal(900, 2, "2024-04-13", "2025-04-12", 15, 15)];
    expect(diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: filas(dup) }).aniosDuplicados).toEqual([2]);
    const fuera = [...serieCorrecta(), sal(901, 9, "2031-04-13", "2032-04-12", 15, 15)];
    expect(diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: filas(fuera) }).defectos.map((x) => x.codigo)).toContain("ANIO_FUERA_DE_SERIE");
    const nuloDentro = [...serieCorrecta(), sal(902, null, "2024-06-01", "2024-06-30", 1, 1)];
    expect(diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: filas(nuloDentro) }).defectos.map((x) => x.codigo)).toContain("ANIO_LABORAL_NULO_EN_SERIE");
    const nuloFuera = [...serieCorrecta(), sal(903, null, "2001-01-01", "2001-12-31", 1, 1, "Vencido")];
    expect(diagnosticarSerie({ fechaAlta: ALTA, hoy, filas: filas(nuloFuera) }).requiereReparacion).toBe(false);
  });
  it("fecha de alta sospechosa o futura con saldos: requiere reparación pero el plan queda BLOQUEADO", () => {
    const hechos = [] as never[];
    for (const [alta, codigo] of [["1899-12-31", "FECHA_NUEVA_SOSPECHOSA"], ["2027-01-01", "FECHA_NUEVA_FUTURA"]] as const) {
      expect(diagnosticarSerie({ fechaAlta: alta, hoy, filas: filas(serieCorrecta()) }).requiereReparacion).toBe(true);
      const plan = planificarReparacion({ fechaAlta: alta, hoy, hechos, saldos: serieCorrecta().map((s) => ({ id: s.id, anioLaboral: s.anio_laboral, inicio: s.periodo_inicio, fin: s.periodo_fin, otorgados: s.dias_otorgados, disponibles: s.dias_disponibles, estado: s.estado })), feriados: new Set() });
      expect(plan.bloqueos.map((b) => b.codigo)).toEqual([codigo]);
      expect(plan.bloqueos[0].mensaje).toContain("fecha de contratación actual");
    }
  });
});

describe("A/B) caso del ticket SIN consumo: la serie corrupta se reconstruye desde la fecha de alta actual", () => {
  beforeEach(() => bd.reiniciar({ empleados: [empleado()], saldos: serieCorrupta() }));

  it("la vista previa informa traslapes, períodos fuera de base y la serie propuesta; no escribe nada", async () => {
    bd.ejecutadas = [];
    const p = await previa();
    expect(p).toMatchObject({ requiereReparacion: true, puedeReparar: true, fechaAltaActual: ALTA, vacacionesRegistradas: 0, consumidoPreservado: 0, bloqueos: [] });
    expect(p.periodosActuales).toHaveLength(4);
    expect(p.periodosFueraDeBase.map((x) => x.saldoId).sort()).toEqual([1, 2]);
    expect(p.traslapesActuales).toBeGreaterThan(0);
    expect(p.periodosPropuestos.map((x) => [x.anioLaboral, x.inicio, x.fin])).toEqual(esperada);
    expect(p.huella).toMatch(/^[0-9a-f]{32}$/);
    expect(sinEscrituras()).toBe(true);
    expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
  });

  it("la reparación deja 13/04/2023 → 12/04/2024, …, 13/04/2026 → 12/04/2027: sin traslapes, un período por año, todos de la misma base", async () => {
    expect(await obtenerHistorialPeriodos(EMPRESA, EMP).then((h) => h.requiereReparacion)).toBe(true); // hoy: sincronización congelada
    bd.reiniciar({ empleados: [empleado()], saldos: serieCorrupta() });
    const r = await reparar();
    expect(r.aplicado).toBe(true);
    expect(fechasSerie()).toEqual(esperada);
    expect(traslapesReales()).toBe(0);
    expect(new Set(periodos().map((s) => s.anio_laboral)).size).toBe(4);
    expect(periodos().map((s) => s.estado)).toEqual(["Vencido", "Vigente", "Vigente", "Vigente"]);
    expect(r2(periodos().filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0))).toBeLessThanOrEqual(30);
    expect(bd.t.empleados[0].fecha_alta).toBe(ALTA); // NO modifica la fecha de alta
    expect(bd.t.detalle).toEqual([]);
  });

  it("registra la auditoría vacaciones_reparacion_serie con todo lo necesario", async () => {
    await reparar(undefined, "rrhh.ana");
    const a = bd.t.auditoria.filter((x) => x.accion === "vacaciones_reparacion_serie");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ empresa_id: EMPRESA, usuario: "rrhh.ana" });
    const d = JSON.parse(a[0].detalle!);
    expect(d).toMatchObject({ empresaId: EMPRESA, empleadoId: EMP, fechaAlta: ALTA, usuario: "rrhh.ana", consumidoPreservado: 0, lineasFifoReconstruidas: 0, lineasFifoAnteriores: 0 });
    expect(d.periodosAnteriores).toHaveLength(4);
    expect(d.periodosNuevos.map((x: { inicio: string }) => x.inicio)).toEqual(esperada.map((x) => x[1]));
    expect(d.traslapesAnteriores).toBeGreaterThan(0);
    expect(typeof d.fecha).toBe("string");
    expect(d).toHaveProperty("saldoAntes");
    expect(d).toHaveProperty("saldoDespues");
  });

  it("O) después de reparar, la sincronización normal ya no se congela ni escribe", async () => {
    await reparar();
    const antes = bd.instantanea().saldos;
    const h = await obtenerHistorialPeriodos(EMPRESA, EMP);
    expect(h.requiereReparacion).toBe(false);
    expect(h.advertencias.filter((a) => a.bloqueante)).toEqual([]);
    expect(bd.instantanea().saldos).toEqual(antes);
    expect(diagnosticarSerie({ fechaAlta: ALTA, hoy: new Date(), filas: periodos().map((s) => ({ id: s.id, anioLaboral: s.anio_laboral, inicio: s.periodo_inicio, fin: s.periodo_fin, otorgados: s.dias_otorgados, disponibles: s.dias_disponibles, estado: s.estado, conConsumo: false })) }).requiereReparacion).toBe(false);
  });

  it("P) después de reparar se puede registrar una vacación nueva con normalidad", async () => {
    await reparar();
    const r = await registrarVacaciones({ empresaId: EMPRESA, idEmpleado: EMP, fechaInicio: "2026-09-07", fechaFin: "2026-09-09", diasATomar: 3, tipo: "Vacaciones", usuario: "rrhh.ana" });
    expect(r.ok).toBe(true);
    expect(sumaDetalle(bd.t)).toBe(3);
    expect(traslapesReales()).toBe(0);
  });
});

describe("C) serie corrupta CON vacaciones consumidas: el consumo se preserva exactamente", () => {
  beforeEach(() => conConsumo());

  it("preview: 1 vacación, 5 días consumidos; POST: mismos IDs de incidencias, vacaciones y evidencias, mismo total y mismo total por incidencia", async () => {
    const p = await previa();
    expect(p).toMatchObject({ requiereReparacion: true, puedeReparar: true, vacacionesRegistradas: 1, consumidoPreservado: 5, lineasFifoAntes: 1, lineasFifoDespues: 1 });
    const antes = bd.instantanea();
    const r = await reparar();
    expect(r.aplicado).toBe(true);
    const d = bd.t;
    expect(d.incidencias).toEqual(antes.incidencias); // M/N: mismos IDs y datos
    expect(d.vacaciones).toEqual(antes.vacaciones);
    expect(d.evidencias).toEqual(antes.evidencias);
    expect(sumaDetalle(d)).toBe(5);
    expect(porIncidencia(d)).toEqual(porIncidencia(antes));
    expect(fechasSerie()).toEqual(esperada);
    expect(d.detalle).toHaveLength(1);
    expect(d.detalle[0]).toMatchObject({ incidencia_id: 10, dias_tomados: 5 });
    // el consumo (agosto de 2024) se reubica en la serie NUEVA, FIFO por año laboral: el año 1 (2023-04-13 → 2024-04-12)
    const destino = d.saldos.find((s) => s.id === d.detalle[0].saldo_id)!;
    expect(destino).toMatchObject({ anio_laboral: 1, periodo_inicio: "2023-04-13", periodo_fin: "2024-04-12", dias_otorgados: 15, dias_disponibles: 0, estado: "Vencido" });
    // el consumo no reaparece como disponible: otorgado − consumido ≥ disponible en cada período
    for (const s of periodos()) {
      const consumido = d.detalle.filter((x) => x.saldo_id === s.id).reduce((a, x) => a + x.dias_tomados, 0);
      expect(s.dias_disponibles).toBeLessThanOrEqual(r2(s.dias_otorgados - consumido) + 0.004);
    }
    expect(JSON.parse(d.auditoria.at(-1)!.detalle!)).toMatchObject({ consumidoPreservado: 5, lineasFifoAnteriores: 1, lineasFifoReconstruidas: 1 });
  });

  it("Q) eliminar una vacación después de reparar restaura el consumo al período correcto de la serie NUEVA", async () => {
    // una vacación reciente (agosto de 2026) que consume del año 2 (hoy vigente) de la serie reconstruida
    bd.reiniciar({
      empleados: [empleado()], saldos: serieCorrupta(),
      incidencias: [inc(11, "2026-08-03", "2026-08-07", 5)], vacaciones: [vac(11, "2026-08-03", "2026-08-07", 5)],
      detalle: [{ id: 1, incidencia_id: 11, saldo_id: 3, dias_tomados: 5 }],
    });
    await reparar();
    const nuevo = bd.t.detalle.find((d) => d.incidencia_id === 11)!;
    const periodoNuevo = bd.t.saldos.find((s) => s.id === nuevo.saldo_id)!;
    expect(periodoNuevo.id).toBeGreaterThan(4); // fila de la serie nueva, no una de las viejas
    expect([periodoNuevo.periodo_inicio, periodoNuevo.periodo_fin]).toEqual(esperada.find((e) => e[0] === periodoNuevo.anio_laboral)!.slice(1));
    expect(periodoNuevo.anio_laboral).toBe(2);
    const del = await eliminarRegistroVacaciones(EMPRESA, 11, "rrhh.ana");
    if (!del.ok) throw new Error(del.error);
    expect(del).toMatchObject({ ok: true, diasRestaurados: 5, diasNoRestaurados: 0 });
    expect(bd.t.detalle).toEqual([]);
    // los 5 días se restauran al MISMO período de la serie nueva (el tope de 30 vuelve a recortar el excedente del más antiguo: regla existente)
    expect(del.desglose).toEqual([expect.objectContaining({ saldoId: periodoNuevo.id, anioLaboral: 2, diasRestaurados: 5 })]);
    expect(r2(bd.t.saldos.filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0))).toBeLessThanOrEqual(30);
    expect(bd.t.saldos.every((s) => s.id > 4)).toBe(true); // ninguna fila de la serie corrupta
    expect(fechasSerie()).toEqual(esperada);
    expect(traslapesReales()).toBe(0);
  });
});

describe("D/E/F) serie duplicada, traslapada o con años laborales incorrectos", () => {
  it("D) año laboral duplicado ⇒ requiere reparación y se reconstruye con un único período por año", async () => {
    bd.reiniciar({ empleados: [empleado()], saldos: [...serieCorrecta(), sal(900, 2, "2024-04-13", "2025-04-12", 15, 15)].map((s, i) => ({ ...s, id: i + 1 })) });
    const p = await previa();
    expect(p).toMatchObject({ requiereReparacion: true, aniosLaboralesDuplicados: [2] });
    await reparar();
    expect(fechasSerie()).toEqual(esperada);
  });
  it("E) traslape real entre filas ⇒ se reconstruye sin traslapes", async () => {
    bd.reiniciar({ empleados: [empleado()], saldos: [sal(1, 1, "2023-04-13", "2024-09-30", 15, 15), ...serieCorrecta().slice(1).map((s, i) => ({ ...s, id: i + 2 }))] });
    expect((await previa()).traslapesActuales).toBeGreaterThan(0);
    await reparar();
    expect(traslapesReales()).toBe(0);
    expect(fechasSerie()).toEqual(esperada);
  });
  it("F) fechas correctas con años laborales equivocados ⇒ fuera de base; se reconstruye con los años correctos", async () => {
    bd.reiniciar({ empleados: [empleado()], saldos: serieCorrecta().map((s, i) => ({ ...s, id: i + 1, anio_laboral: (s.anio_laboral as number) + 1 })) });
    const p = await previa();
    expect(p.requiereReparacion).toBe(true);
    expect(p.defectos.map((d) => d.codigo)).toEqual(expect.arrayContaining(["PERIODO_FUERA_DE_BASE", "ANIO_FUERA_DE_SERIE"]));
    await reparar();
    expect(fechasSerie()).toEqual(esperada);
  });
  it("una serie con otra base y SIN traslapes (desplazada) también requiere reparación y queda sobre la fecha de alta", async () => {
    bd.reiniciar({ empleados: [empleado()], saldos: [1, 2, 3, 4].map((n) => { const p = periodoLaboral(deIso("2023-06-01"), n); return sal(n, n, aIso(p.inicio), aIso(p.fin), 15, 15); }) });
    expect((await previa()).requiereReparacion).toBe(true);
    await reparar();
    expect(fechasSerie()).toEqual(esperada);
  });
});

describe("R) serie YA correcta: no hay nada que reparar", () => {
  it("preview ⇒ requiereReparacion=false; POST ⇒ no modifica nada (ni siquiera escribe)", async () => {
    bd.reiniciar({ empleados: [empleado()], saldos: serieCorrecta() });
    const p = await previa();
    expect(p).toMatchObject({ requiereReparacion: false, puedeReparar: false, bloqueos: [], periodosPropuestos: [] });
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const r = await repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" });
    expect(r.aplicado).toBe(false);
    expect(bd.instantanea()).toEqual(antes);
    expect(sinEscrituras()).toBe(true);
  });
  it("sin saldos ni vacaciones ⇒ tampoco requiere reparación", async () => {
    bd.reiniciar({ empleados: [empleado()] });
    expect((await previa()).requiereReparacion).toBe(false);
    const antes = bd.instantanea();
    expect((await reparar()).aplicado).toBe(false);
    expect(bd.instantanea()).toEqual(antes);
  });
  it("un empleado inexistente o de OTRA empresa ⇒ null en la vista previa y error de no encontrado al reparar, sin escribir", async () => {
    bd.reiniciar({ empleados: [empleado()], saldos: serieCorrupta() });
    const antes = bd.instantanea();
    expect(await previsualizarReparacion(OTRA_EMPRESA, EMP)).toBeNull();
    await expect(repararSerieVacaciones(OTRA_EMPRESA, EMP, { huella: "0".repeat(32) })).rejects.toBeInstanceOf(ReparacionEmpleadoNoEncontradoError);
    expect(bd.instantanea()).toEqual(antes);
  });
});

describe("Bloqueos duros: no se habilita la reparación, no se borra ni se corrige nada", () => {
  const verificarBloqueo = async (codigo: string, esperadoEnPreview = true) => {
    const antes = bd.instantanea();
    const p = await previa();
    expect(p.requiereReparacion).toBe(true);
    expect(p.puedeReparar).toBe(false);
    if (esperadoEnPreview) expect(p.bloqueos.map((b) => b.codigo)).toContain(codigo);
    bd.ejecutadas = [];
    const err = await repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" }).catch((e) => e);
    expect(err).toBeInstanceOf(ReparacionBloqueadaError);
    expect((err as ReparacionBloqueadaError).plan.bloqueos.map((b) => b.codigo)).toContain(codigo);
    expect(sinEscrituras()).toBe(true); // bloqueo ANTES de cualquier escritura
    expect(bd.eventos).toContain("ROLLBACK");
    expect(bd.instantanea()).toEqual(antes);
    expect(bd.t.auditoria.some((a) => a.accion === "vacaciones_reparacion_serie")).toBe(false);
  };

  it("G) DETALLE_AJENO: consumo sobre saldos del colaborador que proviene de una incidencia de OTRO empleado", async () => {
    conConsumo();
    bd.t.incidencias.push(inc(90, "2025-07-07", "2025-07-08", 2, OTRO));
    bd.t.detalle.push({ id: 2, incidencia_id: 90, saldo_id: 2, dias_tomados: 2 });
    await verificarBloqueo("DETALLE_AJENO");
  });
  it("H) DETALLE_SALDO_AJENO: consumo de una vacación del colaborador apuntando al saldo de OTRO empleado / OTRA empresa / inexistente", async () => {
    for (const destino of [
      { saldos: [sal(50, 1, "2024-01-01", "2024-12-31", 15, 15, "Vigente", OTRO)] },
      { saldos: [sal(50, 1, "2024-01-01", "2024-12-31", 15, 15, "Vigente", 3, OTRA_EMPRESA)] },
      { saldos: [] as Saldo[] },
    ]) {
      conConsumo();
      bd.t.saldos.push(...destino.saldos);
      bd.t.detalle[0].saldo_id = destino.saldos.length ? 50 : 999; // 999 = saldo inexistente
      await verificarBloqueo("DETALLE_SALDO_AJENO");
    }
  });
  it("I) vacación anterior a la fecha de alta ⇒ bloqueo", async () => {
    conConsumo({ incidencias: [inc(10, "2023-01-09", "2023-01-13", 5)], vacaciones: [vac(10, "2023-01-09", "2023-01-13", 5)] });
    await verificarBloqueo("VACACION_ANTERIOR_A_NUEVA_ALTA");
    const p = await previa();
    expect(p.bloqueos[0].mensaje).toContain("antes de la fecha de contratación actual");
  });
  it("J) déficit al reconstruir (consumo mayor al disponible en su fecha) ⇒ bloqueo", async () => {
    conConsumo({ incidencias: [inc(10, "2023-06-05", "2023-06-30", 20)], vacaciones: [vac(10, "2023-06-05", "2023-06-30", 20)], detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 20 }] });
    await verificarBloqueo("DEFICIT_AL_REBASAR");
  });
  it("fecha de alta futura, sospechosa o inválida con saldos ⇒ bloqueo (y la fecha no se toca)", async () => {
    for (const [alta, codigo] of [["2027-01-01", "FECHA_NUEVA_FUTURA"], ["1899-12-31", "FECHA_NUEVA_SOSPECHOSA"]] as const) {
      bd.reiniciar({ empleados: [empleado({ fecha_alta: alta })], saldos: serieCorrupta() });
      await verificarBloqueo(codigo);
      expect(bd.t.empleados[0].fecha_alta).toBe(alta);
    }
  });
});

describe("K/L) aislamiento: otro empleado de la misma empresa y otra empresa quedan intactos", () => {
  it("solo se reemplazan los saldos y el detalle del colaborador reparado", async () => {
    const otroInc = inc(20, "2025-03-03", "2025-03-07", 5, OTRO);
    const ajenoInc = inc(30, "2025-03-03", "2025-03-07", 5, 3, OTRA_EMPRESA);
    conConsumo({
      empleados: [empleado(), empleado({ id: OTRO, nombre: "Otro Sintético" }), { id: 3, empresa_id: OTRA_EMPRESA, nombre: "Ajeno Sintético", fecha_alta: ALTA }],
      saldos: [...serieCorrupta(), ...serieCorrecta(OTRO, EMPRESA, 100), ...serieCorrupta().map((s) => ({ ...s, id: s.id + 200, empresa_id: OTRA_EMPRESA, id_empleado: 3 }))],
      incidencias: [inc(10, "2024-08-05", "2024-08-09", 5), otroInc, ajenoInc],
      vacaciones: [vac(10, "2024-08-05", "2024-08-09", 5), vac(20, "2025-03-03", "2025-03-07", 5, OTRO), vac(30, "2025-03-03", "2025-03-07", 5, 3, OTRA_EMPRESA)],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 2, dias_tomados: 5 }, { id: 2, incidencia_id: 20, saldo_id: 102, dias_tomados: 5 }, { id: 3, incidencia_id: 30, saldo_id: 202, dias_tomados: 5 }],
    });
    const antes = bd.instantanea();
    await reparar();
    const d = bd.t;
    for (const [emp, empresa] of [[OTRO, EMPRESA], [3, OTRA_EMPRESA]] as const) {
      expect(d.saldos.filter((s) => s.id_empleado === emp && s.empresa_id === empresa)).toEqual(antes.saldos.filter((s) => s.id_empleado === emp && s.empresa_id === empresa));
      expect(d.incidencias.filter((i) => i.id_empleado === emp)).toEqual(antes.incidencias.filter((i) => i.id_empleado === emp));
      expect(d.vacaciones.filter((v) => v.id_empleado === emp)).toEqual(antes.vacaciones.filter((v) => v.id_empleado === emp));
    }
    expect(d.detalle.filter((x) => x.incidencia_id !== 10)).toEqual(antes.detalle.filter((x) => x.incidencia_id !== 10));
    expect(d.empleados).toEqual(antes.empleados);
    expect(d.incidencias).toEqual(antes.incidencias);
    expect(d.vacaciones).toEqual(antes.vacaciones);
    expect(d.evidencias).toEqual(antes.evidencias);
    expect(fechasSerie()).toEqual(esperada);
  });
});

describe("Transaccionalidad: revalidación bajo bloqueo, huella del preview y ROLLBACK completo", () => {
  it("una huella que no es la de la vista previa aborta sin escribir", async () => {
    conConsumo();
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    await expect(reparar("f".repeat(32))).rejects.toBeInstanceOf(ReparacionCambioError);
    expect(sinEscrituras()).toBe(true);
    expect(bd.instantanea()).toEqual(antes);
    expect(bd.eventos).toContain("ROLLBACK");
  });
  it("si entre la vista previa y el POST se registra una vacación, la reparación aborta (no se confía en el preview)", async () => {
    conConsumo();
    const p = await previa();
    bd.t.incidencias.push(inc(11, "2025-02-03", "2025-02-07", 5));
    bd.t.vacaciones.push(vac(11, "2025-02-03", "2025-02-07", 5));
    bd.t.detalle.push({ id: 2, incidencia_id: 11, saldo_id: 2, dias_tomados: 5 });
    const antes = bd.instantanea();
    await expect(repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella })).rejects.toBeInstanceOf(ReparacionCambioError);
    expect(bd.instantanea()).toEqual(antes);
  });
  it("si entre la vista previa y el POST aparece un bloqueo (detalle ajeno), se bloquea", async () => {
    conConsumo();
    const p = await previa();
    bd.t.incidencias.push(inc(90, "2025-07-07", "2025-07-08", 2, OTRO));
    bd.t.detalle.push({ id: 2, incidencia_id: 90, saldo_id: 2, dias_tomados: 2 });
    const antes = bd.instantanea();
    await expect(repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella })).rejects.toBeInstanceOf(ReparacionBloqueadaError);
    expect(bd.instantanea()).toEqual(antes);
  });
  it("un fallo en cualquier paso (borrar la serie, insertar saldos, insertar detalle, auditar) revierte TODO", async () => {
    for (const fallo of ["DELETE FROM detalle_consumo_vacaciones", "DELETE FROM saldos_vacaciones", "INSERT INTO saldos_vacaciones", "INSERT INTO detalle_consumo_vacaciones", "INSERT INTO auditoria"]) {
      conConsumo();
      const p = await previa();
      const antes = bd.instantanea();
      bd.fallarSi = (sql) => sql.startsWith(fallo);
      await expect(repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" })).rejects.toThrow();
      expect(bd.instantanea()).toEqual(antes);
      expect(bd.eventos).toContain("ROLLBACK");
      expect(bd.eventos).not.toContain("COMMIT");
    }
  });
  it("todo ocurre en UNA transacción: BEGIN … COMMIT, con el empleado bloqueado FOR UPDATE antes de cualquier escritura", async () => {
    conConsumo();
    const p = await previa();
    bd.eventos = []; bd.ejecutadas = [];
    await repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" });
    expect(bd.eventos).toEqual(["BEGIN", "COMMIT", "RELEASE"]);
    const iLock = bd.ejecutadas.findIndex((s) => s.includes("FROM empleados") && s.endsWith("FOR UPDATE"));
    const iPrimeraEscritura = bd.ejecutadas.findIndex((s) => /^(INSERT|UPDATE|DELETE)/.test(s));
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(iPrimeraEscritura).toBeGreaterThan(iLock);
    expect(bd.ejecutadas.some((s) => /^(UPDATE|DELETE|INSERT)\s.*\b(incidencias|vacaciones |evidencias_incidencias|empleados)\b/.test(s) && !s.includes("saldos_vacaciones") && !s.includes("detalle_consumo") && !s.includes("auditoria"))).toBe(false);
  });
});

describe("Listado de pendientes (SOLO LECTURA): identifica, no repara", () => {
  it("lista únicamente a quienes requieren reparación, de ESTA empresa, sin escribir", async () => {
    bd.reiniciar({
      empleados: [empleado(), empleado({ id: OTRO, nombre: "Correcto Sintético" }), { id: 3, empresa_id: OTRA_EMPRESA, nombre: "Ajeno Sintético", fecha_alta: ALTA }, empleado({ id: 4, nombre: "Sin Saldos Sintético" })],
      saldos: [...serieCorrupta(), ...serieCorrecta(OTRO, EMPRESA, 100), ...serieCorrupta().map((s) => ({ ...s, id: s.id + 200, empresa_id: OTRA_EMPRESA, id_empleado: 3 }))],
    });
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const r = await listarPendientesReparacion(EMPRESA);
    expect(r.total).toBe(1);
    expect(r.empleados.map((e) => e.empleadoId)).toEqual([EMP]);
    expect(r.empleados[0].motivos).toEqual(expect.arrayContaining(["PERIODO_FUERA_DE_BASE", "TRASLAPE_REAL"]));
    expect(r.empleados[0].fechaAlta).toBe(ALTA);
    expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
    expect(bd.instantanea()).toEqual(antes);
    expect((await listarPendientesReparacion(OTRA_EMPRESA)).empleados.map((e) => e.empleadoId)).toEqual([3]);
  });
});
