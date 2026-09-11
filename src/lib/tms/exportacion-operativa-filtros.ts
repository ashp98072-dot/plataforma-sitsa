import { rangoDelMes } from "@/lib/tms/reportes-mes";

export type FiltrosGastosOperativos = {
  fechaDesde: string; fechaHasta: string; mes: string; anio: string;
  categoria: string; empleadoId: string; vehiculoId: string; clienteId: string;
};

export type FiltrosFondosOperativos = {
  fechaDesde: string; fechaHasta: string; mes: string; anio: string;
  estado: string; requirenteUsuarioId: string;
};

function rango(f: { fechaDesde: string; fechaHasta: string; mes: string; anio: string }) {
  return f.mes && f.anio
    ? rangoDelMes(Number(f.anio), Number(f.mes))
    : { desde: f.fechaDesde, hasta: f.fechaHasta };
}

export function paramsListadoGastos(f: FiltrosGastosOperativos): URLSearchParams {
  const p = new URLSearchParams();
  const fechas = rango(f);
  if (fechas.desde) p.set("fechaDesde", fechas.desde);
  if (fechas.hasta) p.set("fechaHasta", fechas.hasta);
  if (f.categoria) p.set("categoria", f.categoria);
  if (f.empleadoId) p.set("empleadoId", f.empleadoId);
  if (f.vehiculoId) p.set("vehiculoId", f.vehiculoId);
  if (f.clienteId) p.set("clienteId", f.clienteId);
  return p;
}

export function paramsExportarGastos(f: FiltrosGastosOperativos, formato?: "pdf"): URLSearchParams {
  const p = paramsListadoGastos(f);
  p.set("tipo", "gastosDetalle");
  if (formato) p.set("formato", formato);
  return p;
}

export function paramsListadoFondos(f: FiltrosFondosOperativos): URLSearchParams {
  const p = new URLSearchParams();
  const fechas = rango(f);
  if (fechas.desde) p.set("fechaDesde", fechas.desde);
  if (fechas.hasta) p.set("fechaHasta", fechas.hasta);
  if (f.estado) p.set("estado", f.estado);
  // REPORTES-FONDOS-PDF-TABULAR-1 — el listado en pantalla ahora respeta
  // el mismo filtro Requirente que ya aplicaban las exportaciones (antes
  // se perdía aquí y la pantalla lo simulaba filtrando en el cliente).
  if (f.requirenteUsuarioId) p.set("requirenteUsuarioId", f.requirenteUsuarioId);
  return p;
}

/**
 * REPORTES-FONDOS-PDF-TABULAR-1 — `variante` distingue los dos PDF de
 * fondos sobre el MISMO endpoint/filtro, sin tocar el comportamiento por
 * defecto:
 *  - sin `variante` (u otro valor): PDF MENSUAL CONSOLIDADO existente,
 *    con firmas — exige mes calendario completo (sin cambios).
 *  - `variante: "tabular"`: reporte PDF tabular nuevo, compacto, con
 *    cualquier filtro (igual que el Excel) — sin firmas ni RESUMEN DEL MES.
 */
export function paramsExportarFondos(f: FiltrosFondosOperativos, formato?: "pdf", variante?: "tabular"): URLSearchParams {
  const p = new URLSearchParams({ tipo: "fondos" });
  const fechas = rango(f);
  if (fechas.desde) p.set("fechaSolicitudDesde", fechas.desde);
  if (fechas.hasta) p.set("fechaSolicitudHasta", fechas.hasta);
  if (f.estado) p.set("estadoFondo", f.estado);
  if (f.requirenteUsuarioId) p.set("requirenteUsuarioId", f.requirenteUsuarioId);
  if (formato) p.set("formato", formato);
  if (variante) p.set("variante", variante);
  return p;
}
