import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * CLIENTE-PORTAL-1 — lo mínimo que la landing del portal necesita mostrar
 * (nombre del cliente). Deliberadamente NO trae nada más (sin
 * solicitudes/viajes/evidencias todavía — eso es CLIENTE-PORTAL-2 en
 * adelante). Filtra por empresaId + id a la vez (nunca solo por id) —
 * mismo criterio anti-IDOR que el resto del proyecto.
 */
export async function obtenerNombreCliente(
  empresaId: number,
  clienteId: number,
): Promise<string | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT nombre FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [clienteId, empresaId],
  );
  return rows[0] ? String(rows[0].nombre) : null;
}
