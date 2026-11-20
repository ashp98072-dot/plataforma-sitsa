/**
 * Traduce el rechazo de la base al intentar ELIMINAR definitivamente un vehículo que todavía tiene registros que lo referencian
 * (clave foránea con ON DELETE RESTRICT, errno 1451), en lugar del 500 genérico. No cambia reglas: el borrado sigue bloqueado.
 * Solo se nombra el tipo de registro (nunca el esquema, el ID ni datos de otra empresa).
 */
const POR_TABLA: Record<string, string> = {
  tms_solicitud_fondo_lineas: "líneas de solicitudes de fondos",
  tms_gastos_operativos: "gastos operativos",
  compras_requerimiento_lineas: "líneas de requerimientos de compra",
  tms_planes_viaje: "planes de viaje",
  tms_unidades: "una unidad TMS vinculada",
  flota_cb2_consumos: "consumos de combustible",
  flota_cb2_asignaciones: "asignaciones de combustible",
  flota_combustible_cargas: "cargas de combustible",
  flota_identidad_miembros: "una identidad física",
  flota_vehiculos_fusiones: "una fusión registrada",
  ops_multas: "multas",
  ops_multas_revisiones: "revisiones de multas",
};

export function errorEliminacionVehiculo(error: unknown): { status: 409; error: string } | null {
  const e = error as { errno?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || (e.errno !== 1451 && e.code !== "ER_ROW_IS_REFERENCED_2" && e.code !== "ER_ROW_IS_REFERENCED")) return null;
  const tabla = /fails \(`[^`]+`\.`([^`]+)`/.exec(String(e.message ?? ""))?.[1] ?? "";
  const que = POR_TABLA[tabla] ?? "otros registros";
  return {
    status: 409,
    error: `No se puede eliminar: esta unidad tiene ${que} asociados. Usa «Dar de baja» para conservar el historial. Si es la misma unidad física que otra ficha, vincúlalas desde Identidades físicas; no se eliminan ni se fusionan registros.`,
  };
}
