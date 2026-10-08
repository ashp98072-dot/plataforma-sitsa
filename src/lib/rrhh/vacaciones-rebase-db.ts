import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { query, type SqlParams } from "@/lib/db";
import { toIsoDate } from "./dates";
import { obtenerFeriadosEnRango } from "./vacaciones";
import { analizarTraslapes, aIso, deIso, periodoLaboral } from "./vacaciones-periodos";
import { RebaseBloqueadoError, planificarRebase, type BloqueoRebase, type HechoVacacion, type PlanRebase, type SaldoPrevio } from "./vacaciones-rebase";

/**
 * RRHH VACACIONES — REBASE al cambiar `empleados.fecha_alta` (capa de BD). Ver vacaciones-rebase.ts para las reglas.
 *
 * Se ejecuta DENTRO de la transacción de `actualizarEmpleado` (antes del UPDATE de la ficha): si el plan es aplicable se reemplaza la serie del
 * empleado (saldos_vacaciones y su detalle FIFO) por la nueva, conservando TODAS las incidencias/vacaciones (mismos IDs, sin tocar evidencias ni
 * otros tipos de incidencia); si hay un bloqueo o cualquier verificación falla se lanza un error y la transacción completa se revierte (la ficha
 * conserva su fecha_alta). Todas las consultas van acotadas por `empresa_id` y `id_empleado`.
 */

export const TIPOS = "('Vacaciones', 'A cuenta de Vacaciones')";
const TROZO = 400;
export const r2 = (n: number) => Math.round(n * 100) / 100;
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const trozos = <T,>(xs: readonly T[], t = TROZO): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += t) o.push(xs.slice(i, i + t)); return o; };

export { RebaseBloqueadoError };

export type Consulta = (sql: string, params?: SqlParams) => Promise<RowDataPacket[]>;

const SQL = {
  hechos: `SELECT id, tipo, fecha_inicio, fecha_fin, dias_habiles FROM incidencias WHERE empresa_id = ? AND id_empleado = ? AND tipo IN ${TIPOS} ORDER BY fecha_inicio, id`,
  detalleDeHechos: `SELECT d.id, d.incidencia_id, d.saldo_id, d.dias_tomados FROM detalle_consumo_vacaciones d INNER JOIN incidencias i ON i.id = d.incidencia_id WHERE i.empresa_id = ? AND i.id_empleado = ? AND i.tipo IN ${TIPOS} ORDER BY d.id`,
  detalleDeSaldos: `SELECT d.id, d.incidencia_id, d.saldo_id, d.dias_tomados FROM detalle_consumo_vacaciones d INNER JOIN saldos_vacaciones s ON s.id = d.saldo_id WHERE s.empresa_id = ? AND s.id_empleado = ? ORDER BY d.id`,
  saldos: "SELECT id, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ? ORDER BY id",
};

/** Línea de consumo de una vacación DEL empleado cuyo `saldo_id` no pertenece a (empresa, empleado): base corrupta que exige revisión administrada. */
type DetalleCruzado = { detalleId: number; incidenciaId: number; saldoId: number; duenoEmpresa: number | null; duenoEmpleado: number | null };
export type Hechos = { hechos: HechoVacacion[]; saldos: SaldoPrevio[]; detalleIds: number[]; ajenos: number[]; cruzados: DetalleCruzado[]; lineasPrevias: Map<number, number> };

export async function cargarHechos(consulta: Consulta, empresaId: number, idEmpleado: number, bloqueo: boolean): Promise<Hechos> {
  const fu = bloqueo ? " FOR UPDATE" : "";
  const inc = await consulta(SQL.hechos + fu, [empresaId, idEmpleado]);
  const detH = await consulta(SQL.detalleDeHechos + fu, [empresaId, idEmpleado]);
  const detS = await consulta(SQL.detalleDeSaldos + fu, [empresaId, idEmpleado]);
  const sal = await consulta(SQL.saldos + fu, [empresaId, idEmpleado]);
  // Dueño real de cada saldo al que apunta el detalle de las vacaciones del empleado (lectura simple, sin bloquear filas ajenas)
  const duenos = new Map<number, { empresa: number; empleado: number }>();
  const saldoIdsDetalle = [...new Set(detH.map((d) => Number(d.saldo_id)))];
  for (const t of trozos(saldoIdsDetalle)) {
    for (const r of await consulta(`SELECT id, empresa_id, id_empleado FROM saldos_vacaciones WHERE id IN (${ph(t.length)})`, t)) {
      duenos.set(Number(r.id), { empresa: Number(r.empresa_id), empleado: Number(r.id_empleado) });
    }
  }
  const cruzados: DetalleCruzado[] = detH
    .filter((d) => { const o = duenos.get(Number(d.saldo_id)); return !o || o.empresa !== empresaId || o.empleado !== idEmpleado; })
    .map((d) => { const o = duenos.get(Number(d.saldo_id)); return { detalleId: Number(d.id), incidenciaId: Number(d.incidencia_id), saldoId: Number(d.saldo_id), duenoEmpresa: o?.empresa ?? null, duenoEmpleado: o?.empleado ?? null }; });
  const consumo = new Map<number, number>();
  for (const d of detH) consumo.set(Number(d.incidencia_id), r2((consumo.get(Number(d.incidencia_id)) ?? 0) + Number(d.dias_tomados)));
  const ids = new Set(inc.map((i) => Number(i.id)));
  const porSaldo = new Map<number, number>();
  for (const d of detS) porSaldo.set(Number(d.saldo_id), r2((porSaldo.get(Number(d.saldo_id)) ?? 0) + Number(d.dias_tomados)));
  return {
    hechos: inc.map((i) => ({
      incidenciaId: Number(i.id), tipo: String(i.tipo), inicio: String(toIsoDate(i.fecha_inicio) ?? ""), fin: String(toIsoDate(i.fecha_fin) ?? ""),
      dias: Number(i.dias_habiles), consumido: consumo.get(Number(i.id)) ?? 0,
    })),
    saldos: sal.map((s) => ({
      id: Number(s.id), anioLaboral: s.anio_laboral != null ? Number(s.anio_laboral) : null, inicio: String(toIsoDate(s.periodo_inicio) ?? ""), fin: String(toIsoDate(s.periodo_fin) ?? ""),
      otorgados: Number(s.dias_otorgados), disponibles: Number(s.dias_disponibles), estado: String(s.estado),
      consumidos: porSaldo.get(Number(s.id)) ?? 0, conDetalle: porSaldo.has(Number(s.id)),
    })),
    detalleIds: [...new Set([...detH, ...detS].map((d) => Number(d.id)))],
    // detalle sobre saldos del empleado que NO proviene de sus incidencias de vacaciones: no se puede reubicar con certeza
    ajenos: detS.filter((d) => !ids.has(Number(d.incidencia_id))).map((d) => Number(d.id)),
    cruzados,
    lineasPrevias: consumo,
  };
}

/** HARD BLOCKERS de integridad del detalle FIFO (rebase y reparación): se validan en la vista previa y ANTES de cualquier escritura. */
export function bloqueosDeDetalle(h: Hechos, empresaId: number): BloqueoRebase[] {
  const out: BloqueoRebase[] = [];
  if (h.ajenos.length) {
    out.push({ codigo: "DETALLE_AJENO", mensaje: `Hay ${h.ajenos.length} línea(s) de consumo sobre los saldos del colaborador que no pertenecen a sus vacaciones registradas: no se pueden reubicar con certeza.` });
  }
  // consumo de una vacación del colaborador asociado a un saldo de OTRO empleado u OTRA empresa (o inexistente). Nunca se corrige, reasigna ni borra automáticamente.
  if (h.cruzados.length) {
    const ejemplo = h.cruzados.slice(0, 5).map((c) => `incidencia #${c.incidenciaId} → saldo #${c.saldoId}${c.duenoEmpresa == null ? " (inexistente)" : c.duenoEmpresa !== empresaId ? ` (de otra empresa, #${c.duenoEmpresa})` : ` (de otro empleado, #${c.duenoEmpleado})`}`).join("; ");
    out.push({
      codigo: "DETALLE_SALDO_AJENO",
      mensaje: `Existe consumo de una vacación del colaborador asociado a un saldo que no le pertenece (${h.cruzados.length} línea(s): ${ejemplo}${h.cruzados.length > 5 ? "…" : ""}). Requiere revisión administrada: no se corrige, reasigna ni borra automáticamente.`,
    });
  }
  return out;
}

async function armarPlan(consulta: Consulta, empresaId: number, idEmpleado: number, fechaAnterior: string | null, fechaNueva: string, hoy: Date, bloqueo: boolean) {
  const h = await cargarHechos(consulta, empresaId, idEmpleado, bloqueo);
  const fechas = h.hechos.flatMap((x) => [x.inicio, x.fin]).sort();
  const feriados = fechas.length ? await obtenerFeriadosEnRango(empresaId, fechas[0], fechas[fechas.length - 1]) : new Set<string>();
  const plan = planificarRebase({ fechaAnterior, fechaNueva, hoy, hechos: h.hechos, saldos: h.saldos, feriados });
  if (plan.aplica) plan.bloqueos.push(...bloqueosDeDetalle(h, empresaId));
  return { plan, datos: h };
}

/** Vista previa del rebase (SOLO LECTURA, pool): se usa antes de guardar la ficha. */
export async function previsualizarRebase(empresaId: number, idEmpleado: number, fechaNueva: string, hoy: Date = new Date()): Promise<PlanRebase & { traslapesActuales: number } | null> {
  const emp = await query<RowDataPacket[]>("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [idEmpleado, empresaId]);
  if (!emp.length) return null;
  const fechaAnterior = emp[0].fecha_alta ? toIsoDate(emp[0].fecha_alta as string | Date) : null;
  const consulta: Consulta = (sql, p) => query<RowDataPacket[]>(sql, p);
  const { plan, datos } = await armarPlan(consulta, empresaId, idEmpleado, fechaAnterior, fechaNueva, hoy, false);
  const traslapes = analizarTraslapes(datos.saldos.map((s) => ({ id: s.id, anioLaboral: s.anioLaboral, inicio: s.inicio, fin: s.fin, otorgados: s.otorgados, disponibles: s.disponibles, estado: s.estado, conConsumo: false }))).filter((a) => a.codigo === "TRASLAPE_REAL").length;
  return { ...plan, traslapesActuales: traslapes };
}

export type OpcionesReemplazo = {
  etiqueta: string; fechaTxt: string; fechaBase: string; usuario: string | null; hoy: Date; accion: string; detalle: Record<string, unknown>;
};

/**
 * Contenido (no solo conteos) que la serie NUNCA debe modificar: incidencias (todos los tipos), filas de `vacaciones`, evidencias y la fecha de alta
 * del colaborador. Se compara antes/después como texto; cualquier diferencia revierte la transacción.
 */
async function contenidoIntacto(consulta: Consulta, empresaId: number, idEmpleado: number): Promise<string> {
  const inc = await consulta("SELECT id, tipo, fecha_inicio, fecha_fin, dias_habiles FROM incidencias WHERE empresa_id = ? AND id_empleado = ? ORDER BY id", [empresaId, idEmpleado]);
  const vac = await consulta("SELECT id, fecha_inicio, fecha_fin, dias_habiles, estado FROM vacaciones WHERE empresa_id = ? AND id_empleado = ? ORDER BY id", [empresaId, idEmpleado]);
  const evi = await consulta("SELECT e.id, e.incidencia_id FROM evidencias_incidencias e INNER JOIN incidencias i ON i.id = e.incidencia_id WHERE i.empresa_id = ? AND i.id_empleado = ? ORDER BY e.id", [empresaId, idEmpleado]).catch(() => [] as RowDataPacket[]);
  const emp = await consulta("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [idEmpleado, empresaId]);
  return JSON.stringify({
    inc: inc.map((i) => [Number(i.id), String(i.tipo), toIsoDate(i.fecha_inicio), toIsoDate(i.fecha_fin), Number(i.dias_habiles)]),
    vac: vac.map((v) => [Number(v.id), toIsoDate(v.fecha_inicio), toIsoDate(v.fecha_fin), Number(v.dias_habiles), String(v.estado)]),
    evi: evi.map((e) => [Number(e.id), Number(e.incidencia_id)]),
    alta: emp[0]?.fecha_alta ? toIsoDate(emp[0].fecha_alta as string | Date) : null,
  });
}

/**
 * Reemplaza la serie del colaborador (saldos + detalle FIFO) por la del plan DENTRO de la transacción del llamador, verifica las invariantes y audita.
 * Compartido por el rebase de `fecha_alta` y por la reparación administrada. Cualquier verificación fallida lanza (el llamador revierte TODO).
 */
export async function reemplazarSerieEnConexion(
  conn: PoolConnection, consulta: Consulta, empresaId: number, idEmpleado: number, plan: PlanRebase, datos: Hechos, op: OpcionesReemplazo,
): Promise<void> {
  const cuenta = async (sql: string, p: SqlParams) => Number((await consulta(sql, p))[0]?.n ?? 0);
  const antes = {
    incidenciasVac: await cuenta(`SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND id_empleado = ? AND tipo IN ${TIPOS}`, [empresaId, idEmpleado]),
    otrasIncidencias: await cuenta(`SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND id_empleado = ? AND tipo NOT IN ${TIPOS}`, [empresaId, idEmpleado]),
    vacaciones: await cuenta("SELECT COUNT(*) AS n FROM vacaciones WHERE empresa_id = ? AND id_empleado = ?", [empresaId, idEmpleado]),
    saldosOtros: await cuenta("SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado <> ?", [empresaId, idEmpleado]),
    saldosOtrasEmpresas: await cuenta("SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id <> ?", [empresaId]),
    evidencias: await cuenta("SELECT COUNT(*) AS n FROM evidencias_incidencias e INNER JOIN incidencias i ON i.id = e.incidencia_id WHERE i.empresa_id = ? AND i.id_empleado = ?", [empresaId, idEmpleado]).catch(() => 0),
    contenido: await contenidoIntacto(consulta, empresaId, idEmpleado),
  };

  // 1) retira la serie anterior (detalle FIFO de sus saldos/incidencias y los saldos del empleado) — SOLO de este empleado y empresa
  for (const t of trozos(datos.detalleIds)) await conn.execute(`DELETE FROM detalle_consumo_vacaciones WHERE id IN (${ph(t.length)})`, t);
  await conn.execute("DELETE FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ?", [empresaId, idEmpleado]);

  // 2) serie nueva (una sola base) y detalle FIFO reasignado
  const saldoId = new Map<number, number>();
  for (const p of plan.periodos) {
    const [r] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
      "INSERT INTO saldos_vacaciones (empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [empresaId, idEmpleado, p.anioLaboral, p.inicio, p.fin, p.otorgados, p.disponibles, p.estado],
    );
    saldoId.set(p.anioLaboral, Number(r.insertId));
  }
  for (const l of plan.lineas) {
    await conn.execute("INSERT INTO detalle_consumo_vacaciones (incidencia_id, saldo_id, dias_tomados) VALUES (?, ?, ?)", [l.incidenciaId, saldoId.get(l.anioLaboral)!, l.dias]);
  }

  // 3) INVARIANTES (cualquier diferencia → error → ROLLBACK COMPLETO; la ficha no cambia)
  const fallo = (m: string) => new Error(`${op.etiqueta} abortado: ${m} No se modificó nada.`);
  const nuevos = await consulta(SQL.saldos, [empresaId, idEmpleado]);
  if (nuevos.length !== plan.periodos.length) throw fallo(`hay ${nuevos.length} período(s) y se esperaban ${plan.periodos.length}.`);
  const anios = new Set<number>();
  const nueva = deIso(op.fechaBase);
  for (const s of nuevos) {
    const anio = Number(s.anio_laboral);
    if (anios.has(anio)) throw fallo(`año laboral ${anio} duplicado.`);
    anios.add(anio);
    const esp = periodoLaboral(nueva, anio);
    if (String(toIsoDate(s.periodo_inicio)) !== aIso(esp.inicio) || String(toIsoDate(s.periodo_fin)) !== aIso(esp.fin)) throw fallo(`el período ${anio} no se deriva de ${op.fechaTxt}.`);
    if (Number(s.dias_disponibles) < 0 || Number(s.dias_disponibles) > Number(s.dias_otorgados)) throw fallo(`el período ${anio} tiene un disponible fuera de rango.`);
  }
  const filas = nuevos.map((s) => ({ id: Number(s.id), anioLaboral: Number(s.anio_laboral), inicio: String(toIsoDate(s.periodo_inicio)), fin: String(toIsoDate(s.periodo_fin)), otorgados: Number(s.dias_otorgados), disponibles: Number(s.dias_disponibles), estado: String(s.estado), conConsumo: false }));
  if (analizarTraslapes(filas).some((a) => a.codigo === "TRASLAPE_REAL")) throw fallo("quedaron períodos traslapados.");
  const usables = r2(filas.filter((f) => f.estado === "Vigente").reduce((t, f) => t + f.disponibles, 0));
  if (usables > 30) throw fallo(`el saldo utilizable (${usables}) supera 30 días.`);
  const detNuevo = await consulta(SQL.detalleDeHechos, [empresaId, idEmpleado]);
  const porInc = new Map<number, number>();
  for (const d of detNuevo) porInc.set(Number(d.incidencia_id), r2((porInc.get(Number(d.incidencia_id)) ?? 0) + Number(d.dias_tomados)));
  for (const h of datos.hechos) {
    if ((porInc.get(h.incidenciaId) ?? 0) !== h.consumido) throw fallo(`la incidencia ${h.incidenciaId} consumía ${h.consumido} día(s) y ahora ${porInc.get(h.incidenciaId) ?? 0}.`);
  }
  const totalDespues = r2([...porInc.values()].reduce((t, x) => t + x, 0));
  if (totalDespues !== plan.consumidoPreservado) throw fallo(`el total consumido cambió (${plan.consumidoPreservado} → ${totalDespues}).`);
  const idsSaldos = new Set(filas.map((f) => f.id));
  const detSaldos = await consulta(SQL.detalleDeSaldos, [empresaId, idEmpleado]);
  if (detSaldos.some((d) => !datos.hechos.some((h) => h.incidenciaId === Number(d.incidencia_id)) || !idsSaldos.has(Number(d.saldo_id)))) throw fallo("hay consumo que no pertenece a sus vacaciones.");
  if (detSaldos.length !== plan.lineas.length) throw fallo(`hay ${detSaldos.length} línea(s) de consumo y se esperaban ${plan.lineas.length} (posible duplicación).`);
  // ningún consumo reaparece como saldo: otorgado − consumido ≥ disponible en cada período
  for (const p of plan.periodos) {
    const f = filas.find((x) => x.anioLaboral === p.anioLaboral)!;
    if (f.disponibles > r2(f.otorgados - p.consumidos) + 0.004) throw fallo(`el período ${p.anioLaboral} muestra días consumidos como disponibles.`);
  }
  const despues = {
    incidenciasVac: await cuenta(`SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND id_empleado = ? AND tipo IN ${TIPOS}`, [empresaId, idEmpleado]),
    otrasIncidencias: await cuenta(`SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND id_empleado = ? AND tipo NOT IN ${TIPOS}`, [empresaId, idEmpleado]),
    vacaciones: await cuenta("SELECT COUNT(*) AS n FROM vacaciones WHERE empresa_id = ? AND id_empleado = ?", [empresaId, idEmpleado]),
    saldosOtros: await cuenta("SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado <> ?", [empresaId, idEmpleado]),
    saldosOtrasEmpresas: await cuenta("SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id <> ?", [empresaId]),
    evidencias: await cuenta("SELECT COUNT(*) AS n FROM evidencias_incidencias e INNER JOIN incidencias i ON i.id = e.incidencia_id WHERE i.empresa_id = ? AND i.id_empleado = ?", [empresaId, idEmpleado]).catch(() => 0),
    contenido: await contenidoIntacto(consulta, empresaId, idEmpleado),
  };
  for (const k of Object.keys(antes) as (keyof typeof antes)[]) if (antes[k] !== despues[k]) throw fallo(`cambió ${k}${typeof antes[k] === "number" ? ` (${antes[k]} → ${despues[k]})` : ""}.`);

  // 4) auditoría (misma transacción)
  await registrarAuditoriaTx(conn, { empresaId, usuario: op.usuario, accion: op.accion, modulo: "rrhh", detalle: JSON.stringify(op.detalle) });
}

export type ResultadoRebase = { aplicado: boolean; plan: PlanRebase };

/**
 * Rebasea la serie de vacaciones del empleado a `fechaNueva` DENTRO de la transacción del llamador (no confirma ni revierte).
 * - Misma fecha, o empleado sin saldos ni vacaciones: no hace nada (`aplicado: false`).
 * - Bloqueo o verificación fallida: lanza (el llamador revierte TODO y la ficha conserva su fecha_alta).
 */
export async function rebasearVacacionesEnConexion(
  conn: PoolConnection,
  empresaId: number,
  idEmpleado: number,
  fechaNueva: string,
  opciones: { usuario?: string | null; hoy?: Date } = {},
): Promise<ResultadoRebase> {
  const hoy = opciones.hoy ?? new Date();
  const consulta: Consulta = async (sql, p) => (await conn.query<RowDataPacket[]>(sql, p))[0];
  const [emp] = await conn.query<RowDataPacket[]>("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE", [idEmpleado, empresaId]);
  if (!emp.length) throw new Error("Empleado no encontrado.");
  const fechaAnterior = emp[0].fecha_alta ? toIsoDate(emp[0].fecha_alta as string | Date) : null;
  if (fechaAnterior === fechaNueva) return { aplicado: false, plan: planificarRebase({ fechaAnterior, fechaNueva, hoy, hechos: [], saldos: [], feriados: new Set() }) };

  const { plan, datos } = await armarPlan(consulta, empresaId, idEmpleado, fechaAnterior, fechaNueva, hoy, true);
  if (!plan.aplica) return { aplicado: false, plan };
  if (plan.bloqueos.length) throw new RebaseBloqueadoError(plan.bloqueos.map((b) => b.mensaje).join(" "), plan);
  // Defensa en profundidad: jamás se borra una línea de detalle que apunte a un saldo ajeno (el bloqueo anterior ya lo impide).
  if (datos.cruzados.length) throw new RebaseBloqueadoError("Detalle FIFO cruzado hacia saldos ajenos: requiere revisión administrada.", plan);

  await reemplazarSerieEnConexion(conn, consulta, empresaId, idEmpleado, plan, datos, {
    etiqueta: "Rebase de vacaciones", fechaTxt: "la nueva fecha de alta", fechaBase: fechaNueva, usuario: opciones.usuario ?? null, hoy,
    accion: "vacaciones_rebase_fecha_alta",
    detalle: {
      empleadoId: idEmpleado, fechaAnterior, fechaNueva, periodosAnteriores: plan.periodosAntes, periodosNuevos: plan.periodos.length,
      vacacionesConservadas: plan.vacaciones, consumidoPreservado: plan.consumidoPreservado, saldoAntes: plan.saldoAntes, saldoDespues: plan.saldoDespues,
      fecha: hoy.toISOString(),
    },
  });
  return { aplicado: true, plan };
}
