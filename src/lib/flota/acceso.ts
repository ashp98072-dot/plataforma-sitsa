import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { sincronizarKmVehiculosDesdeHistorial } from "@/lib/flota/km-vehiculo";
import { asegurarSchemaFlota } from "@/lib/flota/schema";

/** Vehículos propios + compartidos con esta empresa. */
export async function listarVehiculosAccesibles(
  empresaId: number,
): Promise<RowDataPacket[]> {
  await asegurarSchemaFlota().catch(() => undefined);
  // Corrige km_actual si un viaje cerrado no lo actualizó (ej. unidad compartida)
  await sincronizarKmVehiculosDesdeHistorial(empresaId).catch(() => undefined);
  try {
    return await query<RowDataPacket[]>(
      `SELECT v.*, e.codigo AS empresa_duena_codigo, e.nombre AS empresa_duena_nombre,
              CASE WHEN v.empresa_id = ? THEN 0 ELSE 1 END AS compartido
       FROM flota_vehiculos v
       LEFT JOIN empresas e ON e.id = v.empresa_id
       WHERE v.empresa_id = ?
          OR EXISTS (
            SELECT 1 FROM flota_vehiculo_acceso a
            WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
          )
       ORDER BY v.activo DESC, v.placa`,
      [empresaId, empresaId, empresaId],
    );
  } catch {
    return query<RowDataPacket[]>(
      `SELECT * FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
      [empresaId],
    );
  }
}

/**
 * Lectura liviana para el poll de notificaciones: sin sync de KM ni SELECT *.
 */
export async function listarVehiculosParaAlertasKm(
  empresaId: number,
): Promise<RowDataPacket[]> {
  try {
    return await query<RowDataPacket[]>(
      `SELECT v.placa, v.activo, v.km_actual, v.km_ultimo_servicio, v.km_intervalo_servicio
       FROM flota_vehiculos v
       WHERE v.empresa_id = ?
          OR EXISTS (
            SELECT 1 FROM flota_vehiculo_acceso a
            WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
          )`,
      [empresaId, empresaId],
    );
  } catch {
    return query<RowDataPacket[]>(
      `SELECT placa, activo, km_actual, km_ultimo_servicio, km_intervalo_servicio
       FROM flota_vehiculos WHERE empresa_id = ?`,
      [empresaId],
    );
  }
}

export async function empresasAccesoVehiculo(
  vehiculoId: number,
): Promise<number[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT empresa_id FROM flota_vehiculo_acceso WHERE vehiculo_id = ?",
      [vehiculoId],
    );
    return rows.map((r) => Number(r.empresa_id));
  } catch {
    return [];
  }
}

export async function guardarAccesoVehiculo(
  vehiculoId: number,
  empresaIds: number[],
  empresaDuenia: number,
): Promise<void> {
  await asegurarSchemaFlota().catch(() => undefined);
  await execute("DELETE FROM flota_vehiculo_acceso WHERE vehiculo_id = ?", [
    vehiculoId,
  ]);
  const unicos = [...new Set(empresaIds.map(Number))].filter(
    (id) => id > 0 && id !== empresaDuenia,
  );
  for (const eid of unicos) {
    await execute(
      "INSERT IGNORE INTO flota_vehiculo_acceso (vehiculo_id, empresa_id) VALUES (?, ?)",
      [vehiculoId, eid],
    );
  }
}

export async function listarEmpresasActivasSimple(): Promise<
  { id: number; codigo: string; nombre: string; slug: string }[]
> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre, slug FROM empresas WHERE activa = 1 ORDER BY nombre",
  );
  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    slug: String(r.slug),
  }));
}
