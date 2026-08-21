import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { redondearQ } from "./contratos-pago";
import { hoyLocal, toIsoDate } from "./dates";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * Horas laborables por mes usadas para derivar la tarifa/hora ordinaria a
 * partir del sueldo base (30 días × 8 horas — referencia estándar en
 * Guatemala). Se deja como constante nombrada y exportada, no quemada en la
 * fórmula, para que sea fácil de ajustar si la empresa usa otro criterio
 * (por ejemplo 26 días × 8h = 208) sin tener que rastrear la fórmula.
 */
export const HORAS_LABORABLES_MES = 240;

/** Recargo legal por hora extra en Guatemala (Código de Trabajo): 50% adicional. */
export const RECARGO_HORA_EXTRA = 1.5;

export const HORAS_MAX_POR_REGISTRO = 12;

/** Tarifa de una hora ordinaria a partir del sueldo base mensual. */
export function tarifaHoraOrdinaria(sueldoBase: number): number {
  return sueldoBase / HORAS_LABORABLES_MES;
}

/** Monto a pagar por N horas extra, con el recargo de ley ya aplicado. */
export function calcularMontoHorasExtra(
  sueldoBase: number,
  horas: number,
): { tarifaHora: number; monto: number } {
  const tarifaHora = tarifaHoraOrdinaria(sueldoBase);
  const monto = redondearQ(tarifaHora * RECARGO_HORA_EXTRA * horas);
  return { tarifaHora: redondearQ(tarifaHora), monto };
}

export type Subordinado = {
  id: number;
  codigo: string;
  nombre: string;
  sueldoBase: number;
};

/**
 * Equipo directo de un supervisor (para el selector del portal). Fase H1:
 * solo colaboradores elegibles para horas extra — un supervisor ya no ve en
 * el selector a quien no está habilitado.
 */
export async function listarSubordinados(
  empresaId: number,
  supervisorId: number,
): Promise<Subordinado[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, sueldo_base
     FROM empleados
     WHERE empresa_id = ? AND supervisor_id = ? AND estado = 'Activo'
       AND horas_extra_habilitado = 1
     ORDER BY nombre`,
    [empresaId, supervisorId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    sueldoBase: Number(r.sueldo_base ?? 0),
  }));
}

export type EstadoHorasExtra =
  | "PENDIENTE"
  | "APROBADA"
  | "RECHAZADA"
  | "APLICADA_EN_PLANILLA";

export type RegistroHorasExtra = {
  id: number;
  empleadoId: number;
  empleadoNombre: string;
  fecha: string;
  horas: number;
  tarifaHora: number;
  monto: number;
  motivo: string | null;
  registradoPorNombre: string;
  creadoEn: string;
  /** Fase H1: null = registro histórico (previo a H1), no reinterpretado. */
  estado: EstadoHorasExtra | null;
  autorizadoPor: string | null;
  autorizadoEn: string | null;
  motivoRechazo: string | null;
};

function mapRegistro(r: RowDataPacket): RegistroHorasExtra {
  const estado = r.estado != null ? String(r.estado) : null;
  return {
    id: Number(r.id),
    empleadoId: Number(r.id_empleado),
    empleadoNombre: r.emp_nombre ? String(r.emp_nombre) : "",
    fecha: toIsoDate(r.fecha) ?? "",
    horas: Number(r.horas),
    tarifaHora: Number(r.tarifa_hora),
    monto: Number(r.monto),
    motivo: r.motivo ? String(r.motivo) : null,
    registradoPorNombre: String(r.registrado_por_nombre),
    creadoEn: String(r.creado_en),
    estado: (["PENDIENTE", "APROBADA", "RECHAZADA", "APLICADA_EN_PLANILLA"].includes(
      estado ?? "",
    )
      ? estado
      : null) as EstadoHorasExtra | null,
    autorizadoPor: r.autorizado_por != null ? String(r.autorizado_por) : null,
    autorizadoEn: r.autorizado_en != null ? String(r.autorizado_en) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
  };
}

export type ResultadoRegistro =
  | { ok: true; mensaje: string; id: number }
  | { ok: false; mensaje: string };

/**
 * Registra horas extra de un subordinado directo y elegible.
 *
 * Fase H1 — cambio principal: ya NO inserta en rrhh_prestaciones ni afecta
 * planilla. Solo crea el registro en estado PENDIENTE; RRHH debe aprobarlo
 * (aprobarHorasExtra) antes de que exista cualquier posibilidad de pago —
 * eso ocurrirá recién en H2. El supervisor deja de poder "dejar listo el
 * pago" directamente al registrar, tal como se definió.
 */
export async function registrarHorasExtra(input: {
  empresaId: number;
  supervisorId: number;
  supervisorNombre: string;
  empleadoId: number;
  fecha: string;
  horas: number;
  motivo?: string | null;
}): Promise<ResultadoRegistro> {
  if (input.horas <= 0 || input.horas > HORAS_MAX_POR_REGISTRO) {
    return {
      ok: false,
      mensaje: `Las horas deben estar entre 0.5 y ${HORAS_MAX_POR_REGISTRO}.`,
    };
  }
  if (input.fecha > hoyLocal()) {
    return { ok: false, mensaje: "No se pueden registrar horas de una fecha futura." };
  }

  // Autorización de equipo: el supervisor solo puede registrar horas de SU
  // equipo directo, nunca de un empleado de otro supervisor cambiando el id
  // en la petición (esta consulta filtra por ambos, no solo por el
  // empleado) — validación server-side, no se confía en que la UI ya haya
  // filtrado el selector.
  const subordinado = await query<RowDataPacket[]>(
    `SELECT id, nombre, sueldo_base, horas_extra_habilitado FROM empleados
     WHERE id = ? AND empresa_id = ? AND supervisor_id = ? AND estado = 'Activo'
     LIMIT 1`,
    [input.empleadoId, input.empresaId, input.supervisorId],
  );
  if (!subordinado[0]) {
    return {
      ok: false,
      mensaje: "Ese colaborador no está a tu cargo, o no está activo.",
    };
  }
  // Fase H1: elegibilidad — repetida aquí server-side, no se confía en que
  // el selector ya haya excluido a los no habilitados.
  if (Number(subordinado[0].horas_extra_habilitado ?? 0) !== 1) {
    return {
      ok: false,
      mensaje: "El colaborador no está habilitado para pago de horas extra.",
    };
  }
  const sueldoBase = Number(subordinado[0].sueldo_base ?? 0);
  if (sueldoBase <= 0) {
    return {
      ok: false,
      mensaje: "El colaborador no tiene sueldo base configurado; no se puede calcular la tarifa.",
    };
  }

  const { tarifaHora, monto } = calcularMontoHorasExtra(sueldoBase, input.horas);

  try {
    const result = await execute(
      `INSERT INTO horas_extra_registros
        (empresa_id, id_empleado, fecha, horas, tarifa_hora, monto, motivo,
         registrado_por_id, registrado_por_nombre, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')`,
      [
        input.empresaId,
        input.empleadoId,
        input.fecha,
        input.horas,
        tarifaHora,
        monto,
        input.motivo?.trim() || null,
        input.supervisorId,
        input.supervisorNombre,
      ],
    );

    await registrarAuditoria({
      empresaId: input.empresaId,
      usuario: input.supervisorNombre,
      accion: "registrar_horas_extra",
      modulo: "rrhh",
      detalle: `Registro #${Number(result.insertId)} · ${String(subordinado[0].nombre)} · ${input.fecha} · ${input.horas}h · Q${monto.toFixed(2)} · PENDIENTE de aprobación RRHH`,
    });

    return {
      ok: true,
      mensaje: `Horas extra registradas: Q${monto.toFixed(2)} para ${subordinado[0].nombre}. Pendiente de aprobación de RRHH.`,
      id: Number(result.insertId),
    };
  } catch (err) {
    console.error("[horas-extra] Falló registrarHorasExtra:", err);
    return { ok: false, mensaje: "No se pudo registrar. Intenta de nuevo." };
  }
}

/** Historial de horas extra registradas por un supervisor para su equipo. */
export async function listarHorasExtraPorSupervisor(
  empresaId: number,
  supervisorId: number,
): Promise<RegistroHorasExtra[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT h.*, e.nombre AS emp_nombre
     FROM horas_extra_registros h
     INNER JOIN empleados e ON e.id = h.id_empleado
     WHERE h.empresa_id = ? AND h.registrado_por_id = ?
     ORDER BY h.creado_en DESC LIMIT 100`,
    [empresaId, supervisorId],
  );
  return rows.map(mapRegistro);
}

/** Horas extra propias de un empleado (para que las vea en su historial). */
export async function listarHorasExtraPropias(
  empresaId: number,
  empleadoId: number,
): Promise<RegistroHorasExtra[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT h.*, e.nombre AS emp_nombre
     FROM horas_extra_registros h
     INNER JOIN empleados e ON e.id = h.id_empleado
     WHERE h.empresa_id = ? AND h.id_empleado = ?
     ORDER BY h.creado_en DESC LIMIT 100`,
    [empresaId, empleadoId],
  );
  return rows.map(mapRegistro);
}

// ---------------------------------------------------------------------------
// Fase H1 — bandeja administrativa RRHH: listar todos los registros de la
// empresa (no solo los de un supervisor) y aprobar/rechazar.
// ---------------------------------------------------------------------------

export type FiltroEstadoHorasExtra = EstadoHorasExtra | "TODOS";

/** Todos los registros de la empresa, opcionalmente filtrados por estado — para la bandeja RRHH. */
export async function listarHorasExtraAdmin(
  empresaId: number,
  filtroEstado: FiltroEstadoHorasExtra = "TODOS",
): Promise<RegistroHorasExtra[]> {
  const where = ["h.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtroEstado !== "TODOS") {
    where.push("h.estado = ?");
    params.push(filtroEstado);
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT h.*, e.nombre AS emp_nombre
     FROM horas_extra_registros h
     INNER JOIN empleados e ON e.id = h.id_empleado
     WHERE ${where.join(" AND ")}
     ORDER BY h.creado_en DESC LIMIT 300`,
    params,
  );
  return rows.map(mapRegistro);
}

export type ResultadoDecision =
  | { ok: true }
  | { ok: false; motivo: "no_encontrado" | "estado_no_permite" | "motivo_requerido"; mensaje: string };

/**
 * Aprueba un registro PENDIENTE. Transición atómica y verificada
 * (WHERE estado='PENDIENTE') — si el registro ya fue aprobado/rechazado por
 * otra acción concurrente, affectedRows queda en 0 y no se reintenta ni se
 * sobreescribe. RECHAZADA -> APROBADA y APLICADA_EN_PLANILLA -> cualquier
 * otro estado quedan estructuralmente bloqueados por la misma condición.
 */
export async function aprobarHorasExtra(
  empresaId: number,
  registroId: number,
  autorizadoPor: string,
): Promise<ResultadoDecision> {
  const r = await execute(
    `UPDATE horas_extra_registros
     SET estado = 'APROBADA', autorizado_por = ?, autorizado_en = NOW()
     WHERE id = ? AND empresa_id = ? AND estado = 'PENDIENTE'`,
    [autorizadoPor, registroId, empresaId],
  );
  if (r.affectedRows !== 1) {
    const existe = await query<RowDataPacket[]>(
      `SELECT id FROM horas_extra_registros WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [registroId, empresaId],
    );
    if (!existe[0]) {
      return { ok: false, motivo: "no_encontrado", mensaje: "Registro no encontrado." };
    }
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: "Este registro ya no está pendiente; no se puede aprobar.",
    };
  }

  const reg = await query<RowDataPacket[]>(
    `SELECT h.*, e.nombre AS emp_nombre FROM horas_extra_registros h
     INNER JOIN empleados e ON e.id = h.id_empleado
     WHERE h.id = ? AND h.empresa_id = ? LIMIT 1`,
    [registroId, empresaId],
  );
  await registrarAuditoria({
    empresaId,
    usuario: autorizadoPor,
    accion: "aprobar_horas_extra",
    modulo: "rrhh",
    detalle: `Registro #${registroId} · ${reg[0] ? String(reg[0].emp_nombre) : ""} · PENDIENTE → APROBADA`,
  });
  return { ok: true };
}

/** Rechaza un registro PENDIENTE — motivo obligatorio. Mismo patrón atómico que aprobarHorasExtra. */
export async function rechazarHorasExtra(
  empresaId: number,
  registroId: number,
  autorizadoPor: string,
  motivoRechazo: string,
): Promise<ResultadoDecision> {
  if (!motivoRechazo?.trim()) {
    return {
      ok: false,
      motivo: "motivo_requerido",
      mensaje: "Debes indicar un motivo para rechazar el registro.",
    };
  }
  const r = await execute(
    `UPDATE horas_extra_registros
     SET estado = 'RECHAZADA', autorizado_por = ?, autorizado_en = NOW(), motivo_rechazo = ?
     WHERE id = ? AND empresa_id = ? AND estado = 'PENDIENTE'`,
    [autorizadoPor, motivoRechazo.trim(), registroId, empresaId],
  );
  if (r.affectedRows !== 1) {
    const existe = await query<RowDataPacket[]>(
      `SELECT id FROM horas_extra_registros WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [registroId, empresaId],
    );
    if (!existe[0]) {
      return { ok: false, motivo: "no_encontrado", mensaje: "Registro no encontrado." };
    }
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: "Este registro ya no está pendiente; no se puede rechazar.",
    };
  }

  const reg = await query<RowDataPacket[]>(
    `SELECT h.*, e.nombre AS emp_nombre FROM horas_extra_registros h
     INNER JOIN empleados e ON e.id = h.id_empleado
     WHERE h.id = ? AND h.empresa_id = ? LIMIT 1`,
    [registroId, empresaId],
  );
  await registrarAuditoria({
    empresaId,
    usuario: autorizadoPor,
    accion: "rechazar_horas_extra",
    modulo: "rrhh",
    detalle: `Registro #${registroId} · ${reg[0] ? String(reg[0].emp_nombre) : ""} · PENDIENTE → RECHAZADA · motivo: ${motivoRechazo.trim()}`,
  });
  return { ok: true };
}
