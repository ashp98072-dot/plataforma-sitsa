import { formatearFechaVisible } from "@/lib/rrhh/dates";

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 — DTO único de filas consumido TANTO por el PDF como por el Excel del
 * comprobante de autorización por período (src/lib/tms/viaticos-comprobante-pdf.ts y
 * viaticos-comprobante-excel.ts) — un solo mapeo, nunca dos independientes que puedan divergir.
 *
 * Discovery previo a este módulo (ver PR): tms_viaticos (fuente de listarViaticosAutorizadosPorPeriodo) y
 * tms_viatico_requerimientos/tms_viatico_requerimiento_lineas (requerimientos manuales) son dos flujos SIN
 * FK entre sí. Por eso este comprobante histórico por período NUNCA incluye "Código de petición", "Persona
 * que requiere" ni "Fecha de solicitud" (no existen para estos registros) ni "No. Cuenta"/"Banco" (expondría
 * dato bancario bajo el permiso `viaticos_comprobantes:ver`, que no lo cubre — el patrón real del repo exige
 * `viaticos_pagar:ver` para eso, ver viaticos-requerimientos-export.ts). "Cantidad" tampoco es una columna
 * real en tms_viaticos: siempre es 1, invariante estructural (UNIQUE KEY plan_id+personal_id — cada fila ya
 * es un único viático asignado a una persona en un viaje).
 */
export type ViaticoComprobanteItem = {
  planCodigo: string;
  fechaPlan: string;
  personalNombre: string;
  rol: string;
  puesto: string;
  unidadPlaca: string | null;
  cliente: string | null;
  lugarDescarga: string | null;
  montoAsignado: number;
};

export type FilaComprobante = {
  viaje: string;
  fechaViaje: string;
  nombre: string;
  cargo: string;
  placa: string;
  cliente: string;
  cantidad: number;
  lugarDescarga: string;
  total: number;
};

/** "Cargo": usa `puesto` (COALESCE(empleados.categoria_ops, tms_personal.tipo) en la consulta real) — ya trae su propio fallback a `rol` cuando no hay dato (ver mapDetalle en viaticos.ts); se repite acá por si el caller es un objeto de prueba sin ese fallback. */
export function filasComprobante(items: ViaticoComprobanteItem[]): FilaComprobante[] {
  return items.map((v) => ({
    viaje: v.planCodigo,
    fechaViaje: formatearFechaVisible(v.fechaPlan),
    nombre: v.personalNombre,
    cargo: v.puesto?.trim() || v.rol,
    placa: v.unidadPlaca ?? "—",
    cliente: v.cliente ?? "—",
    cantidad: 1,
    lugarDescarga: v.lugarDescarga ?? "—",
    total: v.montoAsignado,
  }));
}

export function totalGeneralComprobante(filas: FilaComprobante[]): number {
  return filas.reduce((acc, f) => acc + f.total, 0);
}
