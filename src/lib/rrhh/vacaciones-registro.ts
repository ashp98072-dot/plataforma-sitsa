import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { getPool, query } from "@/lib/db";
import { toIsoDate } from "./dates";
import {
  obtenerFeriadosEnRango,
  registrarVacacionesFifoEnConexion,
  sincronizarPeriodosVacacionesEnConexion,
  type DesgloseConsumo,
  type ResultadoVacacionesFifo,
  type VacacionesFifoInput,
} from "./vacaciones";
import {
  clasificarRegistro,
  planificarConsumoHistorico,
  type PeriodoBD,
  type PlanHistorico,
} from "./vacaciones-historico";
import { deIso } from "./vacaciones-periodos";

/**
 * RRHH VACACIONES — REGISTRO CON SOPORTE HISTÓRICO (orquestador). Extiende el registro actual SIN cambiar su lógica:
 *
 *  - Si la fecha de inicio NO cae en un período que hoy está Vencido (período actual, últimos períodos vigentes, fechas futuras o fecha de
 *    alta ausente) se ejecuta EXACTAMENTE el flujo de siempre (`sincronizar` + `registrarVacacionesFifoEnConexion`): cero cambios.
 *  - Si cae en un período Vencido hoy ⇒ REGISTRO HISTÓRICO: se calcula la disponibilidad EN LA FECHA de la vacación
 *    (`planificarConsumoHistorico`), se valida (fecha de alta, superposición, períodos, déficit, cruce de aniversario) y, todo en UNA
 *    transacción, se guarda la incidencia, la fila espejo en `vacaciones`, el detalle FIFO exacto y se descuenta el saldo de hoy SOLO de los
 *    períodos que siguen Vigentes (un período Vencido no se reactiva ni recupera días; el consumo queda en el historial).
 *
 * La causa de la limitación anterior: `registrarVacacionesFifoEnConexion` filtra `estado = 'Vigente' AND dias_disponibles > 0`.
 */

export type DecisionRegistro = { huella: string; motivo: string };
export type EntradaRegistro = VacacionesFifoInput & { decision?: DecisionRegistro; usuario?: string | null };
export type ResultadoRegistro = ResultadoVacacionesFifo & {
  historico?: boolean;
  /** Código del bloqueo / decisión requerida (si ok = false por una regla del registro histórico). */
  codigo?: string;
  plan?: PlanHistorico;
  requiereDecision?: boolean;
};

const MIN_MOTIVO = 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const hoyCero = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

const SQL_SALDOS = `SELECT s.id, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado,
              COALESCE((SELECT SUM(d.dias_tomados) FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id), 0) AS dias_consumidos
       FROM saldos_vacaciones s
       WHERE s.empresa_id = ? AND s.id_empleado = ?
       ORDER BY COALESCE(s.anio_laboral, 99999), s.periodo_inicio, s.id`;

const aPeriodos = (rows: RowDataPacket[]): PeriodoBD[] =>
  rows.map((r) => ({
    id: Number(r.id), anioLaboral: r.anio_laboral != null ? Number(r.anio_laboral) : null, inicio: String(toIsoDate(r.periodo_inicio) ?? ""), fin: String(toIsoDate(r.periodo_fin) ?? ""),
    otorgados: Number(r.dias_otorgados), disponibles: Number(r.dias_disponibles), estado: String(r.estado), consumidoDetalle: r2(Number(r.dias_consumidos ?? 0)),
  }));

const fechaAlta = (rows: RowDataPacket[]): Date | null => (rows[0]?.fecha_alta ? deIso(String(toIsoDate(rows[0].fecha_alta as string | Date))) : null);

const SQL_SUPERPOSICION = `SELECT id, tipo, fecha_inicio, fecha_fin FROM incidencias
       WHERE empresa_id = ? AND id_empleado = ? AND tipo IN ('Vacaciones', 'A cuenta de Vacaciones') AND fecha_inicio <= ? AND fecha_fin >= ?`;

/** Vacaciones del mismo empleado que se solapan con [inicio, fin]. */
function superposiciones(rows: RowDataPacket[]) {
  return rows.map((r) => ({ id: Number(r.id), tipo: String(r.tipo), inicio: String(toIsoDate(r.fecha_inicio) ?? ""), fin: String(toIsoDate(r.fecha_fin) ?? "") }));
}
const mensajeSuperposicion = (s: ReturnType<typeof superposiciones>) =>
  `Ya existe ${s.length === 1 ? "una vacación" : `${s.length} vacaciones`} del colaborador que se superpone${s.length === 1 ? "" : "n"} con estas fechas: ${s.map((x) => `${x.tipo} ${x.inicio} → ${x.fin} (#${x.id})`).join("; ")}. No se guardó nada.`;

/* ------------------------------------------------------------------ vista previa (SOLO LECTURA) */

export type PrevisualizacionRegistro = {
  /** false si el tipo no descuenta saldo o no hay nada que evaluar. */
  aplica: boolean;
  esHistorico: boolean;
  plan: PlanHistorico | null;
  superposiciones: { id: number; tipo: string; inicio: string; fin: string }[];
  /** true si ya se puede guardar (sin bloqueos ni superposición); si requiere decisión, además hay que enviarla. */
  puedeGuardar: boolean;
};

/**
 * Previsualiza el consumo histórico ANTES del POST real. Solo SELECT (pool): no sincroniza ni escribe. Si algún período todavía no existe
 * en `saldos_vacaciones` lo informa en `plan.faltantes` (se genera al guardar).
 */
export async function previsualizarRegistro(
  empresaId: number, idEmpleado: number, fechaInicio: string, fechaFin: string, dias: number,
): Promise<PrevisualizacionRegistro> {
  const emp = await query<RowDataPacket[]>("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [idEmpleado, empresaId]);
  if (!emp.length) return { aplica: false, esHistorico: false, plan: null, superposiciones: [], puedeGuardar: false };
  const base = fechaAlta(emp);
  const periodos = aPeriodos(await query<RowDataPacket[]>(SQL_SALDOS, [empresaId, idEmpleado]));
  const feriados = await obtenerFeriadosEnRango(empresaId, fechaInicio, fechaFin);
  const plan = planificarConsumoHistorico({ base, hoy: hoyCero(), inicio: fechaInicio, fin: fechaFin, dias, feriados, periodos });
  const sup = plan.esHistorico ? superposiciones(await query<RowDataPacket[]>(SQL_SUPERPOSICION, [empresaId, idEmpleado, fechaFin, fechaInicio])) : [];
  return {
    aplica: true, esHistorico: plan.esHistorico, plan, superposiciones: sup,
    puedeGuardar: plan.esHistorico && plan.bloqueos.length === 0 && sup.length === 0,
  };
}

/* ------------------------------------------------------------------ registro transaccional */

export async function registrarVacaciones(input: EntradaRegistro): Promise<ResultadoRegistro> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const sync = await sincronizarPeriodosVacacionesEnConexion(conn, input.empresaId, input.idEmpleado);

    const [empRows] = await conn.query<RowDataPacket[]>("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [input.idEmpleado, input.empresaId]);
    const base = fechaAlta(empRows);
    const [saldoRows] = await conn.query<RowDataPacket[]>(`${SQL_SALDOS} FOR UPDATE`, [input.empresaId, input.idEmpleado]);
    const periodos = aPeriodos(saldoRows);
    const hoy = hoyCero();
    // Una vacación anterior a la fecha de alta jamás se registra (ni normal ni histórica).
    if (base && /^\d{4}-\d{2}-\d{2}$/.test(input.fechaInicio) && deIso(input.fechaInicio) < base) {
      await conn.rollback();
      return { ok: false, mensaje: `La vacación empieza (${input.fechaInicio}) antes de la fecha de alta del colaborador: no se puede registrar.`, desglose: [], incidenciaId: null, codigo: "ANTERIOR_A_FECHA_ALTA" };
    }
    const cls = base ? clasificarRegistro(base, hoy, input.fechaInicio, periodos) : null;

    // Camino NORMAL: idéntico al de siempre (período actual, vigentes recientes, futuras, sin fecha de alta…)
    if (!cls || !cls.esHistorico) {
      const resultado = await registrarVacacionesFifoEnConexion(conn, input);
      if (!resultado.ok) { await conn.rollback(); return resultado; }
      await conn.commit();
      return resultado;
    }

    // Camino HISTÓRICO
    const rechazo = async (r: ResultadoRegistro): Promise<ResultadoRegistro> => { await conn.rollback(); return r; };
    const feriados = await obtenerFeriadosEnRango(input.empresaId, input.fechaInicio, input.fechaFin);
    const plan = planificarConsumoHistorico({ base, hoy, inicio: input.fechaInicio, fin: input.fechaFin, dias: input.diasATomar, feriados, periodos });
    if (plan.bloqueos.length) return rechazo({ ok: false, mensaje: plan.bloqueos.map((b) => b.mensaje).join(" "), desglose: [], incidenciaId: null, historico: true, codigo: plan.bloqueos[0].codigo, plan });
    if (sync.requiereReparacion || sync.omitido) {
      return rechazo({ ok: false, mensaje: "La serie de períodos de este colaborador está congelada (estructura inconsistente o serie histórica con consumo que no coincide con su fecha de alta): requiere reparación administrada antes de registrar vacaciones históricas.", desglose: [], incidenciaId: null, historico: true, codigo: "ESTRUCTURA_CONGELADA" });
    }
    const [supRows] = await conn.query<RowDataPacket[]>(SQL_SUPERPOSICION, [input.empresaId, input.idEmpleado, input.fechaFin, input.fechaInicio]);
    const sup = superposiciones(supRows);
    if (sup.length) return rechazo({ ok: false, mensaje: mensajeSuperposicion(sup), desglose: [], incidenciaId: null, historico: true, codigo: "SUPERPOSICION", plan });
    if (plan.faltantes.length) {
      return rechazo({ ok: false, mensaje: `Faltan los períodos ${plan.faltantes.join(", ")} en saldos_vacaciones y no se pudieron generar desde la fecha de alta: requiere revisión administrada.`, desglose: [], incidenciaId: null, historico: true, codigo: "PERIODO_INEXISTENTE", plan });
    }
    if (plan.requiereDecision) {
      const d = input.decision;
      if (!d || d.huella !== plan.huella || String(d.motivo ?? "").trim().length < MIN_MOTIVO) {
        return rechazo({
          ok: false, historico: true, codigo: "DECISION_REQUERIDA", requiereDecision: true, plan, desglose: [], incidenciaId: null,
          mensaje: `Este registro histórico requiere una decisión explícita de RRHH (${plan.decisiones.map((x) => x.codigo).join(", ")}): confirme la propuesta indicando el motivo (mínimo ${MIN_MOTIVO} caracteres). No se guardó nada.`,
        });
      }
    }

    // --- Escritura (misma forma que el registro normal) ---
    const [ins] = await conn.execute<ResultSetHeader>(
      "INSERT INTO incidencias (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles) VALUES (?, ?, ?, ?, ?, ?)",
      [input.empresaId, input.idEmpleado, input.tipo ?? "Vacaciones", input.fechaInicio, input.fechaFin, input.diasATomar],
    );
    const incidenciaId = Number(ins.insertId);
    await conn.execute(
      "INSERT INTO vacaciones (empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, estado) VALUES (?, ?, ?, ?, ?, 'Aprobado')",
      [input.empresaId, input.idEmpleado, input.fechaInicio, input.fechaFin, input.diasATomar],
    );
    const hoyDisponible = new Map(periodos.map((p) => [p.id, p.disponibles]));
    const consumoPorSaldo = new Map<number, number>();
    for (const t of plan.tramos) {
      for (const a of t.asignaciones) {
        await conn.execute("INSERT INTO detalle_consumo_vacaciones (incidencia_id, saldo_id, dias_tomados) VALUES (?, ?, ?)", [incidenciaId, a.saldoId!, a.dias]);
        consumoPorSaldo.set(a.saldoId!, r2((consumoPorSaldo.get(a.saldoId!) ?? 0) + a.dias));
      }
    }
    // El saldo de HOY solo baja en los períodos que siguen Vigentes; un período Vencido no se reactiva ni se toca su disponible.
    const desglose: DesgloseConsumo[] = [];
    for (const [saldoId, tomado] of consumoPorSaldo) {
      const p = periodos.find((x) => x.id === saldoId)!;
      let restante = 0;
      if (p.estado === "Vigente") {
        restante = r2(Math.max(0, (hoyDisponible.get(saldoId) ?? 0) - tomado));
        await conn.execute("UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ?", [restante, saldoId]);
      }
      desglose.push({ periodoInicio: p.inicio, periodoFin: p.fin, diasTomados: tomado, diasRestantes: restante });
    }
    // Recalcula el estado actual (vencimiento y tope de 30): idempotente; nunca aumenta saldo.
    await sincronizarPeriodosVacacionesEnConexion(conn, input.empresaId, input.idEmpleado);
    await registrarAuditoriaTx(conn as PoolConnection, {
      empresaId: input.empresaId, usuario: input.usuario ?? null, accion: "vacaciones_registro_historico", modulo: "rrhh",
      detalle: JSON.stringify({
        incidenciaId, empleadoId: input.idEmpleado, tipo: input.tipo ?? "Vacaciones", inicio: input.fechaInicio, fin: input.fechaFin, dias: input.diasATomar,
        tramos: plan.tramos.map((t) => ({ desde: t.desde, hasta: t.hasta, dias: t.dias, deficit: t.deficit, periodos: t.asignaciones.map((a) => ({ anio: a.anioLaboral, dias: a.dias })) })),
        deficit: plan.deficit, decisiones: plan.decisiones.map((d) => d.codigo), huella: plan.huella, decision: input.decision ? { motivo: input.decision.motivo.trim(), huella: input.decision.huella } : null,
      }),
    });
    await conn.commit();
    return {
      ok: true, historico: true, plan, incidenciaId, desglose,
      mensaje: plan.deficit > 0 ? `Vacaciones históricas registradas con déficit de ${plan.deficit} día(s) aprobado por RRHH.` : "Vacaciones históricas registradas (FIFO en la fecha de la vacación).",
    };
  } catch (err) {
    try { await conn.rollback(); } catch { /* la conexión pudo perderse */ }
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al registrar. ¿Importaste migrate-2026-08-rrhh-core.sql?", desglose: [], incidenciaId: null };
  } finally {
    conn.release();
  }
}
