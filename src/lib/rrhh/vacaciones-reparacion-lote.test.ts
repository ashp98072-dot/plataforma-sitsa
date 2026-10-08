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
import { listarPendientesReparacion, previsualizarReparacion, previsualizarReparacionLote, repararLoteVacaciones, repararSerieVacaciones, type PreviaLote } from "./vacaciones-reparacion-db";
import { aIso, deIso, periodoLaboral } from "./vacaciones-periodos";

/** Datos 100 % sintéticos. Fecha de alta común 2023-04-13; "hoy" = 2026-10-08. */
const ALTA = "2023-04-13";
const OTRA_EMPRESA = 8;
const hoyFijo = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 8, 12)); };
const r2 = (n: number) => Math.round(n * 100) / 100;

type Tipo = "otraBase" | "traslape" | "fuera" | "correcta";
const sal = (id: number, emp: number, empresa: number, anio: number, ini: string, fin: string, otorg = 15, disp = 15, estado = "Vigente"): Saldo =>
  ({ id, empresa_id: empresa, id_empleado: emp, anio_laboral: anio, periodo_inicio: ini, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp, estado });
const correcta = (emp: number, empresa: number, b: number) => [1, 2, 3, 4].map((n) => { const p = periodoLaboral(deIso(ALTA), n); return sal(b + n, emp, empresa, n, aIso(p.inicio), aIso(p.fin), n === 4 ? 7.5 : 15, n === 4 ? 7.5 : 15, n === 1 ? "Vencido" : "Vigente"); });
function saldosDe(tipo: Tipo, emp: number, empresa = EMPRESA): Saldo[] {
  const b = emp * 100;
  if (tipo === "correcta") return correcta(emp, empresa, b);
  if (tipo === "otraBase") return [1, 2, 3, 4].map((n) => { const p = periodoLaboral(deIso("2023-06-01"), n); return sal(b + n, emp, empresa, n, aIso(p.inicio), aIso(p.fin)); });
  if (tipo === "traslape") return [sal(b + 1, emp, empresa, 1, "2023-06-01", "2024-05-31"), sal(b + 2, emp, empresa, 2, "2024-05-31", "2025-05-30"), sal(b + 3, emp, empresa, 3, "2025-04-13", "2026-04-12"), sal(b + 4, emp, empresa, 4, "2026-04-13", "2027-04-12", 7.5, 7.5)];
  return [...correcta(emp, empresa, b), sal(b + 9, emp, empresa, 9, "2031-04-13", "2032-04-12")]; // año laboral fuera de la serie, reconstruible
}
const esperada = [1, 2, 3, 4].map((n) => { const p = periodoLaboral(deIso(ALTA), n); return [n, aIso(p.inicio), aIso(p.fin)]; });

type Cfg = { emp: number; tipo: Tipo; empresa?: number; alta?: string | null; consumo?: boolean };
/** Arma la BD: empleados con su serie y, si `consumo`, una vacación de 5 días (ago-2024) ligada al saldo #2 de su serie, con espejo y evidencia. */
function armar(cfgs: Cfg[]) {
  const t: Partial<Tablas> = { empleados: [], saldos: [], incidencias: [], vacaciones: [], detalle: [], evidencias: [] };
  for (const c of cfgs) {
    const empresa = c.empresa ?? EMPRESA;
    t.empleados!.push({ id: c.emp, empresa_id: empresa, nombre: `Colaborador ${c.emp}`, fecha_alta: c.alta === undefined ? ALTA : c.alta });
    t.saldos!.push(...saldosDe(c.tipo, c.emp, empresa));
    if (c.consumo !== false) {
      const inc = c.emp * 10;
      t.incidencias!.push({ id: inc, empresa_id: empresa, id_empleado: c.emp, tipo: "Vacaciones", fecha_inicio: "2024-08-05", fecha_fin: "2024-08-09", dias_habiles: 5 });
      t.vacaciones!.push({ id: inc, empresa_id: empresa, id_empleado: c.emp, fecha_inicio: "2024-08-05", fecha_fin: "2024-08-09", dias_habiles: 5, estado: "Aprobado" });
      t.detalle!.push({ id: c.emp, incidencia_id: inc, saldo_id: c.emp * 100 + 2, dias_tomados: 5 });
      t.evidencias!.push({ id: c.emp, empresa_id: empresa, incidencia_id: inc, ruta_archivo: `sintetica/evidencia-${c.emp}.pdf` });
    }
  }
  bd.reiniciar(t);
}
const periodosDe = (emp: number, empresa = EMPRESA) => bd.t.saldos.filter((s) => s.id_empleado === emp && s.empresa_id === empresa).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
const fechasDe = (emp: number) => periodosDe(emp).map((s) => [s.anio_laboral, s.periodo_inicio, s.periodo_fin]);
const delEmpleado = (t: Tablas, emp: number) => ({
  saldos: t.saldos.filter((s) => s.id_empleado === emp),
  incidencias: t.incidencias.filter((i) => i.id_empleado === emp), vacaciones: t.vacaciones.filter((v) => v.id_empleado === emp),
  detalle: t.detalle.filter((d) => t.incidencias.some((i) => i.id === d.incidencia_id && i.id_empleado === emp)),
  evidencias: t.evidencias.filter((e) => t.incidencias.some((i) => i.id === e.incidencia_id && i.id_empleado === emp)),
  empleado: t.empleados.filter((e) => e.id === emp),
});
const consumoPorInc = (t: Tablas) => { const m = new Map<number, number>(); for (const d of t.detalle) m.set(d.incidencia_id, r2((m.get(d.incidencia_id) ?? 0) + d.dias_tomados)); return [...m].sort((a, b) => a[0] - b[0]); };
const itemsElegibles = (p: PreviaLote) => p.filas.filter((f) => f.estado === "ELEGIBLE").map((f) => ({ empleadoId: f.empleadoId, huella: f.huella! }));
const transacciones = () => bd.eventos.filter((e) => e === "BEGIN" || e === "COMMIT" || e === "ROLLBACK");
const usuario = "rrhh.ana";

beforeEach(hoyFijo);
afterEach(() => vi.useRealTimers());

describe("Vista previa GLOBAL: solo lectura, con resumen y estado por colaborador", () => {
  beforeEach(() => armar([{ emp: 1, tipo: "otraBase" }, { emp: 2, tipo: "traslape" }, { emp: 3, tipo: "otraBase", alta: null }, { emp: 4, tipo: "correcta" }, { emp: 50, tipo: "traslape", empresa: OTRA_EMPRESA }]));

  it("cuenta pendientes/elegibles/bloqueados/sin cambios, no incluye correctos ni otra empresa y NO escribe nada", async () => {
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const p = await previsualizarReparacionLote(EMPRESA);
    expect(p).toMatchObject({ pendientes: 3, elegibles: 2, bloqueados: 1, sinCambios: 0 });
    expect(p.filas.map((f) => [f.empleadoId, f.estado])).toEqual([[1, "ELEGIBLE"], [2, "ELEGIBLE"], [3, "BLOQUEADO"]]);
    expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
    expect(bd.instantanea()).toEqual(antes);
    expect(bd.eventos).toEqual([]); // ni siquiera abre transacciones
  });

  it("cada fila trae fecha, motivos, períodos actuales y propuestos, saldos, consumo y bloqueos; la huella solo para ELEGIBLES", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    const [f1, , f3] = p.filas;
    expect(f1).toMatchObject({ nombre: "Colaborador 1", fechaAlta: ALTA, consumidoPreservado: 5, bloqueos: [] });
    expect(f1.motivos).toContain("PERIODO_FUERA_DE_BASE");
    expect(f1.periodosActuales).toHaveLength(4);
    expect(f1.periodosPropuestos.map((x) => [x.anioLaboral, x.inicio, x.fin])).toEqual(esperada);
    expect(f1.huella).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof f1.saldoAntes).toBe("number");
    expect(typeof f1.saldoDespues).toBe("number");
    expect(f3).toMatchObject({ estado: "BLOQUEADO", fechaAlta: null, huella: null });
    expect(f3.motivos).toEqual(["FECHA_ALTA_AUSENTE"]);
    expect(f3.bloqueos[0].mensaje).toContain("fecha de contratación");
  });
});

describe("1/8/9/10) los elegibles se reparan todos, cada uno con el motor individual", () => {
  beforeEach(() => armar([{ emp: 1, tipo: "otraBase" }, { emp: 2, tipo: "traslape" }, { emp: 3, tipo: "fuera" }]));

  it("3 elegibles ⇒ 3 reparados: otra base, traslape y año laboral fuera de la serie", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    expect(p).toMatchObject({ pendientes: 3, elegibles: 3, bloqueados: 0 });
    const r = await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    expect(r).toMatchObject({ solicitados: 3, reparados: 3, bloqueados: 0, cambiosDesdePreview: 0, sinCambios: 0, errores: 0 });
    expect(r.resultados.every((x) => x.resultado === "REPARADO")).toBe(true);
    for (const emp of [1, 2, 3]) expect(fechasDe(emp)).toEqual(esperada);
    expect((await listarPendientesReparacion(EMPRESA)).total).toBe(0); // 20) ya no queda ningún pendiente
  });

  it("12-17/18) consumo total y por incidencia, incidencias, vacaciones, evidencias y fecha_alta intactos; auditoría individual por cada reparado", async () => {
    const antes = bd.instantanea();
    const p = await previsualizarReparacionLote(EMPRESA);
    await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    const d = bd.t;
    expect(consumoPorInc(d)).toEqual(consumoPorInc(antes));
    expect(d.incidencias).toEqual(antes.incidencias);
    expect(d.vacaciones).toEqual(antes.vacaciones);
    expect(d.evidencias).toEqual(antes.evidencias);
    expect(d.empleados).toEqual(antes.empleados);
    const ind = d.auditoria.filter((a) => a.accion === "vacaciones_reparacion_serie");
    expect(ind).toHaveLength(3);
    expect(ind.map((a) => JSON.parse(a.detalle!).empleadoId).sort()).toEqual([1, 2, 3]);
    expect(ind.every((a) => a.usuario === usuario && a.empresa_id === EMPRESA)).toBe(true);
  });

  it("19) el resumen del lote queda auditado (vacaciones_reparacion_lote) además de la auditoría individual", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    const lote = bd.t.auditoria.filter((a) => a.accion === "vacaciones_reparacion_lote");
    expect(lote).toHaveLength(1);
    expect(JSON.parse(lote[0].detalle!)).toMatchObject({ empresaId: EMPRESA, usuario, cantidadSolicitada: 3, reparados: 3, bloqueados: 0, cambiosPreview: 0, errores: 0 });
  });

  it("4) cada colaborador usa su PROPIA transacción (BEGIN/COMMIT por empleado), no una gigante", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    bd.eventos = [];
    await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    expect(transacciones()).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
  });

  it("los duplicados en la lista se procesan una sola vez", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    const it = itemsElegibles(p);
    const r = await repararLoteVacaciones(EMPRESA, [...it, ...it], { usuario });
    expect(r).toMatchObject({ solicitados: 3, reparados: 3 });
    expect(bd.t.auditoria.filter((a) => a.accion === "vacaciones_reparacion_serie")).toHaveLength(3);
  });
});

describe("2/7) elegibles + bloqueados: el bloqueado jamás se modifica y sigue en pendientes", () => {
  beforeEach(() => armar([{ emp: 1, tipo: "otraBase" }, { emp: 2, tipo: "traslape" }, { emp: 3, tipo: "traslape", alta: null }]));

  it("2 elegibles + 1 bloqueado (sin fecha de alta) ⇒ reparados=2, bloqueado=1 y el bloqueado queda intacto", async () => {
    const intacto = delEmpleado(bd.instantanea(), 3);
    const p = await previsualizarReparacionLote(EMPRESA);
    expect(p).toMatchObject({ elegibles: 2, bloqueados: 1 });
    // el servidor no confía en el cliente: aunque se envíe también al bloqueado (con la huella de su vista individual), queda BLOQUEADO
    const huella3 = (await previsualizarReparacion(EMPRESA, 3))!.huella;
    const r = await repararLoteVacaciones(EMPRESA, [...itemsElegibles(p), { empleadoId: 3, huella: huella3 }], { usuario });
    expect(r).toMatchObject({ solicitados: 3, reparados: 2, bloqueados: 1 });
    expect(r.resultados.find((x) => x.empleadoId === 3)).toMatchObject({ resultado: "BLOQUEADO" });
    expect(r.resultados.find((x) => x.empleadoId === 3)!.mensaje).toContain("requiere revisión manual");
    expect(delEmpleado(bd.t, 3)).toEqual(intacto);
    expect((await listarPendientesReparacion(EMPRESA)).empleados.map((e) => e.empleadoId)).toEqual([3]); // 20) solo queda el bloqueado
    expect(bd.t.auditoria.filter((a) => a.accion === "vacaciones_reparacion_serie")).toHaveLength(2);
  });

  it("los bloqueos del motor individual (DETALLE_AJENO) tampoco se reparan en lote", async () => {
    armar([{ emp: 1, tipo: "otraBase" }, { emp: 2, tipo: "traslape" }]);
    bd.t.incidencias.push({ id: 90, empresa_id: EMPRESA, id_empleado: 7, tipo: "Vacaciones", fecha_inicio: "2025-07-07", fecha_fin: "2025-07-08", dias_habiles: 2 });
    bd.t.detalle.push({ id: 91, incidencia_id: 90, saldo_id: 202, dias_tomados: 2 });
    const intacto = delEmpleado(bd.instantanea(), 2);
    const p = await previsualizarReparacionLote(EMPRESA);
    expect(p.filas.find((f) => f.empleadoId === 2)).toMatchObject({ estado: "BLOQUEADO", huella: null });
    expect(p.filas.find((f) => f.empleadoId === 2)!.bloqueos.map((b) => b.codigo)).toContain("DETALLE_AJENO");
    const r = await repararLoteVacaciones(EMPRESA, [...itemsElegibles(p), { empleadoId: 2, huella: (await previsualizarReparacion(EMPRESA, 2))!.huella }], { usuario });
    expect(r).toMatchObject({ reparados: 1, bloqueados: 1 });
    expect(delEmpleado(bd.t, 2)).toEqual(intacto);
  });
});

describe("3) un colaborador que falla no revierte a los anteriores ni detiene a los siguientes", () => {
  it("el segundo falla al insertar sus saldos: el primero queda confirmado, el segundo intacto con ROLLBACK, el tercero se repara", async () => {
    armar([{ emp: 1, tipo: "otraBase" }, { emp: 2, tipo: "traslape" }, { emp: 3, tipo: "otraBase" }]);
    const p = await previsualizarReparacionLote(EMPRESA);
    const intacto2 = delEmpleado(bd.instantanea(), 2);
    let borrados = 0;
    bd.fallarSi = (sql) => { if (sql.startsWith("DELETE FROM saldos_vacaciones")) borrados++; return borrados === 2 && sql.startsWith("INSERT INTO saldos_vacaciones"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    bd.eventos = [];
    const r = await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    bd.fallarSi = null;
    expect(r.resultados.map((x) => [x.empleadoId, x.resultado])).toEqual([[1, "REPARADO"], [2, "ERROR"], [3, "REPARADO"]]);
    expect(r).toMatchObject({ reparados: 2, errores: 1 });
    expect(fechasDe(1)).toEqual(esperada);
    expect(fechasDe(3)).toEqual(esperada);
    expect(delEmpleado(bd.t, 2)).toEqual(intacto2);
    expect(transacciones()).toEqual(["BEGIN", "COMMIT", "BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]);
    expect(bd.t.auditoria.filter((a) => a.accion === "vacaciones_reparacion_serie").map((a) => JSON.parse(a.detalle!).empleadoId)).toEqual([1, 3]);
    expect(JSON.parse(bd.t.auditoria.find((a) => a.accion === "vacaciones_reparacion_lote")!.detalle!)).toMatchObject({ cantidadSolicitada: 3, reparados: 2, errores: 1 });
    expect(r.resultados[1].mensaje).not.toContain("fallo inyectado"); // sin detalles internos
  });
});

describe("5/11) cambios entre la vista previa y la confirmación: solo aborta el afectado", () => {
  beforeEach(() => armar([{ emp: 1, tipo: "otraBase" }, { emp: 2, tipo: "traslape" }, { emp: 3, tipo: "otraBase" }]));

  it("5) si se registra una vacación del colaborador 2 después de la vista previa, solo ese queda CAMBIO_DESDE_PREVIEW y sin escribir", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    bd.t.incidencias.push({ id: 25, empresa_id: EMPRESA, id_empleado: 2, tipo: "Vacaciones", fecha_inicio: "2025-02-03", fecha_fin: "2025-02-07", dias_habiles: 5 });
    bd.t.vacaciones.push({ id: 25, empresa_id: EMPRESA, id_empleado: 2, fecha_inicio: "2025-02-03", fecha_fin: "2025-02-07", dias_habiles: 5, estado: "Aprobado" });
    bd.t.detalle.push({ id: 25, incidencia_id: 25, saldo_id: 202, dias_tomados: 5 });
    const intacto2 = delEmpleado(bd.instantanea(), 2);
    const r = await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    expect(r.resultados.map((x) => [x.empleadoId, x.resultado])).toEqual([[1, "REPARADO"], [2, "CAMBIO_DESDE_PREVIEW"], [3, "REPARADO"]]);
    expect(r).toMatchObject({ reparados: 2, cambiosDesdePreview: 1 });
    expect(delEmpleado(bd.t, 2)).toEqual(intacto2);
  });

  it("11) si un colaborador ya fue reparado entre la vista previa y la confirmación ⇒ SIN_CAMBIOS y no se escribe para él", async () => {
    const p = await previsualizarReparacionLote(EMPRESA);
    await repararSerieVacaciones(EMPRESA, 2, { huella: p.filas.find((f) => f.empleadoId === 2)!.huella!, usuario });
    const despuesIndividual = delEmpleado(bd.instantanea(), 2);
    const auditorias = bd.t.auditoria.length;
    bd.ejecutadas = [];
    const r = await repararLoteVacaciones(EMPRESA, itemsElegibles(p), { usuario });
    expect(r.resultados.find((x) => x.empleadoId === 2)).toMatchObject({ resultado: "SIN_CAMBIOS" });
    expect(r).toMatchObject({ reparados: 2, sinCambios: 1 });
    expect(delEmpleado(bd.t, 2)).toEqual(despuesIndividual);
    // la única escritura asociada a 2 no existe: sin DELETE/INSERT de saldos para su id durante este lote más allá de las de 1 y 3
    expect(bd.t.auditoria.length).toBe(auditorias + 2 + 1); // 2 individuales (1 y 3) + el resumen del lote
  });

  it("una huella inválida o ajena nunca repara: CAMBIO_DESDE_PREVIEW sin escribir", async () => {
    const intacto = delEmpleado(bd.instantanea(), 1);
    const r = await repararLoteVacaciones(EMPRESA, [{ empleadoId: 1, huella: "f".repeat(32) }], { usuario });
    expect(r.resultados[0].resultado).toBe("CAMBIO_DESDE_PREVIEW");
    expect(delEmpleado(bd.t, 1)).toEqual(intacto);
  });
});

describe("6/17) aislamiento: otra empresa y otros colaboradores jamás entran ni se modifican", () => {
  it("un colaborador de OTRA empresa enviado en el lote no se encuentra y queda intacto; el lote de esa empresa solo lo ve desde su propio tenant", async () => {
    armar([{ emp: 1, tipo: "otraBase" }, { emp: 50, tipo: "traslape", empresa: OTRA_EMPRESA }, { emp: 4, tipo: "correcta" }]);
    const intactoAjeno = delEmpleado(bd.instantanea(), 50);
    const intactoCorrecto = delEmpleado(bd.instantanea(), 4);
    expect((await previsualizarReparacionLote(EMPRESA)).filas.map((f) => f.empleadoId)).toEqual([1]); // 50 no aparece en la vista previa de EMPRESA
    const huellaAjena = (await previsualizarReparacion(OTRA_EMPRESA, 50))!.huella; // válida, pero para su propia empresa
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await repararLoteVacaciones(EMPRESA, [{ empleadoId: 1, huella: (await previsualizarReparacionLote(EMPRESA)).filas[0].huella! }, { empleadoId: 50, huella: huellaAjena }, { empleadoId: 4, huella: "a".repeat(32) }], { usuario });
    expect(r.resultados.map((x) => [x.empleadoId, x.resultado])).toEqual([[1, "REPARADO"], [50, "ERROR"], [4, "SIN_CAMBIOS"]]);
    expect(delEmpleado(bd.t, 50)).toEqual(intactoAjeno);
    expect(delEmpleado(bd.t, 4)).toEqual(intactoCorrecto);
    expect(bd.t.auditoria.every((a) => a.empresa_id === EMPRESA)).toBe(true);
    expect((await previsualizarReparacionLote(OTRA_EMPRESA)).filas.map((f) => f.empleadoId)).toEqual([50]);
  });
});
