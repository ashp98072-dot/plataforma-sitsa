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
import { obtenerHistorialPeriodos } from "./vacaciones";
import { previsualizarRegistro, registrarVacaciones } from "./vacaciones-registro";
import { eliminarRegistroVacaciones } from "./vacaciones-eliminar";
import { cambiarModoCargaHistorica, leerModoCargaHistorica, obtenerPoliticaVacaciones } from "./vacaciones-modo-db";
import { resincronizarSaldosEmpresa } from "./vacaciones-modo-resync-db";
import { calcularDiasAcumuladosProporcional, deIso } from "./vacaciones-periodos";
import { POLITICA_CARGA_HISTORICA, POLITICA_NORMAL } from "./vacaciones-politica";
import { reconstruirEmpleado } from "./vacaciones-reconstruccion";
import { previsualizarReparacion, repararSerieVacaciones } from "./vacaciones-reparacion-db";
import { previsualizarReparacionLote, repararLoteVacaciones } from "./vacaciones-reparacion-db";

/**
 * MODO DE CARGA HISTÓRICA (temporal, por empresa): sin vencimiento por antigüedad y sin tope de 30 mientras RRHH completa el historial. Un único motor recibe la política;
 * el modo solo cambia cómo se calcula el estado utilizable, el vencimiento y el saldo disponible. Datos sintéticos: fecha_alta 13/04/2023, "hoy" 08/10/2026.
 */
const EMP = 1;
const OTRA_EMPRESA = 8;
const ALTA = "2023-04-13";
const r2 = (n: number) => Math.round(n * 100) / 100;
const hoyFijo = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 8, 12)); };
const emp = (id = EMP, empresa = EMPRESA, alta: string | null = ALTA) => ({ id, empresa_id: empresa, nombre: `Colaborador ${id}`, fecha_alta: alta });
const periodos = (id = EMP, empresa = EMPRESA) => bd.t.saldos.filter((s) => s.id_empleado === id && s.empresa_id === empresa).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
const resumen = (id = EMP) => periodos(id).map((s) => [s.anio_laboral, s.dias_otorgados, s.dias_disponibles, s.estado]);
const vigentes = (id = EMP) => r2(periodos(id).filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0));
const saldoActual = async (id = EMP, empresa = EMPRESA) => (await obtenerHistorialPeriodos(empresa, id)).saldoActual;
const modo = (activo: boolean, empresa = EMPRESA) => cambiarModoCargaHistorica(empresa, activo, { usuario: "rrhh.ana" });
const reg = (inicio: string, fin: string, dias: number) => registrarVacaciones({ empresaId: EMPRESA, idEmpleado: EMP, fechaInicio: inicio, fechaFin: fin, diasATomar: dias, tipo: "Vacaciones", usuario: "rrhh.ana" });
const detalleDe = (anio: number) => r2(bd.t.detalle.filter((d) => periodos().find((s) => s.id === d.saldo_id)?.anio_laboral === anio).reduce((a, d) => a + d.dias_tomados, 0));
const consumoPorInc = (t: Tablas) => { const m = new Map<number, number>(); for (const d of t.detalle) m.set(d.incidencia_id, r2((m.get(d.incidencia_id) ?? 0) + d.dias_tomados)); return [...m].sort((a, b) => a[0] - b[0]); };
const intactos = (t: Tablas) => ({ i: t.incidencias, v: t.vacaciones, e: t.evidencias, d: t.detalle, emp: t.empleados });

beforeEach(() => { hoyFijo(); bd.reiniciar({ empleados: [emp()] }); });
afterEach(() => vi.useRealTimers());

describe("Configuración por empresa (almacén `configuracion`), por defecto NORMAL", () => {
  it("sin fila ⇒ modo NORMAL (2 períodos, tope 30); la política central es reversible y no hay otra constante", async () => {
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(false);
    expect(await obtenerPoliticaVacaciones(EMPRESA)).toEqual(POLITICA_NORMAL);
    expect(POLITICA_NORMAL).toEqual({ modo: "NORMAL", maxPeriodosVigentes: 2, aplicarTope: true });
    expect(POLITICA_CARGA_HISTORICA).toEqual({ modo: "CARGA_HISTORICA", maxPeriodosVigentes: null, aplicarTope: false });
  });
  it("activar guarda la bandera en `configuracion` de ESA empresa y audita (valor anterior y nuevo); desactivar vuelve a NORMAL", async () => {
    const r = await modo(true);
    expect(r).toEqual({ cambiado: true, valorAnterior: false, valorNuevo: true });
    expect(bd.t.configuracion).toEqual([{ empresa_id: EMPRESA, parametro: "vacaciones_modo_carga_historica", valor: "1" }]);
    expect(await obtenerPoliticaVacaciones(EMPRESA)).toEqual(POLITICA_CARGA_HISTORICA);
    const a = bd.t.auditoria.find((x) => x.accion === "vacaciones_modo_historico_activado")!;
    expect(a).toMatchObject({ empresa_id: EMPRESA, usuario: "rrhh.ana" });
    expect(JSON.parse(a.detalle!)).toMatchObject({ empresaId: EMPRESA, usuario: "rrhh.ana", valorAnterior: false, valorNuevo: true });
    expect(typeof JSON.parse(a.detalle!).fecha).toBe("string");
    await modo(false);
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(false);
    expect(JSON.parse(bd.t.auditoria.find((x) => x.accion === "vacaciones_modo_historico_desactivado")!.detalle!)).toMatchObject({ valorAnterior: true, valorNuevo: false });
  });
  it("N) activar/desactivar varias veces es idempotente: repetir el mismo valor no escribe ni audita", async () => {
    await modo(true);
    const antes = bd.instantanea();
    expect((await modo(true)).cambiado).toBe(false);
    expect(bd.instantanea()).toEqual(antes);
    await modo(false);
    expect((await modo(false)).cambiado).toBe(false);
    await modo(true); await modo(false);
    expect(bd.t.auditoria.filter((x) => x.accion.startsWith("vacaciones_modo_historico_")).map((x) => x.accion)).toEqual([
      "vacaciones_modo_historico_activado", "vacaciones_modo_historico_desactivado", "vacaciones_modo_historico_activado", "vacaciones_modo_historico_desactivado",
    ]);
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(false);
  });
  it("J) la empresa A en carga histórica no afecta a la empresa B (normal)", async () => {
    bd.reiniciar({ empleados: [emp(1, EMPRESA), emp(2, OTRA_EMPRESA)] });
    await modo(true, EMPRESA);
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(true);
    expect(await leerModoCargaHistorica(OTRA_EMPRESA)).toBe(false);
    expect(await saldoActual(1, EMPRESA)).toBe(52.38);
    expect(await saldoActual(2, OTRA_EMPRESA)).toBe(30);
    expect(bd.t.configuracion.filter((c) => c.empresa_id === OTRA_EMPRESA)).toEqual([]);
  });
});

describe("A) sin consumo: NORMAL = 30; CARGA HISTÓRICA ≈ 52.38 con todos los períodos utilizables", () => {
  it("NORMAL: años 1 vencido, 2 y 3 vigentes y el 4 en curso; saldo utilizable 30", async () => {
    expect(await saldoActual()).toBe(30);
    expect(periodos().map((s) => [s.anio_laboral, s.estado])).toEqual([[1, "Vencido"], [2, "Vigente"], [3, "Vigente"], [4, "Vigente"]]);
  });

  it("CARGA HISTÓRICA desde el inicio: 15 + 15 + 15 + 7.38 = 52.38, todos Vigentes, fechas derivadas de fecha_alta", async () => {
    await modo(true);
    expect(await saldoActual()).toBe(52.38);
    expect(resumen()).toEqual([[1, 15, 15, "Vigente"], [2, 15, 15, "Vigente"], [3, 15, 15, "Vigente"], [4, 7.38, 7.38, "Vigente"]]);
    expect(periodos().map((s) => [s.periodo_inicio, s.periodo_fin])).toEqual([["2023-04-13", "2024-04-12"], ["2024-04-13", "2025-04-12"], ["2025-04-13", "2026-04-12"], ["2026-04-13", "2027-04-12"]]);
  });

  it("cambiar el modo sobre una serie YA existente (vencida) la rehabilita sin borrar nada, y volver a NORMAL reaplica vencimiento y tope", async () => {
    await saldoActual(); // serie creada en modo normal
    const idsAntes = periodos().map((s) => s.id);
    await modo(true);
    expect(await saldoActual()).toBe(52.38);
    expect(periodos().map((s) => s.id)).toEqual(idsAntes); // mismas filas
    await modo(false);
    expect(await saldoActual()).toBe(30);
    expect(periodos().map((s) => s.id)).toEqual(idsAntes);
    expect(periodos()[0]).toMatchObject({ estado: "Vencido", dias_disponibles: 0 });
  });

  it("H/I/F) el período en curso sigue siendo proporcional (fórmula existente, domingos excluidos) y fecha_alta es la base", async () => {
    await modo(true);
    await saldoActual();
    const esperado = calcularDiasAcumuladosProporcional(deIso("2026-04-13"), deIso("2027-04-12"), new Date(2026, 9, 8), 15);
    expect(periodos()[3].dias_otorgados).toBe(esperado);
    let laborables = 0, total = 0;
    for (const d = new Date(2026, 3, 13); d <= new Date(2027, 3, 12); d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0) { total++; if (d <= new Date(2026, 9, 8)) laborables++; } }
    expect(esperado).toBe(r2((15 * laborables) / total)); // cálculo independiente: domingos excluidos
    expect(bd.t.empleados[0].fecha_alta).toBe(ALTA);
  });

  it("G) fecha_inicio_laboral no interviene (solo fecha_alta) bajo ambas políticas", () => {
    for (const politica of [POLITICA_NORMAL, POLITICA_CARGA_HISTORICA]) {
      const r = reconstruirEmpleado({ id: 1, codigo: "E-1", nombre: "x", fechaAlta: ALTA, fechaInicioLaboral: "2018-01-01" }, [], new Date(2026, 9, 8), new Set(), politica);
      expect(r.periodos.map((p) => p.inicio)).toEqual(["2023-04-13", "2024-04-13", "2025-04-13", "2026-04-13"]);
    }
  });
});

describe("B/C) carga de historia en modo histórico: consumo cronológico, FIFO, saldo que disminuye", () => {
  beforeEach(async () => { await modo(true); await saldoActual(); });

  it("B) 10 días de febrero de 2024 consumen del año 1 (el que correspondía); saldo 52.38 → 42.38; el consumo permanece en el año 1", async () => {
    const pv = await previsualizarRegistro(EMPRESA, EMP, "2024-02-05", "2024-02-16", 10);
    expect(pv.esHistorico).toBe(true); // período ya completado ⇒ motor cronológico, no el FIFO de hoy
    expect(pv.plan!.tramos[0].fechaEvaluacion).toBe("2024-02-05");
    expect(pv.plan!.tramos[0].disponiblePorPeriodo.map((d) => d.anioLaboral)).toEqual([1]); // solo el período que existía a esa fecha
    expect(pv.plan!.tramos[0].asignaciones).toEqual([expect.objectContaining({ anioLaboral: 1, dias: 10 })]);
    const r = await reg("2024-02-05", "2024-02-16", 10);
    expect(r).toMatchObject({ ok: true, historico: true });
    expect(detalleDe(1)).toBe(10);
    expect(resumen()).toEqual([[1, 15, 5, "Vigente"], [2, 15, 15, "Vigente"], [3, 15, 15, "Vigente"], [4, 7.38, 7.38, "Vigente"]]);
    expect(await saldoActual()).toBe(42.38);
  });

  it("C) dos cargas en orden cronológico (año 1 y luego año 2): FIFO por la fecha de cada una; el saldo disminuye con los consumos reales", async () => {
    await reg("2024-02-05", "2024-02-16", 10);
    await reg("2025-02-03", "2025-02-14", 10);
    // en febrero de 2025 el año 1 aún tenía 5 (sin vencimiento): FIFO toma 5 del año 1 y 5 del año 2
    expect([detalleDe(1), detalleDe(2)]).toEqual([10 + 5, 5]);
    expect(await saldoActual()).toBe(32.38);
    expect(vigentes()).toBe(32.38);
  });

  it("C') cargar en orden INVERSO nunca asigna arbitrariamente: si lo ya registrado agota un período que la fecha anterior necesitaba, exige una decisión explícita y no guarda nada", async () => {
    await reg("2025-02-03", "2025-02-14", 10); // FIFO: 10 del año 1 (el más antiguo disponible a esa fecha)
    const antes = bd.instantanea();
    const r = await reg("2024-02-05", "2024-02-16", 10); // el año 1 solo conserva 5 en total
    expect(r).toMatchObject({ ok: false, historico: true, codigo: "DECISION_REQUERIDA" });
    expect(r.plan!.deficit).toBe(5);
    expect(bd.instantanea()).toEqual(antes);
  });

  it("eliminar una vacación en modo histórico devuelve los días al período correcto y el saldo vuelve a subir (sin tope de 30)", async () => {
    await reg("2024-02-05", "2024-02-16", 10);
    const incId = bd.t.incidencias[0].id;
    const del = await eliminarRegistroVacaciones(EMPRESA, incId, "rrhh.ana");
    if (!del.ok) throw new Error(del.error);
    expect(del.diasAjustadosPorTope).toBe(0);
    expect(await saldoActual()).toBe(52.38);
    expect(detalleDe(1)).toBe(0);
  });
});

describe("D/E/M/O) activar y desactivar NO alteran la historia; al volver a NORMAL se recalcula con el motor (no con Math.min)", () => {
  const cargarHistoria = async () => {
    await modo(true); await saldoActual();
    await reg("2024-02-05", "2024-02-16", 10);
    bd.t.evidencias.push({ id: 1, empresa_id: EMPRESA, incidencia_id: bd.t.incidencias[0].id, ruta_archivo: "sintetica/evidencia-1.pdf" });
  };

  it("D/M) activar, desactivar y resincronizar varias veces no tocan incidencias, vacaciones, evidencias, detalle FIFO ni fecha_alta; el consumo no reaparece", async () => {
    await cargarHistoria();
    const antes = intactos(bd.instantanea());
    const consumo = consumoPorInc(bd.instantanea());
    for (const activo of [false, true, false, true]) {
      await modo(activo);
      await resincronizarSaldosEmpresa(EMPRESA, { usuario: "rrhh.ana" });
      await saldoActual();
      expect(intactos(bd.instantanea())).toEqual(antes);
      expect(consumoPorInc(bd.instantanea())).toEqual(consumo);
      for (const s of periodos()) {
        const consumido = bd.t.detalle.filter((d) => d.saldo_id === s.id).reduce((a, d) => a + d.dias_tomados, 0);
        expect(s.dias_disponibles).toBeLessThanOrEqual(r2(s.dias_otorgados - consumido) + 0.004); // lo consumido nunca reaparece
      }
    }
  });

  it("E/O) tras cargar 10 días en el año 1 y volver a NORMAL: regla normal reconstruida por el motor (año 1 vence con su saldo, el tope recorta del más antiguo VIGENTE), sin perder consumo", async () => {
    await cargarHistoria();
    expect(await saldoActual()).toBe(42.38);
    await modo(false);
    expect(await saldoActual()).toBe(30);
    // NO es Math.min(42.38, 30) sobre las mismas filas: el año 1 (con 5 sin usar) VENCE y se pierde; el tope recorta 7.38 del año 2
    expect(resumen()).toEqual([[1, 15, 0, "Vencido"], [2, 15, 7.62, "Vigente"], [3, 15, 15, "Vigente"], [4, 7.38, 7.38, "Vigente"]]);
    expect(detalleDe(1)).toBe(10); // el consumo histórico se conserva en su período
  });

  it("volver a activar rehabilita lo que el modo normal había vencido o recortado, sin duplicar consumos", async () => {
    await cargarHistoria();
    await modo(false); await saldoActual();
    await modo(true);
    expect(await saldoActual()).toBe(42.38);
    expect(bd.t.detalle).toHaveLength(1);
  });
});

describe("K) reparación individual (#423) bajo ambos modos", () => {
  const corrupta = (): Saldo[] => [
    { id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 1, periodo_inicio: "2023-06-01", periodo_fin: "2024-05-31", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
    { id: 2, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 2, periodo_inicio: "2024-05-31", periodo_fin: "2025-05-30", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
    { id: 3, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 3, periodo_inicio: "2025-04-13", periodo_fin: "2026-04-12", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
    { id: 4, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 4, periodo_inicio: "2026-04-13", periodo_fin: "2027-04-12", dias_otorgados: 7.5, dias_disponibles: 7.5, estado: "Vigente" },
  ];
  const conConsumo = () => bd.reiniciar({
    empleados: [emp()], saldos: corrupta(),
    incidencias: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: "2024-02-05", fecha_fin: "2024-02-16", dias_habiles: 10 }],
    vacaciones: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, fecha_inicio: "2024-02-05", fecha_fin: "2024-02-16", dias_habiles: 10, estado: "Aprobado" }],
    detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 10 }],
  });

  it("NORMAL: la serie reconstruida mantiene todos los años y el saldo utilizable ≤ 30", async () => {
    conConsumo();
    const p = (await previsualizarReparacion(EMPRESA, EMP))!;
    expect(p.puedeReparar).toBe(true);
    await repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" });
    expect(periodos().map((s) => s.anio_laboral)).toEqual([1, 2, 3, 4]);
    expect(vigentes()).toBeLessThanOrEqual(30);
    expect(periodos()[0]).toMatchObject({ estado: "Vencido", dias_disponibles: 0 });
  });

  it("CARGA HISTÓRICA: la reparación genera la serie completa con todos los años utilizables (saldo > 30 permitido) y conserva el consumo", async () => {
    conConsumo();
    await modo(true);
    const p = (await previsualizarReparacion(EMPRESA, EMP))!;
    expect(p.puedeReparar).toBe(true);
    expect(p.periodosPropuestos.every((x) => x.estado === "Vigente")).toBe(true);
    expect(p.saldoDespues).toBe(42.38);
    const antes = intactos(bd.instantanea());
    await repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" });
    expect(resumen()).toEqual([[1, 15, 5, "Vigente"], [2, 15, 15, "Vigente"], [3, 15, 15, "Vigente"], [4, 7.38, 7.38, "Vigente"]]);
    expect(vigentes()).toBe(42.38);
    expect(consumoPorInc(bd.instantanea())).toEqual([[10, 10]]);
    expect(intactos(bd.instantanea()).i).toEqual(antes.i);
    expect(intactos(bd.instantanea()).v).toEqual(antes.v);
  });
});

describe("L) reparación por lote (#425) bajo ambos modos", () => {
  const dos = () => bd.reiniciar({
    empleados: [emp(1), emp(2)],
    saldos: [1, 2].flatMap((id) => [1, 2, 3, 4].map((n) => ({
      id: id * 100 + n, empresa_id: EMPRESA, id_empleado: id, anio_laboral: n,
      periodo_inicio: `${2023 + n - 1}-06-01`, periodo_fin: `${2024 + n - 1}-05-31`, dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente",
    }))),
  });
  for (const activo of [false, true]) {
    it(`${activo ? "CARGA HISTÓRICA" : "NORMAL"}: se reparan los elegibles, cada uno en su transacción, y el saldo resultante respeta el modo`, async () => {
      dos();
      if (activo) await modo(true);
      const p = await previsualizarReparacionLote(EMPRESA);
      expect(p).toMatchObject({ pendientes: 2, elegibles: 2 });
      bd.eventos = [];
      const r = await repararLoteVacaciones(EMPRESA, p.filas.map((f) => ({ empleadoId: f.empleadoId, huella: f.huella! })), { usuario: "rrhh.ana" });
      expect(r).toMatchObject({ reparados: 2, errores: 0 });
      expect(bd.eventos.filter((e) => e === "BEGIN" || e === "COMMIT")).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
      for (const id of [1, 2]) {
        expect(periodos(id).map((s) => s.anio_laboral)).toEqual([1, 2, 3, 4]);
        expect(vigentes(id)).toBe(activo ? 52.38 : 30);
      }
    });
  }
});

describe("Registro y simulación respetan la política de la empresa", () => {
  it("en modo NORMAL el registro histórico sigue clasificándose por período Vencido hoy (#421 sin cambios)", async () => {
    await saldoActual();
    expect((await previsualizarRegistro(EMPRESA, EMP, "2024-02-05", "2024-02-16", 10)).esHistorico).toBe(true); // año 1: vencido hoy
    expect((await previsualizarRegistro(EMPRESA, EMP, "2025-06-02", "2025-06-06", 5)).esHistorico).toBe(false); // año 3: vigente hoy
  });
  it("la simulación de importación (reconstruirEmpleado) usa la misma política: sin vencimiento ni tope en carga histórica", () => {
    const hist = [{ origen: 1, inicio: "2024-02-05", fin: "2024-02-16", dias: 10, tipo: "Vacaciones" }];
    const e = { id: 1, codigo: "E-1", nombre: "x", fechaAlta: ALTA, fechaInicioLaboral: null };
    const normal = reconstruirEmpleado(e, hist, new Date(2026, 9, 8), new Set(), POLITICA_NORMAL);
    const historico = reconstruirEmpleado(e, hist, new Date(2026, 9, 8), new Set(), POLITICA_CARGA_HISTORICA);
    expect(normal.saldoFinal).toBe(30);
    expect(historico.saldoFinal).toBe(42.38);
    expect(historico.periodos.every((p) => p.estado === "Vigente")).toBe(true);
    expect(historico.consumos.map((c) => [c.anioLaboral, c.dias])).toEqual(normal.consumos.map((c) => [c.anioLaboral, c.dias]));
  });
});
