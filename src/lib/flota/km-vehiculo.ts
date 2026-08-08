import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

/**
 * Actualiza km_actual de la unidad y, si aplica, duplicados compartidos
 * de la misma placa en el mismo grupo de acceso (no toda la BD).
 */
export async function actualizarKmActualVehiculo(
  vehiculoId: number,
  km: number,
): Promise<void> {
  if (!vehiculoId || !Number.isFinite(km)) return;
  const valor = Math.max(0, Math.floor(km));
  await execute(
    `UPDATE flota_vehiculos
     SET km_actual = GREATEST(COALESCE(km_actual, 0), ?)
     WHERE id = ?`,
    [valor, vehiculoId],
  ).catch(() => undefined);

  // Duplicados de la misma placa solo entre dueño + empresas con acceso cruzado.
  // Evita pisar km de otra unidad ajena que coincida en placa.
  try {
    await execute(
      `UPDATE flota_vehiculos v
       INNER JOIN flota_vehiculos src ON src.id = ?
       SET v.km_actual = GREATEST(COALESCE(v.km_actual, 0), ?)
       WHERE v.id <> src.id
         AND UPPER(REPLACE(REPLACE(COALESCE(v.placa,''),' ',''),'-','')) =
             UPPER(REPLACE(REPLACE(COALESCE(src.placa,''),' ',''),'-',''))
         AND UPPER(REPLACE(REPLACE(COALESCE(src.placa,''),' ',''),'-','')) <> ''
         AND (
           v.empresa_id = src.empresa_id
           OR EXISTS (
             SELECT 1 FROM flota_vehiculo_acceso a
             WHERE a.vehiculo_id = src.id AND a.empresa_id = v.empresa_id
           )
           OR EXISTS (
             SELECT 1 FROM flota_vehiculo_acceso a
             WHERE a.vehiculo_id = v.id AND a.empresa_id = src.empresa_id
           )
         )`,
      [vehiculoId, valor],
    );
  } catch {
    /* ok */
  }
}

/**
 * Si hay viajes/lecturas con km mayor al registrado en la unidad, lo corrige.
 * Útil tras cierres que no actualizaron por filtro empresa_id o unidades compartidas.
 */
export async function sincronizarKmVehiculosDesdeHistorial(
  empresaId?: number,
): Promise<void> {
  try {
    // Por vehiculo_id del viaje
    await execute(
      `UPDATE flota_vehiculos v
       INNER JOIN (
         SELECT vehiculo_id,
                MAX(km_llegada) AS max_llegada,
                MAX(km_salida) AS max_salida
         FROM flota_viajes
         GROUP BY vehiculo_id
       ) t ON t.vehiculo_id = v.id
       SET v.km_actual = GREATEST(
         COALESCE(v.km_actual, 0),
         COALESCE(t.max_llegada, 0),
         COALESCE(t.max_salida, 0)
       )
       ${
         empresaId
           ? `WHERE v.empresa_id = ? OR EXISTS (
                SELECT 1 FROM flota_vehiculo_acceso a
                WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
              )`
           : ""
       }`,
      empresaId ? [empresaId, empresaId] : [],
    );

    // Por misma placa (si el viaje quedó en otra fila duplicada)
    await execute(
      `UPDATE flota_vehiculos v
       INNER JOIN (
         SELECT UPPER(REPLACE(REPLACE(ve.placa,' ',''),'-','')) AS placa_n,
                MAX(GREATEST(COALESCE(vj.km_llegada,0), COALESCE(vj.km_salida,0))) AS max_km
         FROM flota_viajes vj
         INNER JOIN flota_vehiculos ve ON ve.id = vj.vehiculo_id
         GROUP BY UPPER(REPLACE(REPLACE(ve.placa,' ',''),'-',''))
       ) t ON UPPER(REPLACE(REPLACE(v.placa,' ',''),'-','')) = t.placa_n
       SET v.km_actual = GREATEST(COALESCE(v.km_actual, 0), COALESCE(t.max_km, 0))
       ${
         empresaId
           ? `WHERE v.empresa_id = ? OR EXISTS (
                SELECT 1 FROM flota_vehiculo_acceso a
                WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
              )`
           : ""
       }`,
      empresaId ? [empresaId, empresaId] : [],
    ).catch(() => undefined);

    await execute(
      `UPDATE flota_vehiculos v
       INNER JOIN (
         SELECT vehiculo_id, MAX(km) AS max_km
         FROM flota_lecturas
         GROUP BY vehiculo_id
       ) l ON l.vehiculo_id = v.id
       SET v.km_actual = GREATEST(COALESCE(v.km_actual, 0), COALESCE(l.max_km, 0))
       ${
         empresaId
           ? `WHERE v.empresa_id = ? OR EXISTS (
                SELECT 1 FROM flota_vehiculo_acceso a
                WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
              )`
           : ""
       }`,
      empresaId ? [empresaId, empresaId] : [],
    ).catch(() => undefined);
  } catch {
    /* ok */
  }
}

export async function kmHistorialVehiculo(
  vehiculoId: number,
): Promise<number> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(km_llegada) FROM flota_viajes WHERE vehiculo_id = ? AND km_llegada IS NOT NULL), 0),
         COALESCE((SELECT MAX(km_salida) FROM flota_viajes WHERE vehiculo_id = ?), 0),
         COALESCE((SELECT MAX(km) FROM flota_lecturas WHERE vehiculo_id = ?), 0),
         COALESCE((SELECT km_actual FROM flota_vehiculos WHERE id = ?), 0)
       ) AS km`,
      [vehiculoId, vehiculoId, vehiculoId, vehiculoId],
    );
    return Number(rows[0]?.km ?? 0);
  } catch {
    return 0;
  }
}
