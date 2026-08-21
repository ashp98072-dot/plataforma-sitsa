import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { vehiculoPorPlaca } from "@/lib/flota/pilotos";

/**
 * Fase A4 del plan Programación SITSA: resuelve el vehículo real de Flota
 * para una unidad de TMS, priorizando el vínculo estructural creado en
 * Fase A1/A3 (tms_unidades.flota_vehiculo_id) y cayendo al comportamiento
 * actual por placa cuando no hay vínculo o el vínculo no es accesible.
 *
 * Tener flota_vehiculo_id NUNCA autoriza acceso por sí mismo: siempre se
 * verifica con obtenerVehiculoAccesible (propio o compartido vía
 * flota_vehiculo_acceso). Si esa verificación no confirma acceso, se
 * descarta el ID y se cae al fallback por placa — nunca se devuelve un
 * vehículo de otra empresa solo porque el ID estaba guardado.
 */
export type VehiculoResueltoTms = {
  vehiculo: RowDataPacket;
  origen: "id" | "placa";
};

export async function resolverVehiculoDeUnidadTms(
  empresaId: number,
  unidadId: number,
): Promise<VehiculoResueltoTms | null> {
  if (!empresaId || !unidadId) return null;

  // tms_unidades es propia de cada empresa (UNIQUE empresa_id+placa), así
  // que este filtro ya excluye por completo unidades de otras empresas.
  const rows = await query<RowDataPacket[]>(
    `SELECT placa, flota_vehiculo_id FROM tms_unidades
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [unidadId, empresaId],
  );
  const unidad = rows[0];
  if (!unidad) return null;

  const flotaVehiculoId = unidad.flota_vehiculo_id;
  if (flotaVehiculoId != null) {
    const veh = await obtenerVehiculoAccesible(
      empresaId,
      Number(flotaVehiculoId),
    );
    if (veh) {
      return { vehiculo: veh, origen: "id" };
    }
    // ID vinculado pero sin acceso real confirmado (dato inconsistente) ->
    // no se devuelve ese vehículo; se sigue al fallback por placa.
  }

  const placa = unidad.placa ? String(unidad.placa) : "";
  if (!placa) return null;
  const porPlaca = await vehiculoPorPlaca(empresaId, placa);
  return porPlaca ? { vehiculo: porPlaca, origen: "placa" } : null;
}
