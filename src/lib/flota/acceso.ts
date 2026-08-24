import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { listarEmpresasActivas } from "@/lib/empresas";

/**
 * Una unidad propia o compartida con esta empresa.
 * Evita el falso "Vehículo no encontrado" en KT/Mónaco con flota compartida.
 */
export async function obtenerVehiculoAccesible(
  empresaId: number,
  vehiculoId: number,
  cols =
    "v.id, v.empresa_id, v.placa, v.marca, v.modelo, v.km_actual, v.en_taller, v.fecha_entrada_taller, v.motivo_taller, v.activo, v.estado, v.km_intervalo_servicio, v.km_ultimo_servicio, v.fecha_ultimo_servicio, v.odometro_funcional, v.mantenimiento_intervalo_meses, v.notas, v.rin_llanta, v.medida_llanta, v.tipo_aceite, v.descripcion, v.color, v.tipo_combustible, v.filtro_servicio_mayor, v.filtro_servicio_menor, v.empresa_activo",
): Promise<RowDataPacket | null> {
  if (!vehiculoId || !empresaId) return null;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT ${cols},
              CASE WHEN v.empresa_id = ? THEN 0 ELSE 1 END AS compartido
       FROM flota_vehiculos v
       WHERE v.id = ?
         AND (
           v.empresa_id = ?
           OR EXISTS (
             SELECT 1 FROM flota_vehiculo_acceso a
             WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
           )
         )
       LIMIT 1`,
      [empresaId, vehiculoId, empresaId, empresaId],
    );
    return rows[0] ?? null;
  } catch {
    const rows = await query<RowDataPacket[]>(
      `SELECT * FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [vehiculoId, empresaId],
    );
    return rows[0] ?? null;
  }
}

/** True si la empresa es dueña o tiene acceso compartido. */
export async function empresaPuedeUsarVehiculo(
  empresaId: number,
  vehiculoId: number,
): Promise<boolean> {
  const v = await obtenerVehiculoAccesible(empresaId, vehiculoId, "v.id");
  return Boolean(v);
}

/** Vehículos propios + compartidos con esta empresa. */
export async function listarVehiculosAccesibles(
  empresaId: number,
): Promise<RowDataPacket[]> {
  // Schema lo asegura la ruta API; no bloquear cada listado.
  try {
    return await query<RowDataPacket[]>(
      `SELECT v.id, v.empresa_id, v.placa, v.marca, v.modelo, v.descripcion,
              v.color, v.tipo_combustible, v.chasis, v.capacidad, v.km_actual,
              v.km_intervalo_servicio, v.km_ultimo_servicio, v.fecha_ultimo_servicio,
              v.odometro_funcional, v.mantenimiento_intervalo_meses,
              v.credito, v.empresa_activo, v.nit, v.condicion_propiedad, v.seguros,
              v.notas, v.activo, v.estado, v.en_taller, v.fecha_entrada_taller,
              v.motivo_taller, v.rin_llanta, v.medida_llanta, v.tipo_aceite,
              v.filtro_servicio_mayor, v.filtro_servicio_menor,
              e.codigo AS empresa_duena_codigo, e.nombre AS empresa_duena_nombre,
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

/** Accesos de varias unidades en una sola query. */
export async function empresasAccesoPorVehiculos(
  vehiculoIds: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  const ids = [...new Set(vehiculoIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT vehiculo_id, empresa_id FROM flota_vehiculo_acceso
       WHERE vehiculo_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of rows) {
      const vid = Number(r.vehiculo_id);
      const list = map.get(vid) ?? [];
      list.push(Number(r.empresa_id));
      map.set(vid, list);
    }
  } catch {
    /* tabla ausente */
  }
  return map;
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
  const rows = await listarEmpresasActivas();
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    slug: r.slug,
  }));
}
