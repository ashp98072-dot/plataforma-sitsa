import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import type { VehiculoSolicitadoOpcion } from "./vehiculo-solicitado";

/**
 * PROGRAMACION-VEHICULO-SOLICITADO — acceso a BD del catálogo REUTILIZADO (tms_cotizacion_costeo_perfiles). Siempre
 * filtrado por empresa: un id de otra empresa no existe para esta. Solo expone id/código/nombre (nunca parámetros de
 * costo del perfil).
 */

/** Perfiles ACTIVOS de la empresa para el selector. Sin la tabla (Cotizaciones no migrado) devuelve []. */
export async function listarVehiculosSolicitables(empresaId: number): Promise<VehiculoSolicitadoOpcion[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, codigo, nombre FROM tms_cotizacion_costeo_perfiles
       WHERE empresa_id = ? AND activo = 1 ORDER BY nombre, id`,
      [empresaId],
    );
    return rows.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre) }));
  } catch {
    return [];
  }
}

/** Valida un perfil para ASIGNARLO a un viaje: debe ser de esta empresa y estar activo. Devuelve id + nombre (snapshot). */
export async function resolverVehiculoSolicitado(
  empresaId: number,
  perfilId: number,
): Promise<{ id: number; nombre: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre FROM tms_cotizacion_costeo_perfiles WHERE empresa_id = ? AND id = ? AND activo = 1 LIMIT 1`,
    [empresaId, perfilId],
  );
  return rows[0] ? { id: Number(rows[0].id), nombre: String(rows[0].nombre) } : null;
}

/** Valor actual del viaje (lectura aparte del SELECT principal del PATCH, solo cuando el PATCH trae el campo). */
export async function vehiculoSolicitadoDelPlan(
  empresaId: number,
  planId: number,
): Promise<{ id: number | null; nombre: string | null }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [planId, empresaId],
  );
  const r = rows[0];
  return {
    id: r?.vehiculo_solicitado_perfil_id != null ? Number(r.vehiculo_solicitado_perfil_id) : null,
    nombre: r?.vehiculo_solicitado_nombre != null ? String(r.vehiculo_solicitado_nombre) : null,
  };
}

export const MSG_VEHICULO_SOLICITADO_INVALIDO = "El vehículo solicitado no existe en el catálogo de esta empresa o no está activo.";

/**
 * Columna inexistente (migración aún no aplicada en esta instalación). Las LECTURAS que agregan las columnas nuevas
 * reintentan sin ellas para que Programación/Planes/reportes nunca se rompan por el orden migración/despliegue (mismo
 * criterio que reportes-viajes.ts con las columnas de TC).
 */
export function esColumnaInexistente(e: unknown): boolean {
  const err = e as { code?: string; errno?: number } | null;
  return err?.code === "ER_BAD_FIELD_ERROR" || err?.errno === 1054;
}
