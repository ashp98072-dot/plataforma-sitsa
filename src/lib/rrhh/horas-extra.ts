import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { redondearQ } from "./contratos-pago";
import { hoyLocal, toIsoDate } from "./dates";

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

/** Equipo directo de un supervisor (para el selector del portal). */
export async function listarSubordinados(
  empresaId: number,
  supervisorId: number,
): Promise<Subordinado[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, sueldo_base
     FROM empleados
     WHERE empresa_id = ? AND supervisor_id = ? AND estado = 'Activo'
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
};

function mapRegistro(r: RowDataPacket): RegistroHorasExtra {
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
  };
}

/**
 * Registra horas extra de un subordinado directo. Sin bandeja de aprobación
 * de RRHH (el supervisor aprueba con su propia autoridad al registrar) — el
 * monto se guarda de una vez en rrhh_prestaciones para que se sume
 * automáticamente al neto de la siguiente planilla del empleado.
 */
export async function registrarHorasExtra(input: {
  empresaId: number;
  supervisorId: number;
  supervisorNombre: string;
  empleadoId: number;
  fecha: string;
  horas: number;
  motivo?: string | null;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  if (input.horas <= 0 || input.horas > HORAS_MAX_POR_REGISTRO) {
    return {
      ok: false,
      mensaje: `Las horas deben estar entre 0.5 y ${HORAS_MAX_POR_REGISTRO}.`,
    };
  }
  if (input.fecha > hoyLocal()) {
    return { ok: false, mensaje: "No se pueden registrar horas de una fecha futura." };
  }

  // Autorización: el supervisor solo puede registrar horas de SU equipo
  // directo, nunca de un empleado de otro supervisor cambiando el id en la
  // petición (esta consulta filtra por ambos, no solo por el empleado).
  const subordinado = await query<RowDataPacket[]>(
    `SELECT id, nombre, sueldo_base FROM empleados
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
  const sueldoBase = Number(subordinado[0].sueldo_base ?? 0);
  if (sueldoBase <= 0) {
    return {
      ok: false,
      mensaje: "El colaborador no tiene sueldo base configurado; no se puede calcular la tarifa.",
    };
  }

  const { tarifaHora, monto } = calcularMontoHorasExtra(sueldoBase, input.horas);

  // Transacción: si el segundo insert falla, no debe quedar un ingreso ya
  // sumado a planilla (rrhh_prestaciones) sin su registro de trazabilidad
  // (quién lo autorizó y por qué). O se guardan los dos, o ninguno.
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [prestacionResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO rrhh_prestaciones
        (empresa_id, id_empleado, tipo, monto, fecha, notas, creado_por)
       VALUES (?, ?, 'Horas extra', ?, ?, ?, ?)`,
      [
        input.empresaId,
        input.empleadoId,
        monto,
        input.fecha,
        input.motivo?.trim() || null,
        input.supervisorNombre,
      ],
    );
    const prestacionId = Number(prestacionResult.insertId);

    const [registroResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO horas_extra_registros
        (empresa_id, id_empleado, fecha, horas, tarifa_hora, monto, motivo,
         registrado_por_id, registrado_por_nombre, prestacion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        prestacionId,
      ],
    );

    await conn.commit();

    return {
      ok: true,
      mensaje: `Horas extra registradas: Q${monto.toFixed(2)} para ${subordinado[0].nombre}.`,
      id: Number(registroResult.insertId),
    };
  } catch (err) {
    await conn.rollback();
    console.error("[horas-extra] Falló registrarHorasExtra:", err);
    return { ok: false, mensaje: "No se pudo registrar. Intenta de nuevo." };
  } finally {
    conn.release();
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