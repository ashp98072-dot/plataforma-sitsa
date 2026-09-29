/**
 * ATRACCION-TALENTO-1 (corrección post-revisión) — lógica PURA (sin React)
 * de qué filtros mandar al GET /rrhh/entrevistas/reportes, extraída de
 * src/app/e/[slug]/atraccion-talento/reportes/page.tsx para poder probarla
 * sin renderizar el componente. entrevistadorId = 0 significa "Todos" y no
 * se manda como parámetro.
 */
export type FiltrosReporte = {
  fechaDesde: string;
  fechaHasta: string;
  puesto: string;
  estado: string;
  resultado: string;
  entrevistadorId: number;
};

export function construirParamsReporte(f: FiltrosReporte): URLSearchParams {
  const params = new URLSearchParams();
  if (f.fechaDesde) params.set("fechaDesde", f.fechaDesde);
  if (f.fechaHasta) params.set("fechaHasta", f.fechaHasta);
  if (f.puesto.trim()) params.set("puesto", f.puesto.trim());
  if (f.estado) params.set("estado", f.estado);
  if (f.resultado) params.set("resultado", f.resultado);
  if (f.entrevistadorId) params.set("entrevistadorEmpleadoId", String(f.entrevistadorId));
  return params;
}
