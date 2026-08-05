import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { toIsoDate } from "./dates";

export type Empleado = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
  categoriaOps: string;
  tipoHorario: string;
  fechaAlta: string;
  fechaInicioLaboral: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: string;
  docsCount?: number;
};

type EmpleadoRow = RowDataPacket & {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string | null;
  categoria_ops: string | null;
  tipo_horario: string;
  fecha_alta: string | Date | null;
  fecha_inicio_laboral: string | Date | null;
  hora_entrada_teorica: string;
  hora_salida_teorica: string;
  estado: string;
};

function mapEmpleado(row: EmpleadoRow): Empleado {
  return {
    id: Number(row.id),
    codigo: String(row.codigo),
    nombre: String(row.nombre),
    puesto: row.puesto ? String(row.puesto) : "",
    categoriaOps: row.categoria_ops ? String(row.categoria_ops) : "",
    tipoHorario: String(row.tipo_horario ?? "Fijo").includes("Variable")
      ? "Variable"
      : "Fijo",
    fechaAlta: toIsoDate(row.fecha_alta) ?? "",
    fechaInicioLaboral: toIsoDate(row.fecha_inicio_laboral),
    horaEntradaTeorica: String(row.hora_entrada_teorica || "08:00:00"),
    horaSalidaTeorica: String(row.hora_salida_teorica || "17:00:00"),
    estado: String(row.estado || "Activo"),
  };
}

const SELECT_COLS = `id, codigo, nombre, puesto, categoria_ops, tipo_horario,
  fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica, estado`;

export async function listarEmpleados(
  empresaId: number,
  filtro = "",
): Promise<Empleado[]> {
  const f = filtro.trim();
  const rows = f
    ? await query<EmpleadoRow[]>(
        `SELECT ${SELECT_COLS} FROM empleados
         WHERE empresa_id = ? AND (nombre LIKE ? OR codigo LIKE ?)
         ORDER BY nombre`,
        [empresaId, `%${f}%`, `%${f}%`],
      )
    : await query<EmpleadoRow[]>(
        `SELECT ${SELECT_COLS} FROM empleados
         WHERE empresa_id = ? ORDER BY nombre`,
        [empresaId],
      );
  const empleados = rows.map(mapEmpleado);
  try {
    const { contarDocumentosPorEmpleado } = await import("./documentos");
    const counts = await contarDocumentosPorEmpleado(
      empresaId,
      empleados.map((e) => e.id),
    );
    for (const e of empleados) {
      e.docsCount = counts.get(e.id) ?? 0;
    }
  } catch {
    for (const e of empleados) e.docsCount = 0;
  }
  return empleados;
}

export async function obtenerEmpleado(
  empresaId: number,
  id: number,
): Promise<Empleado | null> {
  const rows = await query<EmpleadoRow[]>(
    `SELECT ${SELECT_COLS} FROM empleados
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapEmpleado(rows[0]) : null;
}

export async function obtenerEmpleadoPorCodigo(
  empresaId: number,
  codigo: string,
): Promise<Empleado | null> {
  const rows = await query<EmpleadoRow[]>(
    `SELECT ${SELECT_COLS} FROM empleados
     WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [empresaId, codigo.trim()],
  );
  return rows[0] ? mapEmpleado(rows[0]) : null;
}

export async function codigoDuplicado(
  empresaId: number,
  codigo: string,
  idExcluir?: number | null,
): Promise<boolean> {
  if (idExcluir != null) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id FROM empleados
       WHERE empresa_id = ? AND codigo = ? AND id != ? LIMIT 1`,
      [empresaId, codigo.trim(), idExcluir],
    );
    return rows.length > 0;
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [empresaId, codigo.trim()],
  );
  return rows.length > 0;
}

export type EmpleadoInput = {
  codigo: string;
  nombre: string;
  puesto?: string;
  categoriaOps?: string;
  tipoHorario: "Fijo" | "Variable";
  fechaAlta: string;
  fechaInicioLaboral?: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: "Activo" | "Baja";
};

export async function crearEmpleado(
  empresaId: number,
  data: EmpleadoInput,
): Promise<number> {
  const cat = data.categoriaOps?.trim() || null;
  try {
    const result = await execute(
      `INSERT INTO empleados (
        empresa_id, codigo, nombre, puesto, categoria_ops, tipo_horario,
        fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        data.codigo.trim(),
        data.nombre.trim(),
        data.puesto ?? "",
        cat,
        data.tipoHorario,
        data.fechaAlta,
        data.fechaInicioLaboral ?? null,
        data.horaEntradaTeorica,
        data.horaSalidaTeorica,
        data.estado,
      ],
    );
    return Number((result as ResultSetHeader).insertId);
  } catch {
    const result = await execute(
      `INSERT INTO empleados (
        empresa_id, codigo, nombre, puesto, tipo_horario,
        fecha_alta, fecha_inicio_laboral, hora_entrada_teorica, hora_salida_teorica, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        data.codigo.trim(),
        data.nombre.trim(),
        data.puesto ?? "",
        data.tipoHorario,
        data.fechaAlta,
        data.fechaInicioLaboral ?? null,
        data.horaEntradaTeorica,
        data.horaSalidaTeorica,
        data.estado,
      ],
    );
    return Number((result as ResultSetHeader).insertId);
  }
}

export async function actualizarEmpleado(
  empresaId: number,
  id: number,
  data: EmpleadoInput,
): Promise<boolean> {
  const cat = data.categoriaOps?.trim() || null;
  try {
    const result = await execute(
      `UPDATE empleados SET
        codigo = ?, nombre = ?, puesto = ?, categoria_ops = ?, tipo_horario = ?,
        fecha_alta = ?, fecha_inicio_laboral = ?,
        hora_entrada_teorica = ?, hora_salida_teorica = ?, estado = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        data.codigo.trim(),
        data.nombre.trim(),
        data.puesto ?? "",
        cat,
        data.tipoHorario,
        data.fechaAlta,
        data.fechaInicioLaboral ?? null,
        data.horaEntradaTeorica,
        data.horaSalidaTeorica,
        data.estado,
        id,
        empresaId,
      ],
    );
    return result.affectedRows > 0;
  } catch {
    const result = await execute(
      `UPDATE empleados SET
        codigo = ?, nombre = ?, puesto = ?, tipo_horario = ?,
        fecha_alta = ?, fecha_inicio_laboral = ?,
        hora_entrada_teorica = ?, hora_salida_teorica = ?, estado = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        data.codigo.trim(),
        data.nombre.trim(),
        data.puesto ?? "",
        data.tipoHorario,
        data.fechaAlta,
        data.fechaInicioLaboral ?? null,
        data.horaEntradaTeorica,
        data.horaSalidaTeorica,
        data.estado,
        id,
        empresaId,
      ],
    );
    return result.affectedRows > 0;
  }
}

export async function eliminarEmpleado(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const emp = await obtenerEmpleado(empresaId, id);
  if (!emp) return { ok: false, mensaje: "Empleado no encontrado." };
  const result = await execute(
    "DELETE FROM empleados WHERE id = ? AND empresa_id = ?",
    [id, empresaId],
  );
  if (result.affectedRows === 0) {
    return { ok: false, mensaje: "No se pudo eliminar." };
  }
  return {
    ok: true,
    mensaje: `Empleado '${emp.nombre}' eliminado.`,
  };
}
