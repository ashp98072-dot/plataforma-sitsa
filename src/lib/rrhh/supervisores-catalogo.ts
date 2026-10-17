import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

export type SupervisorCatalogo = { id: number; nombre: string; numeroEmpleado: string; codigo: string };

/** Mismo universo Activo y orden del catálogo anterior; sin documentos, fotos ni ficha completa. */
export async function listarCatalogoSupervisores(empresaId: number): Promise<SupervisorCatalogo[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, numero_empleado, codigo FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`, [empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id), nombre: String(r.nombre ?? ""),
    numeroEmpleado: String(r.numero_empleado ?? ""), codigo: String(r.codigo ?? ""),
  }));
}
