import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { asegurarSchemaEmpleados } from "./empleados-schema";

export type EmpleadoVacacionesCatalogo = { id: number; codigo: string; nombre: string; dpi: string };

/** Mismo universo sin filtro de estado y orden del listado usado por Vacaciones. */
export async function listarCatalogoEmpleadosVacaciones(empresaId: number): Promise<EmpleadoVacacionesCatalogo[]> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, dpi FROM empleados
     WHERE empresa_id = ? ORDER BY nombre`, [empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id), codigo: String(r.codigo ?? ""),
    nombre: String(r.nombre ?? ""), dpi: String(r.dpi ?? ""),
  }));
}
