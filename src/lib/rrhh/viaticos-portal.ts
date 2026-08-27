import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/** Proyección propia: nunca devolver montos de compañeros ni datos administrativos. */
export async function listarHistorialViaticosPropios(empresaId: number, empleadoId: number, pagina: number) {
  const offset = (Math.max(1, Math.min(10000, Math.trunc(pagina) || 1)) - 1) * 50;
  const rows = await query<RowDataPacket[]>(
    `SELECT v.id, v.plan_id, pl.codigo, DATE_FORMAT(pl.fecha_plan, '%Y-%m-%d') AS fecha,
            v.monto_asignado, v.estado,
            DATE_FORMAT(v.entregado_en, '%d/%m/%Y %H:%i') AS entregado,
            DATE_FORMAT(v.liquidado_en, '%d/%m/%Y %H:%i') AS liquidado
     FROM tms_viaticos v
     INNER JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
     INNER JOIN tms_planes_viaje pl ON pl.id = v.plan_id AND pl.empresa_id = v.empresa_id
     WHERE v.empresa_id = ? AND tp.id_empleado = ? AND tp.tipo = 'Piloto'
     ORDER BY pl.fecha_plan DESC, v.id DESC LIMIT 51 OFFSET ?`,
    [empresaId, empleadoId, offset],
  );
  return {
    hayMas: rows.length > 50,
    items: rows.slice(0, 50).map((r) => ({
      id: Number(r.id), planId: Number(r.plan_id), codigo: String(r.codigo),
      fecha: String(r.fecha), monto: Number(r.monto_asignado ?? 0), estado: String(r.estado),
      entregado: r.entregado ? String(r.entregado) : null,
      liquidado: r.liquidado ? String(r.liquidado) : null,
    })),
  };
}
