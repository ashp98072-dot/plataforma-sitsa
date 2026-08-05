import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { calcularEstadoAsistenciaSync } from "./asistencia-estado";
import {
  obtenerHoraEntradaDefault,
  obtenerMinutosTolerancia,
} from "./config";
import {
  ahoraLocal,
  formatearTimestampVisible,
  fmtTs,
  hoyLocal,
  normalizarHora,
} from "./dates";

async function tieneSesionAbierta(
  empresaId: number,
  idEmpleado: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ?
       AND (estado = 'ABIERTA' OR estado = 'En curso')
     LIMIT 1`,
    [empresaId, idEmpleado],
  );
  return rows.length > 0;
}

async function tieneJornadaCompletaHoy(
  empresaId: number,
  idEmpleado: number,
  fechaJornada: string,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ? AND fecha_jornada = ?
       AND (estado = 'CERRADA' OR estado = 'Cerrada')
     LIMIT 1`,
    [empresaId, idEmpleado, fechaJornada],
  );
  return rows.length > 0;
}

export type InfoCodigoMarcaje = {
  encontrado: boolean;
  nombre?: string;
  tipoHorario?: string;
  esVariable?: boolean;
  estado?: string;
};

export async function infoCodigoParaMarcaje(
  empresaId: number,
  codigo: string,
): Promise<InfoCodigoMarcaje> {
  const rows = await query<RowDataPacket[]>(
    `SELECT nombre, tipo_horario, estado FROM empleados
     WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [empresaId, codigo.trim()],
  );
  if (!rows[0]) return { encontrado: false };
  const tipo = String(rows[0].tipo_horario ?? "Fijo");
  return {
    encontrado: true,
    nombre: String(rows[0].nombre),
    tipoHorario: tipo,
    esVariable: tipo === "Variable" || tipo.includes("Variable"),
    estado: String(rows[0].estado ?? "Activo"),
  };
}

export type MarcajeHoy = {
  id: number;
  nombre: string;
  codigo: string;
  entrada: string;
  salida: string;
  incidencia: string;
  estado: string;
  viajeLargo: boolean;
};

export async function listarMarcajesRango(
  empresaId: number,
  desde: string,
  hasta: string,
): Promise<MarcajeHoy[]> {
  const [horaDefault, tolerancia] = await Promise.all([
    obtenerHoraEntradaDefault(empresaId),
    obtenerMinutosTolerancia(empresaId),
  ]);

  const rows = await query<RowDataPacket[]>(
    `SELECT s.id, e.codigo, e.nombre, s.entrada_at, s.salida_at, s.estado,
            e.hora_entrada_teorica, s.viaje_largo
     FROM sesiones_trabajo s
     INNER JOIN empleados e ON e.id = s.id_empleado
     WHERE s.empresa_id = ? AND s.fecha_jornada BETWEEN ? AND ?
     ORDER BY s.fecha_jornada DESC, s.entrada_at DESC
     LIMIT 500`,
    [empresaId, desde, hasta],
  );

  return rows.map((r) => {
    const entradaRaw = fmtTs(r.entrada_at as string | Date | null);
    const salidaRaw = fmtTs(r.salida_at as string | Date | null);
    const horaTeorica = String(r.hora_entrada_teorica || horaDefault);
    const { estado: incidencia } = calcularEstadoAsistenciaSync(
      entradaRaw ?? "",
      horaTeorica,
      tolerancia,
    );
    return {
      id: Number(r.id),
      nombre: String(r.nombre),
      codigo: String(r.codigo),
      entrada: formatearTimestampVisible(entradaRaw),
      salida: formatearTimestampVisible(salidaRaw),
      incidencia,
      estado: String(r.estado),
      viajeLargo: Number(r.viaje_largo ?? 0) === 1,
    };
  });
}

export type ResultadoMarcajeKiosko =
  | {
      ok: true;
      tipo: "Entrada" | "Salida";
      nombre: string;
      hora: string;
      estadoEntrada?: string;
      minutosRetraso?: number;
      viajeLargo?: boolean;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

export async function registrarMarcajeKiosko(
  empresaId: number,
  input: { codigo: string; viajeLargo?: boolean },
): Promise<ResultadoMarcajeKiosko> {
  const codigo = input.codigo.trim();
  if (!codigo) {
    return { ok: false, code: "EMPTY", error: "Ingrese un código válido." };
  }

  const fechaJornada = hoyLocal();
  const timestamp = ahoraLocal();

  const empRows = await query<RowDataPacket[]>(
    `SELECT id, nombre, estado, hora_entrada_teorica, tipo_horario
     FROM empleados WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [empresaId, codigo],
  );
  if (!empRows[0]) {
    return {
      ok: false,
      code: "NOT_FOUND",
      error: "El código no pertenece a ningún empleado de esta empresa.",
    };
  }

  const idEmpleado = Number(empRows[0].id);
  const nombre = String(empRows[0].nombre);
  const estado = String(empRows[0].estado);
  const horaTeoricaEmp = empRows[0].hora_entrada_teorica
    ? String(empRows[0].hora_entrada_teorica)
    : await obtenerHoraEntradaDefault(empresaId);
  const tipoHorario = String(empRows[0].tipo_horario ?? "Fijo");
  const esVariable =
    tipoHorario === "Variable" || tipoHorario.includes("Variable");

  if (estado === "Baja") {
    return {
      ok: false,
      code: "BAJA",
      error: `El empleado ${nombre} está de Baja.`,
    };
  }

  if (await tieneSesionAbierta(empresaId, idEmpleado)) {
    const abiertas = await query<RowDataPacket[]>(
      `SELECT id FROM sesiones_trabajo
       WHERE empresa_id = ? AND id_empleado = ?
         AND (estado = 'ABIERTA' OR estado = 'En curso')
       ORDER BY entrada_at DESC LIMIT 1`,
      [empresaId, idEmpleado],
    );
    if (!abiertas[0]) {
      return {
        ok: false,
        code: "SIN_ENTRADA",
        error: `${nombre} no tiene sesión abierta.`,
      };
    }
    await execute(
      `UPDATE sesiones_trabajo SET salida_at = ?, estado = 'CERRADA'
       WHERE id = ? AND empresa_id = ?`,
      [timestamp, Number(abiertas[0].id), empresaId],
    );
    const hora = timestamp.split(" ")[1] ?? timestamp;
    return { ok: true, tipo: "Salida", nombre, hora };
  }

  if (await tieneJornadaCompletaHoy(empresaId, idEmpleado, fechaJornada)) {
    return {
      ok: false,
      code: "JORNADA_COMPLETA",
      error: `${nombre} ya cerró jornada hoy.`,
    };
  }

  const viajeLargo = esVariable && !!input.viajeLargo;
  try {
    await execute(
      `INSERT INTO sesiones_trabajo
        (empresa_id, id_empleado, entrada_at, fecha_jornada, estado, viaje_largo)
       VALUES (?, ?, ?, ?, 'ABIERTA', ?)`,
      [empresaId, idEmpleado, timestamp, fechaJornada, viajeLargo ? 1 : 0],
    );
  } catch {
    await execute(
      `INSERT INTO sesiones_trabajo
        (empresa_id, id_empleado, entrada_at, fecha_jornada, estado)
       VALUES (?, ?, ?, ?, 'ABIERTA')`,
      [empresaId, idEmpleado, timestamp, fechaJornada],
    );
  }

  const hora = timestamp.split(" ")[1] ?? timestamp;
  const tolerancia = await obtenerMinutosTolerancia(empresaId);
  const { estado: estadoEntrada, minutos } = calcularEstadoAsistenciaSync(
    hora,
    horaTeoricaEmp,
    tolerancia,
  );

  return {
    ok: true,
    tipo: "Entrada",
    nombre,
    hora,
    estadoEntrada,
    minutosRetraso: minutos,
    viajeLargo,
  };
}

export async function registrarMarcajeManual(
  empresaId: number,
  input: {
    empleadoId?: number;
    codigo?: string;
    fechaJornada: string;
    hora: string;
    correccion?: "entrada" | "salida" | null;
    comentarios?: string;
  },
): Promise<{
  ok: boolean;
  mensaje: string;
  id?: number;
  code?: string;
  tipoMarcaje?: string;
  nombre?: string;
  entradaActual?: string;
  salidaActual?: string;
}> {
  const horaNorm = normalizarHora(input.hora);
  if (!horaNorm) {
    return { ok: false, mensaje: "Hora inválida. Use HH:MM o HH:MM:SS." };
  }
  const ts = `${input.fechaJornada} ${horaNorm}`;

  let empRows: RowDataPacket[];
  if (input.empleadoId) {
    empRows = await query<RowDataPacket[]>(
      `SELECT id, nombre, estado FROM empleados
       WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [input.empleadoId, empresaId],
    );
  } else if (input.codigo?.trim()) {
    empRows = await query<RowDataPacket[]>(
      `SELECT id, nombre, estado FROM empleados
       WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
      [empresaId, input.codigo.trim()],
    );
  } else {
    return { ok: false, mensaje: "Indica empleado o código." };
  }

  if (!empRows[0]) {
    return { ok: false, mensaje: "Empleado no encontrado.", code: "NOT_FOUND" };
  }
  const idEmpleado = Number(empRows[0].id);
  const nombre = String(empRows[0].nombre);
  if (String(empRows[0].estado) === "Baja") {
    return {
      ok: false,
      mensaje: `No se puede registrar. ${nombre} está de Baja.`,
      code: "BAJA",
    };
  }

  const existing = await query<RowDataPacket[]>(
    `SELECT id, entrada_at, salida_at, estado FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ? AND fecha_jornada = ?
     ORDER BY id DESC LIMIT 1`,
    [empresaId, idEmpleado, input.fechaJornada],
  );

  if (!existing[0]) {
    const r = await execute(
      `INSERT INTO sesiones_trabajo
        (empresa_id, id_empleado, fecha_jornada, entrada_at, estado, comentarios_rrhh)
       VALUES (?, ?, ?, ?, 'ABIERTA', ?)`,
      [
        empresaId,
        idEmpleado,
        input.fechaJornada,
        ts,
        input.comentarios ?? null,
      ],
    );
    return {
      ok: true,
      mensaje: `Entrada de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
      id: r.insertId,
      tipoMarcaje: "Entrada",
      nombre,
    };
  }

  const estado = String(existing[0].estado || "");
  const abierta = /abierta|en curso/i.test(estado) && !existing[0].salida_at;

  if (abierta && !input.correccion) {
    await execute(
      `UPDATE sesiones_trabajo
       SET salida_at = ?, estado = 'CERRADA',
           comentarios_rrhh = COALESCE(?, comentarios_rrhh)
       WHERE id = ? AND empresa_id = ?`,
      [ts, input.comentarios ?? null, existing[0].id, empresaId],
    );
    return {
      ok: true,
      mensaje: `Salida de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
      id: Number(existing[0].id),
      tipoMarcaje: "Salida",
      nombre,
    };
  }

  if (!input.correccion) {
    return {
      ok: false,
      code: "NEEDS_CORRECTION",
      mensaje: `${nombre} ya tiene registro completo ese día. Indique si corrige Entrada o Salida.`,
      entradaActual: formatearTimestampVisible(fmtTs(existing[0].entrada_at)),
      salidaActual: formatearTimestampVisible(fmtTs(existing[0].salida_at)),
    };
  }

  if (input.correccion === "entrada") {
    await execute(
      `UPDATE sesiones_trabajo
       SET entrada_at = ?,
           comentarios_rrhh = COALESCE(?, comentarios_rrhh)
       WHERE id = ? AND empresa_id = ?`,
      [ts, input.comentarios ?? null, existing[0].id, empresaId],
    );
    return {
      ok: true,
      mensaje: `Entrada corregida de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
      id: Number(existing[0].id),
      tipoMarcaje: "Entrada (corregida)",
      nombre,
    };
  }

  await execute(
    `UPDATE sesiones_trabajo
     SET salida_at = ?, estado = 'CERRADA',
         comentarios_rrhh = COALESCE(?, comentarios_rrhh)
     WHERE id = ? AND empresa_id = ?`,
    [ts, input.comentarios ?? null, existing[0].id, empresaId],
  );
  return {
    ok: true,
    mensaje: `Salida corregida de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
    id: Number(existing[0].id),
    tipoMarcaje: "Salida (corregida)",
    nombre,
  };
}
