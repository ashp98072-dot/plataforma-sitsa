/**
 * Detección ÚNICA de columnas que referencian un vehículo, compartida por el inventario de referencias de la fusión
 * (vehiculos-duplicados.ts) y el historial de unidad canónica (unidad-canonica.ts).
 *
 * Convención por nombre (`vehiculo_id`, `*_vehiculo_id`, `unidad_recurrente_id`) O clave foránea real a flota_vehiculos(id).
 * Una columna con nombre parecido pero con clave foránea hacia OTRA tabla NO es un vehículo (p. ej.
 * `tms_planes_viaje.vehiculo_solicitado_perfil_id` apunta a un perfil de costeo): sin esta exclusión su valor numérico se comparaba
 * contra IDs de vehículos y producía referencias (y bloqueos) falsos.
 */
export const SQL_FK_A_OTRAS_TABLAS =
  "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL AND REFERENCED_TABLE_NAME<>'flota_vehiculos'";

type ColumnaFk = Record<string, unknown>;

export function esColumnaDeVehiculo(tabla: string, campo: string, fkAVehiculos: ColumnaFk[], fkAOtras: ColumnaFk[]): boolean {
  if (fkAVehiculos.some((f) => f.TABLE_NAME === tabla && f.COLUMN_NAME === campo)) return true;
  if (fkAOtras.some((f) => f.TABLE_NAME === tabla && f.COLUMN_NAME === campo)) return false;
  return /(^|_)vehiculo(_.*)?_id$/.test(campo) || campo === "vehiculo_id" || campo === "unidad_recurrente_id";
}
