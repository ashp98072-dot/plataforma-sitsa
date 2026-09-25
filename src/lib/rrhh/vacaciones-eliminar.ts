import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { getPool } from "@/lib/db";
import { toIsoDate } from "./dates";
import { sincronizarPeriodosVacacionesEnConexion } from "./vacaciones";

/**
 * RRHH VACACIONES — ELIMINAR UN REGISTRO Y DEVOLVER EL SALDO.
 *
 * Autoridad del saldo: `detalle_consumo_vacaciones` (incidencia_id, saldo_id, dias_tomados). Se devuelve EXACTAMENTE lo
 * que cada detalle tomó, al MISMO `saldo_id` del que salió (nunca `saldo += dias_habiles` ni un período arbitrario).
 *
 * Todo en UNA transacción (BEGIN … COMMIT, ROLLBACK ante cualquier fallo):
 *   incidencia (FOR UPDATE, acotada por empresa) → evidencias (FOR UPDATE; si hay, se bloquea) → detalles FIFO (FOR UPDATE)
 *   → saldos afectados (FOR UPDATE) → devolver → borrar detalle → fila espejo de `vacaciones` → borrar incidencia → auditoría.
 * Un segundo DELETE de la misma incidencia espera el FOR UPDATE del primero y luego no la encuentra: 404, no devuelve nada.
 *
 * Fila espejo en `vacaciones`: esa tabla NO guarda incidencia_id (registrarVacacionesFifoEnConexion inserta una fila por
 * cada incidencia con saldo). Como pueden existir duplicados LEGÍTIMAMENTE idénticos, se elige UNA sola fila concreta
 * (la de mayor `id`) con FOR UPDATE y se borra por su `id`; nunca un DELETE por empleado/fechas.
 */

/** Tipos que descuentan saldo FIFO (mismo criterio que POST /rrhh/vacaciones). */
export const TIPOS_CON_SALDO = new Set(["Vacaciones", "A cuenta de Vacaciones"]);
/** Tipos que la pantalla de Vacaciones puede crear; solo estos se pueden eliminar desde aquí. */
export const TIPOS_ELIMINABLES = new Set([
  ...TIPOS_CON_SALDO,
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
]);

export const MSG_CON_EVIDENCIAS = "Este registro tiene evidencias adjuntas. Elimínalas primero.";

export type SaldoRestaurado = { saldoId: number; anioLaboral: number | null; diasRestaurados: number; disponibleAntes: number; disponibleDespues: number };
export type ResultadoEliminarVacaciones =
  | {
      ok: true;
      mensaje: string;
      diasRestaurados: number;
      empleadoId: number;
      desglose: SaldoRestaurado[];
      /** Días que el tope de 30 días volvió a recortar tras restaurar (0 = ninguno). Se informa, nunca se oculta. */
      diasAjustadosPorTope: number;
      /** Días no devueltos por pertenecer a un período ya vencido. */
      diasNoRestaurados: number;
      espejoEliminado: boolean;
      advertencias: string[];
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

class Abortar extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dma = (iso: string) => iso.split("-").reverse().join("/");
const fmt = (n: number) => n.toFixed(2);
const sinTabla = (e: unknown) => (e as { errno?: number; code?: string })?.errno === 1146 || (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

export async function eliminarRegistroVacaciones(empresaId: number, incidenciaId: number, usuario: string): Promise<ResultadoEliminarVacaciones> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const res = await ejecutar(conn, empresaId, incidenciaId, usuario);
    await conn.commit();
    return res;
  } catch (e) {
    try { await conn.rollback(); } catch { /* la conexión puede haberse perdido */ }
    if (e instanceof Abortar) return { ok: false, status: e.status, error: e.message };
    throw e; // fallo inesperado: la ruta responde 500 (ya se hizo ROLLBACK total)
  } finally {
    conn.release();
  }
}

async function ejecutar(conn: PoolConnection, empresaId: number, incidenciaId: number, usuario: string): Promise<Extract<ResultadoEliminarVacaciones, { ok: true }>> {
  // 1) la incidencia, de ESTA empresa, bloqueada
  const [incs] = await conn.query<RowDataPacket[]>(
    `SELECT id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles
     FROM incidencias WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
    [incidenciaId, empresaId],
  );
  const inc = incs[0];
  if (!inc) throw new Abortar(404, "Registro no encontrado.");
  const tipo = String(inc.tipo);
  if (!TIPOS_ELIMINABLES.has(tipo)) throw new Abortar(400, `Este registro es de tipo "${tipo}" y no se puede eliminar desde Vacaciones.`);
  const empleadoId = Number(inc.id_empleado);
  const fechaInicio = toIsoDate(inc.fecha_inicio) ?? "";
  const fechaFin = toIsoDate(inc.fecha_fin) ?? "";
  const dias = Number(inc.dias_habiles);
  const [emps] = await conn.query<RowDataPacket[]>("SELECT nombre FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [empleadoId, empresaId]);
  const nombre = emps[0]?.nombre ? String(emps[0].nombre) : `#${empleadoId}`;

  // 2) evidencias: sus archivos viven en disco, por eso NO se borran en cascada silenciosamente. Bloqueadas (FOR UPDATE) para que
  //    nadie adjunte una mientras se elimina.
  let evidencias = 0;
  try {
    const [evs] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM evidencias_incidencias WHERE incidencia_id = ? AND empresa_id = ? FOR UPDATE",
      [incidenciaId, empresaId],
    );
    evidencias = evs.length;
  } catch (e) {
    if (!sinTabla(e)) throw e; // tabla de evidencias aún no migrada: no hay adjuntos
  }
  if (evidencias > 0) throw new Abortar(409, MSG_CON_EVIDENCIAS);

  // 3) detalle FIFO + saldos (solo tipos que descuentan saldo)
  const desglose: SaldoRestaurado[] = [];
  const advertencias: string[] = [];
  let diasRestaurados = 0;
  let diasNoRestaurados = 0;
  let diasAjustadosPorTope = 0;
  const conSaldo = TIPOS_CON_SALDO.has(tipo);
  if (conSaldo) {
    const [detalles] = await conn.query<RowDataPacket[]>(
      "SELECT id, saldo_id, dias_tomados FROM detalle_consumo_vacaciones WHERE incidencia_id = ? ORDER BY id FOR UPDATE",
      [incidenciaId],
    );
    // Falla SEGURA: un registro que dice ser de vacaciones pero no tiene detalle FIFO no se puede restaurar ni se inventa consumo.
    if (!detalles.length) {
      throw new Abortar(409, "Este registro no tiene detalle de consumo FIFO: no se puede determinar qué saldo devolver. Ajusta el saldo manualmente.");
    }
    const porSaldo = new Map<number, number>();
    for (const d of detalles) porSaldo.set(Number(d.saldo_id), r2((porSaldo.get(Number(d.saldo_id)) ?? 0) + Number(d.dias_tomados)));
    const saldoIds = [...porSaldo.keys()].sort((a, b) => a - b);
    const [saldos] = await conn.query<RowDataPacket[]>(
      `SELECT id, id_empleado, anio_laboral, dias_otorgados, dias_disponibles, estado
       FROM saldos_vacaciones WHERE empresa_id = ? AND id IN (${saldoIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
      [empresaId, ...saldoIds],
    );
    const porId = new Map(saldos.map((s) => [Number(s.id), s]));
    for (const id of saldoIds) {
      const s = porId.get(id);
      if (!s || Number(s.id_empleado) !== empleadoId) throw new Abortar(409, "El detalle de consumo apunta a un período de saldo que no corresponde a este colaborador.");
    }

    for (const id of saldoIds) {
      const s = porId.get(id)!;
      const tomados = porSaldo.get(id)!;
      const antes = Number(s.dias_disponibles);
      const otorgados = Number(s.dias_otorgados);
      const anio = s.anio_laboral != null ? Number(s.anio_laboral) : null;
      if (String(s.estado) === "Vencido") {
        // El período ya venció por política: sus días no vuelven a ser utilizables. Se informa, no se oculta.
        diasNoRestaurados = r2(diasNoRestaurados + tomados);
        advertencias.push(`El período ${anio ?? `#${id}`} ya está vencido: ${fmt(tomados)} día(s) no se restauraron.`);
        continue;
      }
      let despues = r2(antes + tomados);
      if (despues > otorgados) {
        const exceso = r2(despues - otorgados);
        advertencias.push(`El período ${anio ?? `#${id}`} quedaría con ${fmt(despues)} de ${fmt(otorgados)} días otorgados: se limitó a ${fmt(otorgados)} (${fmt(exceso)} día(s) de exceso; revisa el saldo).`);
        diasNoRestaurados = r2(diasNoRestaurados + exceso);
        despues = otorgados;
      }
      const restaurado = r2(despues - antes);
      await conn.execute("UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ? AND empresa_id = ?", [despues, id, empresaId]);
      desglose.push({ saldoId: id, anioLaboral: anio, diasRestaurados: restaurado, disponibleAntes: antes, disponibleDespues: despues });
      diasRestaurados = r2(diasRestaurados + restaurado);
    }

    // 4) detalle FIFO de ESTA incidencia (los de otras incidencias, incluso idénticas, no se tocan)
    await conn.execute("DELETE FROM detalle_consumo_vacaciones WHERE incidencia_id = ?", [incidenciaId]);

  }

  // 5) fila espejo en `vacaciones`: UNA sola, elegida y bloqueada por su id concreto (ver nota del encabezado)
  let espejoEliminado = false;
  if (conSaldo) {
    const [espejos] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM vacaciones
       WHERE empresa_id = ? AND id_empleado = ? AND fecha_inicio = ? AND fecha_fin = ? AND dias_habiles = ? AND estado = 'Aprobado'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [empresaId, empleadoId, fechaInicio, fechaFin, dias],
    );
    if (espejos[0]) {
      const [d] = await conn.execute<ResultSetHeader>("DELETE FROM vacaciones WHERE id = ? AND empresa_id = ?", [Number(espejos[0].id), empresaId]);
      espejoEliminado = d.affectedRows === 1;
    } else {
      advertencias.push("No se encontró la fila espejo en el historial simple de vacaciones (registro anterior a su creación).");
    }
  }

  // 6) solicitud de origen (solo para la auditoría; su FK es ON DELETE SET NULL)
  let solicitudId: number | null = null;
  try {
    const [sol] = await conn.query<RowDataPacket[]>("SELECT id FROM solicitudes_vacaciones WHERE incidencia_id = ? AND empresa_id = ? LIMIT 1", [incidenciaId, empresaId]);
    solicitudId = sol[0] ? Number(sol[0].id) : null;
  } catch (e) {
    if (!sinTabla(e) && !/Unknown column/i.test(String((e as Error)?.message))) throw e;
  }

  // 7) la incidencia (una sola fila; si no, se revierte todo)
  const [del] = await conn.execute<ResultSetHeader>("DELETE FROM incidencias WHERE id = ? AND empresa_id = ?", [incidenciaId, empresaId]);
  if (del.affectedRows !== 1) throw new Abortar(409, "El registro cambió mientras se eliminaba. No se modificó nada.");

  // 8) tope de 30 días: la política puede volver a recortar el período más viejo; se ejecuta AQUÍ para informar el efecto real
  if (conSaldo && desglose.length) {
    await sincronizarPeriodosVacacionesEnConexion(conn, empresaId, empleadoId);
    const [ahora] = await conn.query<RowDataPacket[]>(
      `SELECT id, dias_disponibles FROM saldos_vacaciones WHERE empresa_id = ? AND id IN (${desglose.map(() => "?").join(",")})`,
      [empresaId, ...desglose.map((d) => d.saldoId)],
    );
    const actual = new Map(ahora.map((s) => [Number(s.id), Number(s.dias_disponibles)]));
    for (const d of desglose) {
      const real = actual.get(d.saldoId);
      if (real != null && real < d.disponibleDespues - 0.004) {
        const recorte = r2(d.disponibleDespues - real);
        diasAjustadosPorTope = r2(diasAjustadosPorTope + recorte);
        d.disponibleDespues = real;
      }
    }
    if (diasAjustadosPorTope > 0) {
      advertencias.push(`El tope de 30 días volvió a recortar ${fmt(diasAjustadosPorTope)} día(s) del período más antiguo.`);
    }
  }

  // 9) auditoría dentro de la misma transacción
  const restauradoTxt = conSaldo
    ? `${fmt(diasRestaurados)} días restaurados al saldo` +
      (desglose.length ? ` (${desglose.map((d) => `período ${d.anioLaboral ?? `#${d.saldoId}`}: +${fmt(d.diasRestaurados)}`).join("; ")})` : "") +
      (diasAjustadosPorTope > 0 ? ` · tope 30 días recortó ${fmt(diasAjustadosPorTope)}` : "") +
      (diasNoRestaurados > 0 ? ` · ${fmt(diasNoRestaurados)} no restaurados` : "")
    : "sin saldo que restaurar";
  await registrarAuditoriaTx(conn, {
    empresaId,
    usuario,
    accion: "vacaciones_eliminar",
    modulo: "rrhh",
    detalle:
      `Incidencia #${incidenciaId} · ${nombre} (empleado #${empleadoId}) · ${tipo} ${dma(fechaInicio)} → ${dma(fechaFin)} · ` +
      `${fmt(dias)} días eliminados · ${restauradoTxt}` +
      (solicitudId != null ? ` · solicitud #${solicitudId}` : "") +
      ` · eliminado por ${usuario}`,
  });

  return {
    ok: true,
    mensaje: conSaldo ? `Registro eliminado y ${diasRestaurados} día(s) restaurados.` : "Registro eliminado.",
    diasRestaurados,
    empleadoId,
    desglose,
    diasAjustadosPorTope,
    diasNoRestaurados,
    espejoEliminado,
    advertencias,
  };
}
