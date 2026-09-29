/**
 * ATRACCION-TALENTO-1/2 — lógica PURA (sin React) de qué filtros mandar al
 * GET /rrhh/entrevistas/reportes, extraída de
 * src/app/e/[slug]/atraccion-talento/reportes/page.tsx para poder probarla
 * sin renderizar el componente. entrevistadorUsuarioId = 0 significa "Todos"
 * y no se manda como parámetro (ATRACCION-TALENTO-2: el filtro ahora es por
 * usuario, no por empleado — los históricos siguen apareciendo cuando el
 * filtro está en "Todos", ver entrevistas-reportes.ts).
 */
export type FiltrosReporte = {
  fechaDesde: string;
  fechaHasta: string;
  puesto: string;
  estado: string;
  resultado: string;
  entrevistadorUsuarioId: number;
};

export function construirParamsReporte(f: FiltrosReporte): URLSearchParams {
  const params = new URLSearchParams();
  if (f.fechaDesde) params.set("fechaDesde", f.fechaDesde);
  if (f.fechaHasta) params.set("fechaHasta", f.fechaHasta);
  if (f.puesto.trim()) params.set("puesto", f.puesto.trim());
  if (f.estado) params.set("estado", f.estado);
  if (f.resultado) params.set("resultado", f.resultado);
  if (f.entrevistadorUsuarioId) params.set("entrevistadorUsuarioId", String(f.entrevistadorUsuarioId));
  return params;
}
