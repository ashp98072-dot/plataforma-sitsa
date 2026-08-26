import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export type EstadoEntrevista =
  | "Programada"
  | "Realizada"
  | "Cancelada"
  | "No asistió";
export type ResultadoEntrevista = "Pendiente" | "Aprobado" | "Rechazado";
export type ModalidadEntrevista = "Presencial" | "Virtual";

export type Entrevista = {
  id: number;
  empresaId: number;
  candidatoNombre: string;
  candidatoTelefono: string | null;
  candidatoEmail: string | null;
  puesto: string;
  /** ISO completo "YYYY-MM-DDTHH:mm:ss" en hora local del servidor. */
  fechaHora: string;
  entrevistadorEmpleadoId: number | null;
  entrevistadorNombre?: string;
  modalidad: ModalidadEntrevista;
  lugarOEnlace: string | null;
  estado: EstadoEntrevista;
  resultado: ResultadoEntrevista;
  notas: string | null;
  creadoPor: string | null;
  creadoEn: string;
};

const ESTADOS_VALIDOS = new Set<EstadoEntrevista>([
  "Programada",
  "Realizada",
  "Cancelada",
  "No asistió",
]);
const RESULTADOS_VALIDOS = new Set<ResultadoEntrevista>([
  "Pendiente",
  "Aprobado",
  "Rechazado",
]);

function mapEntrevista(r: RowDataPacket): Entrevista {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    candidatoNombre: String(r.candidato_nombre),
    candidatoTelefono: r.candidato_telefono ? String(r.candidato_telefono) : null,
    candidatoEmail: r.candidato_email ? String(r.candidato_email) : null,
    puesto: String(r.puesto),
    fechaHora: String(r.fecha_hora).slice(0, 19).replace(" ", "T"),
    entrevistadorEmpleadoId:
      r.entrevistador_empleado_id != null
        ? Number(r.entrevistador_empleado_id)
        : null,
    entrevistadorNombre: r.entrevistador_nombre
      ? String(r.entrevistador_nombre)
      : undefined,
    modalidad: (String(r.modalidad) as ModalidadEntrevista) || "Presencial",
    lugarOEnlace: r.lugar_o_enlace ? String(r.lugar_o_enlace) : null,
    estado: String(r.estado) as EstadoEntrevista,
    resultado: String(r.resultado ?? "Pendiente") as ResultadoEntrevista,
    notas: r.notas ? String(r.notas) : null,
    creadoPor: r.creado_por ? String(r.creado_por) : null,
    creadoEn: String(r.creado_en),
  };
}

const SELECT_BASE = `
  SELECT ent.*, e.nombre AS entrevistador_nombre
  FROM entrevistas ent
  LEFT JOIN empleados e
    ON e.id = ent.entrevistador_empleado_id AND e.empresa_id = ent.empresa_id
`;

/** Obtiene una entrevista aislada por empresa para reutilizar sus datos en el alta. */
export async function obtenerEntrevista(
  empresaId: number,
  id: number,
): Promise<Entrevista | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE}
     WHERE ent.empresa_id = ? AND ent.id = ?
     LIMIT 1`,
    [empresaId, id],
  );
  return rows[0] ? mapEntrevista(rows[0]) : null;
}

/** Todas las entrevistas de un mes calendario (para el calendario de RRHH). */
export async function listarEntrevistasPorMes(
  empresaId: number,
  anio: number,
  mes: number, // 1-12
): Promise<Entrevista[]> {
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01 00:00:00`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")} 23:59:59`;
  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE}
     WHERE ent.empresa_id = ? AND ent.fecha_hora BETWEEN ? AND ?
     ORDER BY ent.fecha_hora`,
    [empresaId, desde, hasta],
  );
  return rows.map(mapEntrevista);
}

/** Entrevistas asignadas a UN entrevistador (portal del supervisor). */
export async function listarEntrevistasPorEntrevistador(
  empresaId: number,
  empleadoId: number,
  opts?: { soloProximas?: boolean },
): Promise<Entrevista[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE}
     WHERE ent.empresa_id = ? AND ent.entrevistador_empleado_id = ?
       ${opts?.soloProximas ? "AND ent.fecha_hora >= NOW() AND ent.estado = 'Programada'" : ""}
     ORDER BY ent.fecha_hora ${opts?.soloProximas ? "ASC" : "DESC"}
     LIMIT 100`,
    [empresaId, empleadoId],
  );
  return rows.map(mapEntrevista);
}

export async function crearEntrevista(input: {
  empresaId: number;
  candidatoNombre: string;
  candidatoTelefono?: string | null;
  candidatoEmail?: string | null;
  puesto: string;
  fechaHora: string; // "YYYY-MM-DDTHH:mm"
  entrevistadorEmpleadoId?: number | null;
  modalidad?: ModalidadEntrevista;
  lugarOEnlace?: string | null;
  notas?: string | null;
  creadoPor: string;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  const nombre = input.candidatoNombre.trim();
  const puesto = input.puesto.trim();
  if (!nombre || !puesto) {
    return { ok: false, mensaje: "Nombre del candidato y puesto son obligatorios." };
  }
  if (!input.fechaHora || Number.isNaN(Date.parse(input.fechaHora))) {
    return { ok: false, mensaje: "Fecha y hora inválidas." };
  }

  if (input.entrevistadorEmpleadoId) {
    const emp = await query<RowDataPacket[]>(
      `SELECT id FROM empleados WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
      [input.entrevistadorEmpleadoId, input.empresaId],
    );
    if (!emp[0]) {
      return { ok: false, mensaje: "El entrevistador no es un empleado activo de esta empresa." };
    }
  }

  const result = await execute(
    `INSERT INTO entrevistas
      (empresa_id, candidato_nombre, candidato_telefono, candidato_email, puesto,
       fecha_hora, entrevistador_empleado_id, modalidad, lugar_o_enlace, notas, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      nombre,
      input.candidatoTelefono?.trim() || null,
      input.candidatoEmail?.trim() || null,
      puesto,
      input.fechaHora.replace("T", " "),
      input.entrevistadorEmpleadoId || null,
      input.modalidad ?? "Presencial",
      input.lugarOEnlace?.trim() || null,
      input.notas?.trim() || null,
      input.creadoPor,
    ],
  );
  return {
    ok: true,
    mensaje: "Entrevista programada.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

/**
 * Actualiza campos de la entrevista. Usado tanto por RRHH (reprogramar,
 * reasignar entrevistador, cancelar) como por el entrevistador desde el
 * portal (marcar estado/resultado/notas después de realizarla) — el
 * caller decide qué campos permite tocar cada uno, esta función no
 * distingue el origen.
 */
export async function actualizarEntrevista(
  empresaId: number,
  id: number,
  patch: {
    fechaHora?: string;
    entrevistadorEmpleadoId?: number | null;
    modalidad?: ModalidadEntrevista;
    lugarOEnlace?: string | null;
    estado?: EstadoEntrevista;
    resultado?: ResultadoEntrevista;
    notas?: string | null;
  },
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM entrevistas WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  if (!rows[0]) return { ok: false, mensaje: "Entrevista no encontrada." };

  if (patch.estado && !ESTADOS_VALIDOS.has(patch.estado)) {
    return { ok: false, mensaje: "Estado inválido." };
  }
  if (patch.resultado && !RESULTADOS_VALIDOS.has(patch.resultado)) {
    return { ok: false, mensaje: "Resultado inválido." };
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.fechaHora !== undefined) {
    sets.push("fecha_hora = ?");
    params.push(patch.fechaHora.replace("T", " "));
  }
  if (patch.entrevistadorEmpleadoId !== undefined) {
    sets.push("entrevistador_empleado_id = ?");
    params.push(patch.entrevistadorEmpleadoId);
  }
  if (patch.modalidad !== undefined) {
    sets.push("modalidad = ?");
    params.push(patch.modalidad);
  }
  if (patch.lugarOEnlace !== undefined) {
    sets.push("lugar_o_enlace = ?");
    params.push(patch.lugarOEnlace || null);
  }
  if (patch.estado !== undefined) {
    sets.push("estado = ?");
    params.push(patch.estado);
  }
  if (patch.resultado !== undefined) {
    sets.push("resultado = ?");
    params.push(patch.resultado);
  }
  if (patch.notas !== undefined) {
    sets.push("notas = ?");
    params.push(patch.notas || null);
  }
  if (sets.length === 0) {
    return { ok: false, mensaje: "Nada que actualizar." };
  }

  params.push(id, empresaId);
  await execute(
    `UPDATE entrevistas SET ${sets.join(", ")} WHERE id = ? AND empresa_id = ?`,
    params,
  );
  return { ok: true, mensaje: "Entrevista actualizada." };
}

export async function eliminarEntrevista(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const r = await execute(
    `DELETE FROM entrevistas WHERE id = ? AND empresa_id = ?`,
    [id, empresaId],
  );
  const afectadas = Number((r as ResultSetHeader).affectedRows ?? 0);
  return afectadas > 0
    ? { ok: true, mensaje: "Entrevista eliminada." }
    : { ok: false, mensaje: "Entrevista no encontrada." };
}
