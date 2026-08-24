import type { RowDataPacket } from "mysql2";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
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
 *
 * Múltiples supervisores: usa empleado_supervisores (no
 * empleados.supervisor_id) como fuente de verdad, para reconocer también
 * relaciones creadas cuando un empleado tiene varios supervisores. DISTINCT
 * evita duplicados si por alguna razón hubiera más de una fila para el
 * mismo par empleado/supervisor.
 */
export async function listarSubordinados(
  empresaId: number,
  supervisorId: number,
): Promise<Subordinado[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT e.id, e.codigo, e.nombre, e.sueldo_base
     FROM empleados e
     INNER JOIN empleado_supervisores es
       ON es.empresa_id = e.empresa_id AND es.empleado_id = e.id
     WHERE e.empresa_id = ? AND es.supervisor_id = ? AND e.estado = 'Activo'
       AND e.horas_extra_habilitado = 1
     ORDER BY e.nombre`,
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
  /**
   * Fase H3 — derivado en tiempo de lectura, NUNCA persistido: true solo si
   * este registro está APLICADA_EN_PLANILLA y la línea de planilla vinculada
   * (mismo planilla_periodo_id + mismo empleado en rrhh_planilla_lineas)
   * tiene estado_pago='Pagado' — el único evento real de pago del sistema
   * (marcarPagos() en planillas.ts). No existe ni existirá un estado
   * 'PAGADA' en horas_extra_registros.estado; es puramente informativo para
   * el colaborador/supervisor. Mismo patrón ya usado para D1/D2 en
   * resumenesPorDescuento() de descuentos.ts. Por defecto false; se completa
   * con marcarPagadas() donde se necesita mostrarlo.
   */
  pagada: boolean;
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
    pagada: false,
  };
}

/**
 * Fase H3 — enriquece un listado ya mapeado con `pagada`, cruzando cada
 * registro APLICADA_EN_PLANILLA contra rrhh_planilla_lineas.estado_pago del
 * mismo periodo/empleado. `rows` debe ser el mismo arreglo (y mismo orden)
 * de RowDataPacket usado para producir `registros` con mapRegistro — se lee
 * `planilla_periodo_id` de ahí porque RegistroHorasExtra no lo expone
 * públicamente. No hace ninguna escritura; es de solo lectura.
 */
async function marcarPagadas(
  empresaId: number,
  rows: RowDataPacket[],
  registros: RegistroHorasExtra[],
): Promise<RegistroHorasExtra[]> {
  const periodoIds = Array.from(
    new Set(
      rows
        .filter(
          (r) => String(r.estado) === "APLICADA_EN_PLANILLA" && r.planilla_periodo_id != null,
        )
        .map((r) => Number(r.planilla_periodo_id)),
    ),
  );
  if (!periodoIds.length) return registros;

  const placeholders = periodoIds.map(() => "?").join(",");
  const pagos = await query<RowDataPacket[]>(
    `SELECT periodo_id, id_empleado FROM rrhh_planilla_lineas
     WHERE empresa_id = ? AND estado_pago = 'Pagado' AND periodo_id IN (${placeholders})`,
    [empresaId, ...periodoIds],
  );
  const lineasPagadas = new Set<string>();
  for (const p of pagos) {
    lineasPagadas.add(`${Number(p.periodo_id)}:${Number(p.id_empleado)}`);
  }

  return registros.map((reg, i) => {
    const periodoId = rows[i]?.planilla_periodo_id;
    if (
      reg.estado !== "APLICADA_EN_PLANILLA" ||
      periodoId == null ||
      !lineasPagadas.has(`${Number(periodoId)}:${reg.empleadoId}`)
    ) {
      return reg;
    }
    return { ...reg, pagada: true };
  });
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
  // filtrado el selector. Usa empleado_supervisores (múltiples
  // supervisores), no empleados.supervisor_id — mismo criterio que
  // listarSubordinados().
  const subordinado = await query<RowDataPacket[]>(
    `SELECT e.id, e.nombre, e.sueldo_base, e.horas_extra_habilitado
     FROM empleados e
     INNER JOIN empleado_supervisores es
       ON es.empresa_id = e.empresa_id AND es.empleado_id = e.id
     WHERE e.id = ? AND e.empresa_id = ? AND es.supervisor_id = ? AND e.estado = 'Activo'
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
  return marcarPagadas(empresaId, rows, rows.map(mapRegistro));
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
  return marcarPagadas(empresaId, rows, rows.map(mapRegistro));
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
  | {
      ok: false;
      motivo: "no_encontrado" | "estado_no_permite" | "motivo_requerido" | "no_autorizado";
      mensaje: string;
    };

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

// ---------------------------------------------------------------------------
// Fase H4 — aprobación/rechazo desde el Portal del supervisor, ADEMÁS de la
// bandeja de RRHH (no la reemplaza). Reutiliza exactamente la misma
// transición atómica de aprobarHorasExtra()/rechazarHorasExtra() — la única
// diferencia es una verificación previa de subordinación real.
// ---------------------------------------------------------------------------

/**
 * Verifica en el servidor que `registroId` pertenece a un empleado que es
 * subordinado directo de `supervisorId`, vía empleado_supervisores — misma
 * fuente de verdad que listarSubordinados()/registrarHorasExtra(), nunca se
 * confía en que la UI ya filtró. Bloquea estructuralmente: aprobar horas
 * propias (el supervisor no puede ser subordinado de sí mismo salvo un dato
 * corrupto, mismo criterio ya usado en el resto del módulo), horas de un
 * empleado no asignado, y horas de otra empresa (empresa_id en ambas
 * tablas).
 */
async function esSubordinadoDelRegistro(
  empresaId: number,
  registroId: number,
  supervisorId: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT h.id
     FROM horas_extra_registros h
     INNER JOIN empleado_supervisores es
       ON es.empresa_id = h.empresa_id AND es.empleado_id = h.id_empleado
     WHERE h.id = ? AND h.empresa_id = ? AND es.supervisor_id = ?
     LIMIT 1`,
    [registroId, empresaId, supervisorId],
  );
  return rows.length > 0;
}

/**
 * Aprueba desde el Portal del supervisor. Delega la transición atómica en
 * aprobarHorasExtra() — no la duplica — así que si el registro ya no está
 * PENDIENTE (por ejemplo otra persona ya lo procesó, o RRHH ya lo aprobó),
 * el mismo affectedRows===1 de siempre evita sobreescribir.
 */
export async function aprobarHorasExtraSupervisor(
  empresaId: number,
  registroId: number,
  supervisorId: number,
  supervisorNombre: string,
): Promise<ResultadoDecision> {
  const autorizado = await esSubordinadoDelRegistro(empresaId, registroId, supervisorId);
  if (!autorizado) {
    return {
      ok: false,
      motivo: "no_autorizado",
      mensaje: "No puedes aprobar horas extra de un colaborador que no está a tu cargo.",
    };
  }
  return aprobarHorasExtra(empresaId, registroId, supervisorNombre);
}

/** Rechaza desde el Portal del supervisor — mismo criterio que aprobarHorasExtraSupervisor. */
export async function rechazarHorasExtraSupervisor(
  empresaId: number,
  registroId: number,
  supervisorId: number,
  supervisorNombre: string,
  motivoRechazo: string,
): Promise<ResultadoDecision> {
  const autorizado = await esSubordinadoDelRegistro(empresaId, registroId, supervisorId);
  if (!autorizado) {
    return {
      ok: false,
      motivo: "no_autorizado",
      mensaje: "No puedes rechazar horas extra de un colaborador que no está a tu cargo.",
    };
  }
  return rechazarHorasExtra(empresaId, registroId, supervisorNombre, motivoRechazo);
}

// ---------------------------------------------------------------------------
// Fase H2 — integración con generación de planilla. Vive aquí (no en
// planillas.ts) porque horas-extra.ts es el dueño del modelo de registros;
// el generador de planilla solo llama a estas funciones dentro de SU MISMA
// transacción (recibe `conn`), sin conocer los detalles internos. Mismo
// patrón exacto ya usado en descuentos.ts para las cuotas D1 (D2).
// ---------------------------------------------------------------------------

export type PeriodoParaHorasExtra = { id: number; fechaInicio: string; fechaFin: string };

/**
 * Aplica, dentro de la transacción `conn` del llamador (generarLineasPeriodo),
 * todos los registros APROBADA elegibles para `periodo`:
 * - estado = 'APROBADA' (nunca PENDIENTE, RECHAZADA, APLICADA_EN_PLANILLA, ni
 *   histórico con estado NULL — el filtro WHERE estado='APROBADA' los excluye
 *   a todos estructuralmente);
 * - fecha dentro de [periodo.fechaInicio, periodo.fechaFin] — la fecha del
 *   registro es la única fuente de verdad, H2 no recalcula nada.
 *
 * Cada registro se transiciona con un UPDATE condicional
 * (WHERE estado='APROBADA' AND planilla_periodo_id IS NULL) y se verifica
 * affectedRows === 1 antes de contarlo — si otra ejecución concurrente ya lo
 * aplicó, esta pasada lo ignora en vez de reintentar/pagar de nuevo. Al
 * regenerar el mismo periodo, los registros ya APLICADA_EN_PLANILLA con
 * planilla_periodo_id = periodo.id NO vuelven a aparecer en el SELECT de
 * elegibles (ya no son APROBADA) — nunca se reprocesan ni se pagan dos veces.
 */
export async function aplicarHorasExtraElegibles(
  conn: PoolConnection,
  empresaId: number,
  periodo: PeriodoParaHorasExtra,
): Promise<{ aplicadas: number; totalHoras: number; totalMonto: number }> {
  const [elegibles] = await conn.query<RowDataPacket[]>(
    `SELECT id, horas, monto FROM horas_extra_registros
     WHERE empresa_id = ? AND estado = 'APROBADA' AND planilla_periodo_id IS NULL
       AND fecha BETWEEN ? AND ?
     ORDER BY id`,
    [empresaId, periodo.fechaInicio, periodo.fechaFin],
  );

  let aplicadas = 0;
  let totalHoras = 0;
  let totalMonto = 0;
  for (const r of elegibles) {
    const [res] = await conn.execute<ResultSetHeader>(
      `UPDATE horas_extra_registros
       SET estado = 'APLICADA_EN_PLANILLA', planilla_periodo_id = ?, aplicado_en = NOW()
       WHERE id = ? AND empresa_id = ? AND estado = 'APROBADA' AND planilla_periodo_id IS NULL`,
      [periodo.id, Number(r.id), empresaId],
    );
    if (res.affectedRows === 1) {
      aplicadas += 1;
      totalHoras = redondearQ(totalHoras + Number(r.horas));
      totalMonto = redondearQ(totalMonto + Number(r.monto));
    }
    // affectedRows === 0: otra ejecución ya lo aplicó — no se reintenta, no se paga dos veces.
  }

  return { aplicadas, totalHoras, totalMonto };
}

/**
 * Suma, por empleado, TODAS las horas extra APLICADA_EN_PLANILLA vinculadas
 * a este periodo — tanto las recién aplicadas en esta misma generación como
 * las que ya estaban aplicadas de una generación/regeneración anterior del
 * mismo periodo. Debe llamarse DESPUÉS de aplicarHorasExtraElegibles(), en
 * la misma transacción, para que el resultado incluya ambos casos (mismo
 * patrón que sumaCuotasAplicadasPorPeriodo en descuentos.ts).
 */
export async function sumaHorasExtraAplicadasPorPeriodo(
  conn: PoolConnection,
  empresaId: number,
  periodoId: number,
): Promise<Map<number, number>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id_empleado, SUM(monto) AS total
     FROM horas_extra_registros
     WHERE empresa_id = ? AND planilla_periodo_id = ? AND estado = 'APLICADA_EN_PLANILLA'
     GROUP BY id_empleado`,
    [empresaId, periodoId],
  );
  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(Number(r.id_empleado), Number(r.total ?? 0));
  }
  return map;
}

/**
 * Fase H2: si el periodo tiene horas extra ya APLICADA_EN_PLANILLA
 * vinculadas (planilla_periodo_id = periodo.id), no se puede cancelar sin
 * antes revertirlas — mismo criterio ya usado para cuotas D1/D2. La
 * reversión explícita no está implementada todavía. Se llama desde
 * cancelarPeriodo() de planillas.ts antes de cambiar el estado.
 */
export async function tieneHorasExtraAplicadasEnPeriodo(
  empresaId: number,
  periodoId: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM horas_extra_registros
     WHERE empresa_id = ? AND planilla_periodo_id = ? AND estado = 'APLICADA_EN_PLANILLA'
     LIMIT 1`,
    [empresaId, periodoId],
  );
  return rows.length > 0;
}

/**
 * Detalle itemizado de horas extra aplicadas a un empleado en un periodo
 * específico — para la boleta, mismo formato (concepto/monto/fecha/notas)
 * que ItemDetalle de planillas.ts y que listarCuotasAplicadasDetalle de
 * descuentos.ts (no se importa el tipo, para evitar un ciclo de imports;
 * es estructuralmente compatible, se concatena sin problema).
 */
export async function listarHorasExtraAplicadasDetalle(
  empresaId: number,
  empleadoId: number,
  periodoId: number,
): Promise<{ concepto: string; monto: number; fecha: string; notas: string }[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT fecha, horas, monto, motivo
     FROM horas_extra_registros
     WHERE empresa_id = ? AND planilla_periodo_id = ? AND estado = 'APLICADA_EN_PLANILLA'
       AND id_empleado = ?
     ORDER BY fecha`,
    [empresaId, periodoId, empleadoId],
  );
  return rows.map((r) => ({
    concepto: `Horas extra — ${Number(r.horas).toFixed(2)} h`,
    monto: Number(r.monto ?? 0),
    fecha: toIsoDate(r.fecha) ?? "",
    notas: r.motivo ? String(r.motivo) : "",
  }));
}
