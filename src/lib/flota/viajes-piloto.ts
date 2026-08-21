import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

export type ViajeAbiertoPiloto = {
  id: number;
  placa: string;
  kmSalida: number;
  horaSalida: string;
  destino: string | null;
  planId: number | null;
};

/** El viaje abierto del propio piloto, si tiene uno (portal). */
export async function obtenerViajeAbiertoDeEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<ViajeAbiertoPiloto | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT v.id, v.km_salida, v.hora_salida, v.destino, v.plan_id, ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.empresa_id = ? AND v.empleado_id = ? AND v.estado = 'abierto'
     LIMIT 1`,
    [empresaId, empleadoId],
  ).catch(() => [] as RowDataPacket[]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    placa: String(r.placa),
    kmSalida: Number(r.km_salida),
    horaSalida: String(r.hora_salida),
    destino: r.destino ? String(r.destino) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
  };
}
