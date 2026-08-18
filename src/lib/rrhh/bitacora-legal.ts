import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export type TipoBitacoraLegal =
  | "Amonestacion"
  | "Suspension"
  | "Despido"
  | "GestionGeneral"
  | "Otro";

export type BitacoraLegalEntrada = {
  id: number;
  empresaId: number;
  tipo: TipoBitacoraLegal;
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  empleadoId: number | null;
  empleadoNombre?: string | null;
  creadoPor: string | null;
  creadoEn: string;
};

const TIPOS_VALIDOS = new Set<TipoBitacoraLegal>([
  "Amonestacion",
  "Suspension",
  "Despido",
  "GestionGeneral",
  "Otro",
]);

function mapEntrada(r: RowDataPacket): BitacoraLegalEntrada {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    tipo: String(r.tipo) as TipoBitacoraLegal,
    fecha: String(r.fecha).slice(0, 10),
    descripcion: String(r.descripcion),
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    empleadoNombre: r.empleado_nombre ? String(r.empleado_nombre) : null,
    creadoPor: r.creado_por ? String(r.creado_por) : null,
    creadoEn: String(r.creado_en),
  };
}

const SELECT_BASE = `
  SELECT b.*, e.nombre AS empleado_nombre
  FROM rrhh_bitacora_legal b
  LEFT JOIN empleados e
    ON e.id = b.empleado_id AND e.empresa_id = b.empresa_id
`;

/**
 * Lista la bitácora legal de la empresa, más reciente primero. Filtros
 * opcionales por empleado (ficha individual) o tipo (p.ej. solo despidos).
 */
export async function listarBitacoraLegal(
  empresaId: number,
  opts?: { empleadoId?: number; tipo?: TipoBitacoraLegal; limite?: number },
): Promise<BitacoraLegalEntrada[]> {
  const condiciones = ["b.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (opts?.empleadoId) {
    condiciones.push("b.empleado_id = ?");
    params.push(opts.empleadoId);
  }
  if (opts?.tipo) {
    condiciones.push("b.tipo = ?");
    params.push(opts.tipo);
  }
  const limite = opts?.limite ?? 200;

  const rows = await query<RowDataPacket[]>(
    `${SELECT_BASE} WHERE ${condiciones.join(" AND ")}
     ORDER BY b.fecha DESC, b.id DESC
     LIMIT ${Number(limite)}`,
    params,
  );
  return rows.map(mapEntrada);
}

export async function crearEntradaBitacoraLegal(input: {
  empresaId: number;
  tipo: TipoBitacoraLegal;
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  empleadoId?: number | null;
  creadoPor: string;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  const descripcion = input.descripcion.trim();
  if (!descripcion) {
    return { ok: false, mensaje: "La descripción es obligatoria." };
  }
  if (!TIPOS_VALIDOS.has(input.tipo)) {
    return { ok: false, mensaje: "Tipo de bitácora inválido." };
  }
  if (!input.fecha || Number.isNaN(Date.parse(input.fecha))) {
    return { ok: false, mensaje: "Fecha inválida." };
  }
  if (input.empleadoId) {
    const emp = await query<RowDataPacket[]>(
      `SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [input.empleadoId, input.empresaId],
    );
    if (!emp[0]) {
      return { ok: false, mensaje: "El empleado indicado no existe en esta empresa." };
    }
  }

  const result = await execute(
    `INSERT INTO rrhh_bitacora_legal
      (empresa_id, tipo, fecha, descripcion, empleado_id, creado_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      input.tipo,
      input.fecha,
      descripcion,
      input.empleadoId || null,
      input.creadoPor,
    ],
  );
  return {
    ok: true,
    mensaje: "Registrado en la bitácora legal.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

/**
 * La bitácora legal es un registro histórico (evidencia de gestiones,
 * amonestaciones, etc.) — a propósito NO se expone una función de editar
 * el contenido. Solo se permite eliminar, para corregir un error de
 * captura, y queda igualmente auditado en rrhh_recordatorios/logs si la
 * empresa lo requiere más adelante.
 */
export async function eliminarEntradaBitacoraLegal(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const r = await execute(
    `DELETE FROM rrhh_bitacora_legal WHERE id = ? AND empresa_id = ?`,
    [id, empresaId],
  );
  const afectadas = Number((r as ResultSetHeader).affectedRows ?? 0);
  return afectadas > 0
    ? { ok: true, mensaje: "Registro eliminado." }
    : { ok: false, mensaje: "Registro no encontrado." };
}