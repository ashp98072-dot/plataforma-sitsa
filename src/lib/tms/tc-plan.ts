import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { esTc } from "@/lib/flota/tipo-unidad";

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — resolución/validación SERVER-SIDE del TC
 * INTERNO de un viaje Propio (tms_planes_viaje.tc_vehiculo_id ->
 * flota_vehiculos.id). Nunca se confía en el id que manda el cliente:
 *   - debe ser un vehículo propio o compartido con ESTA empresa
 *     (obtenerVehiculoAccesible, el mismo criterio que la Unidad);
 *   - debe estar clasificado como TC (flota_vehiculos.tipo_unidad) — el TC
 *     jamás se infiere de placa/marca/modelo/descripción;
 *   - no puede estar inactivo ni en taller.
 * La disponibilidad por fecha (mismo TC, mismo día) NO se decide aquí: la
 * resuelve primerConflictoProgramacionDia bajo el candado por empresa.
 */
export type ResultadoTcInterno =
  | { ok: true; vehiculoId: number; placa: string }
  | { ok: false; error: string; status: 400 | 409 };

export async function resolverTcInterno(empresaId: number, tcVehiculoId: number): Promise<ResultadoTcInterno> {
  const v = await obtenerVehiculoAccesible(empresaId, tcVehiculoId, "v.id, v.placa, v.activo, v.en_taller, v.tipo_unidad");
  if (!v) {
    return { ok: false, status: 400, error: "El TC seleccionado no existe o no es accesible para esta empresa." };
  }
  const placa = String(v.placa ?? "").toUpperCase();
  if (!esTc(v.tipo_unidad)) {
    return { ok: false, status: 400, error: `El vehículo ${placa} no está clasificado como TC.` };
  }
  if (Number(v.activo ?? 1) === 0) {
    return { ok: false, status: 409, error: `El TC ${placa} está inactivo.` };
  }
  if (Number(v.en_taller ?? 0) === 1) {
    return { ok: false, status: 409, error: `El TC ${placa} está actualmente en taller.` };
  }
  return { ok: true, vehiculoId: Number(v.id), placa };
}
