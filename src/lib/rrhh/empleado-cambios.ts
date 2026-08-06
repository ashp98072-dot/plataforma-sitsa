import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "./dates";

export type EmpleadoCambio = {
  id: number;
  campo: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  registradoPor: string | null;
  creadoAt: string;
};

export async function registrarCambiosEmpleado(opts: {
  empresaId: number;
  empleadoId: number;
  username: string;
  antes: Record<string, string | number | null | undefined>;
  despues: Record<string, string | number | null | undefined>;
  campos: string[];
}): Promise<void> {
  const ahora = ahoraLocal();
  for (const campo of opts.campos) {
    const a =
      opts.antes[campo] == null || opts.antes[campo] === ""
        ? null
        : String(opts.antes[campo]);
    const b =
      opts.despues[campo] == null || opts.despues[campo] === ""
        ? null
        : String(opts.despues[campo]);
    if (a === b) continue;
    try {
      await execute(
        `INSERT INTO empleado_cambios
          (empresa_id, id_empleado, campo, valor_anterior, valor_nuevo, registrado_por, creado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          opts.empresaId,
          opts.empleadoId,
          campo,
          a,
          b,
          opts.username,
          ahora,
        ],
      );
    } catch {
      /* tabla ausente */
    }
  }
}

export async function listarCambiosEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<EmpleadoCambio[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, campo, valor_anterior, valor_nuevo, registrado_por, creado_at
       FROM empleado_cambios
       WHERE empresa_id = ? AND id_empleado = ?
       ORDER BY creado_at DESC, id DESC
       LIMIT 100`,
      [empresaId, empleadoId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      campo: String(r.campo),
      valorAnterior: r.valor_anterior != null ? String(r.valor_anterior) : null,
      valorNuevo: r.valor_nuevo != null ? String(r.valor_nuevo) : null,
      registradoPor:
        r.registrado_por != null ? String(r.registrado_por) : null,
      creadoAt: String(r.creado_at).replace("T", " ").slice(0, 19),
    }));
  } catch {
    return [];
  }
}
