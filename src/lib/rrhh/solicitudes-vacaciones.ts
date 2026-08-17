import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { toIsoDate } from "./dates";
import {
  calcularSaldoTotalDisponible,
  contarDiasHabiles,
  registrarVacacionesFifo,
} from "./vacaciones";

export type EstadoSolicitud = "Pendiente" | "Aprobada" | "Rechazada";

export type SolicitudVacaciones = {
  id: number;
  empresaId: number;
  empleadoId: number;
  empleadoNombre?: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  estado: EstadoSolicitud;
  comentarioColaborador: string | null;
  comentarioRrhh: string | null;
  incidenciaId: number | null;
  creadoEn: string;
  resueltoEn: string | null;
  resueltoPor: string | null;
};

const TIPOS_CON_SALDO = new Set(["Vacaciones", "A cuenta de Vacaciones"]);

function mapSolicitud(r: RowDataPacket): SolicitudVacaciones {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    empleadoId: Number(r.id_empleado),
    empleadoNombre: r.emp_nombre ? String(r.emp_nombre) : undefined,
    tipo: String(r.tipo),
    fechaInicio: toIsoDate(r.fecha_inicio) ?? "",
    fechaFin: toIsoDate(r.fecha_fin) ?? "",
    diasHabiles: Number(r.dias_habiles),
    estado: String(r.estado) as EstadoSolicitud,
    comentarioColaborador: r.comentario_colaborador
      ? String(r.comentario_colaborador)
      : null,
    comentarioRrhh: r.comentario_rrhh ? String(r.comentario_rrhh) : null,
    incidenciaId: r.incidencia_id != null ? Number(r.incidencia_id) : null,
    creadoEn: String(r.creado_en),
    resueltoEn: r.resuelto_en ? String(r.resuelto_en) : null,
    resueltoPor: r.resuelto_por ? String(r.resuelto_por) : null,
  };
}

/**
 * Crea una solicitud en estado 'Pendiente'. NO descuenta saldo todavía
 * (eso solo ocurre al aprobar, ver aprobarSolicitud). Sí valida que haya
 * saldo suficiente al momento de solicitar, para no dejar pedir de más,
 * aunque el saldo real se vuelva a verificar en el momento de aprobar por
 * si cambió mientras tanto (otras solicitudes aprobadas de por medio).
 */
export async function crearSolicitudVacaciones(input: {
  empresaId: number;
  empleadoId: number;
  fechaInicio: string;
  fechaFin: string;
  tipo?: string;
  comentario?: string | null;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  const tipo = input.tipo ?? "Vacaciones";
  if (input.fechaInicio > input.fechaFin) {
    return {
      ok: false,
      mensaje: "La fecha de inicio no puede ser posterior a la fecha fin.",
    };
  }

  const dias = await contarDiasHabiles(
    input.empresaId,
    input.fechaInicio,
    input.fechaFin,
  );
  if (dias <= 0) {
    return {
      ok: false,
      mensaje: "El rango de fechas no tiene días hábiles.",
    };
  }

  if (TIPOS_CON_SALDO.has(tipo)) {
    const saldo = await calcularSaldoTotalDisponible(
      input.empresaId,
      input.empleadoId,
    );
    if (saldo < dias) {
      return {
        ok: false,
        mensaje: `Saldo insuficiente. Disponible: ${saldo.toFixed(2)} día(s), solicitados: ${dias}.`,
      };
    }
  }

  const pendienteExistente = await query<RowDataPacket[]>(
    `SELECT id FROM solicitudes_vacaciones
     WHERE empresa_id = ? AND id_empleado = ? AND estado = 'Pendiente'
       AND fecha_inicio = ? AND fecha_fin = ? LIMIT 1`,
    [input.empresaId, input.empleadoId, input.fechaInicio, input.fechaFin],
  );
  if (pendienteExistente[0]) {
    return {
      ok: false,
      mensaje: "Ya tienes una solicitud pendiente para esas mismas fechas.",
    };
  }

  const result = await execute(
    `INSERT INTO solicitudes_vacaciones
      (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles,
       estado, comentario_colaborador)
     VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?)`,
    [
      input.empresaId,
      input.empleadoId,
      tipo,
      input.fechaInicio,
      input.fechaFin,
      dias,
      input.comentario?.trim() || null,
    ],
  );
  return {
    ok: true,
    mensaje: "Solicitud enviada. Queda pendiente de aprobación de RRHH.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

/** Historial de solicitudes de UN empleado (portal de colaborador). */
export async function listarSolicitudesPorEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<SolicitudVacaciones[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM solicitudes_vacaciones
     WHERE empresa_id = ? AND id_empleado = ?
     ORDER BY creado_en DESC LIMIT 100`,
    [empresaId, empleadoId],
  );
  return rows.map(mapSolicitud);
}

/** Bandeja de RRHH: por defecto solo pendientes, o todas si se pide. */
export async function listarSolicitudes(
  empresaId: number,
  opts?: { estado?: EstadoSolicitud },
): Promise<SolicitudVacaciones[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT sv.*, e.nombre AS emp_nombre
     FROM solicitudes_vacaciones sv
     INNER JOIN empleados e ON e.id = sv.id_empleado AND e.empresa_id = sv.empresa_id
     WHERE sv.empresa_id = ? ${opts?.estado ? "AND sv.estado = ?" : ""}
     ORDER BY sv.creado_en DESC LIMIT 300`,
    opts?.estado ? [empresaId, opts.estado] : [empresaId],
  );
  return rows.map(mapSolicitud);
}

async function obtenerSolicitud(
  empresaId: number,
  id: number,
): Promise<SolicitudVacaciones | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM solicitudes_vacaciones WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapSolicitud(rows[0]) : null;
}

/**
 * Aprueba la solicitud: aquí (y solo aquí) se descuenta el saldo real,
 * reusando registrarVacacionesFifo (el mismo camino que ya usa RRHH al
 * registrar vacaciones directamente). Si no hay saldo suficiente en este
 * momento (por ejemplo, se aprobó otra solicitud de por medio), la
 * solicitud se queda en 'Pendiente' y se informa el motivo.
 */
export async function aprobarSolicitud(
  empresaId: number,
  id: number,
  resueltoPor: string,
  comentario?: string | null,
): Promise<{ ok: boolean; mensaje: string }> {
  const sol = await obtenerSolicitud(empresaId, id);
  if (!sol) return { ok: false, mensaje: "Solicitud no encontrada." };
  if (sol.estado !== "Pendiente") {
    return { ok: false, mensaje: `Esta solicitud ya está ${sol.estado}.` };
  }

  const r = await registrarVacacionesFifo({
    empresaId,
    idEmpleado: sol.empleadoId,
    fechaInicio: sol.fechaInicio,
    fechaFin: sol.fechaFin,
    diasATomar: sol.diasHabiles,
    tipo: sol.tipo,
  });
  if (!r.ok) {
    return { ok: false, mensaje: r.mensaje };
  }

  await execute(
    `UPDATE solicitudes_vacaciones
     SET estado = 'Aprobada', incidencia_id = ?, comentario_rrhh = ?,
         resuelto_en = NOW(), resuelto_por = ?
     WHERE id = ? AND empresa_id = ?`,
    [r.incidenciaId, comentario?.trim() || null, resueltoPor, id, empresaId],
  );
  return { ok: true, mensaje: "Solicitud aprobada y saldo descontado." };
}

/** Rechaza la solicitud. No toca saldo (nunca se descontó). */
export async function rechazarSolicitud(
  empresaId: number,
  id: number,
  resueltoPor: string,
  comentario?: string | null,
): Promise<{ ok: boolean; mensaje: string }> {
  const sol = await obtenerSolicitud(empresaId, id);
  if (!sol) return { ok: false, mensaje: "Solicitud no encontrada." };
  if (sol.estado !== "Pendiente") {
    return { ok: false, mensaje: `Esta solicitud ya está ${sol.estado}.` };
  }
  await execute(
    `UPDATE solicitudes_vacaciones
     SET estado = 'Rechazada', comentario_rrhh = ?, resuelto_en = NOW(), resuelto_por = ?
     WHERE id = ? AND empresa_id = ?`,
    [comentario?.trim() || null, resueltoPor, id, empresaId],
  );
  return { ok: true, mensaje: "Solicitud rechazada." };
}