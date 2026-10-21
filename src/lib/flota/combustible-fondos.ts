import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

export type LineaFondoCombustible = {
  id: number; solicitudId: number; codigo: string; categoria: string; estado: string;
  vehiculoId: number | null; placa: string | null; empleadoRelacionado: string | null;
  montoSolicitado: string; vales: number; pendiente: string; aprobado: string; rechazado: string;
};
export const ESTADOS_FONDO_COMBUSTIBLE = ["Autorizada", "Liquidada"] as const;
export function validarLineaFondoCombustible(linea: { categoria: string; estado: string; vehiculo_id: number | null } | undefined, vehiculoId: number) {
  if (!linea) throw new ErrorDominioFormulario("Línea de solicitud no disponible para esta empresa.");
  if (linea.categoria !== "Combustible") throw new ErrorDominioFormulario("La línea debe ser de categoría Combustible.");
  if (!(ESTADOS_FONDO_COMBUSTIBLE as readonly string[]).includes(linea.estado)) throw new ErrorDominioFormulario("La solicitud debe estar Autorizada o Liquidada.");
  if (linea.vehiculo_id != null && Number(linea.vehiculo_id) !== vehiculoId) throw new ErrorDominioFormulario("La unidad del vale no coincide con la línea de solicitud.");
}

/** Cabecera antes de línea: mismo orden que edición/cambio de estado en Fondos.
 * El primer SELECT solo descubre el padre; se relee todo bajo bloqueo antes de escribir. */
export async function validarLineaFondoCombustibleTx(conn: PoolConnection, empresaId: number, lineaId: number, vehiculoId: number) {
  const [padres] = await conn.query<RowDataPacket[]>("SELECT solicitud_id FROM tms_solicitud_fondo_lineas WHERE empresa_id=? AND id=?", [empresaId, lineaId]);
  if (!padres[0]) return validarLineaFondoCombustible(undefined, vehiculoId);
  const [solicitudes] = await conn.query<RowDataPacket[]>("SELECT estado FROM tms_solicitudes_fondo WHERE empresa_id=? AND id=? FOR UPDATE", [empresaId, padres[0].solicitud_id]);
  const [lineas] = await conn.query<RowDataPacket[]>("SELECT categoria, vehiculo_id FROM tms_solicitud_fondo_lineas WHERE empresa_id=? AND solicitud_id=? AND id=? FOR UPDATE", [empresaId, padres[0].solicitud_id, lineaId]);
  validarLineaFondoCombustible(solicitudes[0] && lineas[0] ? { categoria: String(lineas[0].categoria), estado: String(solicitudes[0].estado), vehiculo_id: lineas[0].vehiculo_id } : undefined, vehiculoId);
}

function mapLinea(r: RowDataPacket): LineaFondoCombustible {
  return { id: Number(r.id), solicitudId: Number(r.solicitud_id), codigo: String(r.codigo), categoria: String(r.categoria), estado: String(r.estado),
    vehiculoId: r.vehiculo_id == null ? null : Number(r.vehiculo_id), placa: r.placa ?? null, empleadoRelacionado: r.empleado_nombre ?? null,
    montoSolicitado: String(r.monto_solicitado), vales: Number(r.vales ?? 0), pendiente: String(r.pendiente ?? "0.00"), aprobado: String(r.aprobado ?? "0.00"), rechazado: String(r.rechazado ?? "0.00") };
}

/** Proyección operacional: nunca cuenta/banco, datos de pago ni expediente completo.
 * Agrega cargas antes del JOIN para no multiplicar cantidad*monto. */
export async function buscarLineasFondoCombustible(empresaId: number, busqueda = "", lineaId?: number): Promise<LineaFondoCombustible[]> {
  const texto = `%${busqueda.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await query<RowDataPacket[]>(`SELECT l.id, l.solicitud_id, s.codigo, s.estado, l.categoria, l.vehiculo_id, l.placa, l.empleado_nombre,
    CAST(l.cantidad*l.monto AS DECIMAL(22,4)) AS monto_solicitado,
    a.vales, a.pendiente, a.aprobado, a.rechazado
    FROM tms_solicitud_fondo_lineas l
    JOIN tms_solicitudes_fondo s ON s.empresa_id=l.empresa_id AND s.id=l.solicitud_id
    LEFT JOIN (SELECT empresa_id, solicitud_fondo_linea_id, COUNT(*) AS vales,
      SUM(CASE WHEN estado='PENDIENTE' THEN monto ELSE 0 END) AS pendiente,
      SUM(CASE WHEN estado='APROBADO' THEN monto ELSE 0 END) AS aprobado,
      SUM(CASE WHEN estado='RECHAZADO' THEN monto ELSE 0 END) AS rechazado
      FROM flota_combustible_cargas WHERE empresa_id=? AND solicitud_fondo_linea_id IS NOT NULL
      GROUP BY empresa_id, solicitud_fondo_linea_id) a ON a.empresa_id=l.empresa_id AND a.solicitud_fondo_linea_id=l.id
    WHERE l.empresa_id=? AND l.categoria='Combustible'
    ${lineaId == null ? "AND s.estado IN ('Autorizada','Liquidada') AND (s.codigo LIKE ? OR l.placa LIKE ? OR l.empleado_nombre LIKE ?)" : "AND l.id=?"}
    ORDER BY s.id DESC, l.orden, l.id LIMIT 50`, lineaId == null ? [empresaId, empresaId, texto, texto, texto] : [empresaId, empresaId, lineaId]);
  return rows.map(mapLinea);
}

/** Contexto histórico actual incluso si la solicitud fue rechazada posteriormente. Sin N+1. */
export async function contextosFondosCombustible(empresaId: number, ids: number[]) {
  if (!ids.length) return new Map<number, LineaFondoCombustible>();
  const rows = await query<RowDataPacket[]>(`SELECT l.id, l.solicitud_id, s.codigo, s.estado, l.categoria, l.vehiculo_id, l.placa, l.empleado_nombre,
    CAST(l.cantidad*l.monto AS DECIMAL(22,4)) AS monto_solicitado
    FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id=l.empresa_id AND s.id=l.solicitud_id
    WHERE l.empresa_id=? AND l.id IN (${ids.map(() => "?").join(",")})`, [empresaId, ...ids]);
  return new Map(rows.map(r => [Number(r.id), mapLinea(r)]));
}
