import { normalizarNombreReportado } from "./pilotos-nombres";

/** Clasificación conservadora: cualquier identidad externa o reportada requiere revisión individual. */
export function clasificarIdentificacion(
  consumo: { piloto_informado: unknown; empleado_id: unknown; piloto_externo_id?: unknown; asociacion_externa_id?: unknown; identidad_externa?: unknown; piloto_reportado_id?: unknown },
  nombre: string,
  empleadoId: number,
): "AJENO" | "PENDIENTE" | "IDENTIFICADO" | "CONFLICTO" {
  const clave = normalizarNombreReportado(nombre);
  if (!clave || normalizarNombreReportado(String(consumo.piloto_informado ?? "")) !== clave) return "AJENO";
  if (consumo.piloto_externo_id != null || consumo.asociacion_externa_id != null || consumo.identidad_externa != null || consumo.piloto_reportado_id != null) return "CONFLICTO";
  if (consumo.empleado_id == null) return "PENDIENTE";
  return Number(consumo.empleado_id) === empleadoId ? "IDENTIFICADO" : "CONFLICTO";
}
