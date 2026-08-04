import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { formatearTimestampVisible, toIsoDate } from "./dates";

export type EmpleadoVariable = {
  id: number;
  codigo: string;
  nombre: string;
};

export async function obtenerEmpleadosVariables(
  empresaId: number,
): Promise<EmpleadoVariable[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'
       AND (tipo_horario = 'Variable' OR tipo_horario LIKE '%Variable%')
     ORDER BY nombre ASC`,
    [empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
  }));
}

export async function registrarEnRuta(
  empresaId: number,
  input: {
    idEmpleado: number;
    fechaInicio: string;
    fechaFin: string;
    comentario?: string;
    registradoPor?: string;
  },
): Promise<{ ok: boolean; mensaje: string }> {
  const emp = await query<RowDataPacket[]>(
    "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1",
    [input.idEmpleado, empresaId],
  );
  if (!emp[0]) return { ok: false, mensaje: "Empleado no encontrado." };
  try {
    await execute(
      `INSERT INTO marcajes_en_ruta
        (empresa_id, id_empleado, fecha_inicio, fecha_fin, comentario, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        input.idEmpleado,
        input.fechaInicio,
        input.fechaFin,
        input.comentario ?? "",
        input.registradoPor ?? "",
      ],
    );
    return { ok: true, mensaje: "En ruta registrado." };
  } catch {
    return {
      ok: false,
      mensaje: "Falta tabla marcajes_en_ruta (migrate-2026-08-rrhh-core.sql).",
    };
  }
}

export type RegistroEnRuta = {
  id: number;
  idEmpleado: number;
  codigo: string;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  comentario: string;
  registradoPor: string;
  creadoEn: string;
};

export async function obtenerRegistrosEnRuta(
  empresaId: number,
  fechaInicio: string,
  fechaFin: string,
): Promise<RegistroEnRuta[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT r.id, r.id_empleado, e.codigo, e.nombre, r.fecha_inicio, r.fecha_fin,
              r.comentario, r.registrado_por, r.creado_en
       FROM marcajes_en_ruta r
       JOIN empleados e ON r.id_empleado = e.id
       WHERE r.empresa_id = ?
         AND r.fecha_inicio <= ? AND r.fecha_fin >= ?
       ORDER BY r.fecha_inicio DESC`,
      [empresaId, fechaFin, fechaInicio],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      idEmpleado: Number(r.id_empleado),
      codigo: String(r.codigo),
      nombre: String(r.nombre),
      fechaInicio: toIsoDate(r.fecha_inicio as string | Date) ?? "",
      fechaFin: toIsoDate(r.fecha_fin as string | Date) ?? "",
      comentario: String(r.comentario ?? ""),
      registradoPor: String(r.registrado_por ?? ""),
      creadoEn: formatearTimestampVisible(
        r.creado_en ? String(r.creado_en).replace("T", " ").slice(0, 19) : null,
      ),
    }));
  } catch {
    return [];
  }
}

export async function eliminarEnRuta(
  empresaId: number,
  idRegistro: number,
): Promise<boolean> {
  const r = await execute(
    "DELETE FROM marcajes_en_ruta WHERE id = ? AND empresa_id = ?",
    [idRegistro, empresaId],
  );
  return r.affectedRows > 0;
}
