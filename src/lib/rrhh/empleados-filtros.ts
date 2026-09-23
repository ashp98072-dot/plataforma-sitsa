import { FORMAS_PAGO, TIPOS_CONTRATO } from "./contratos-pago";

/**
 * RRHH-EMPLEADOS-EXPORT-FILTROS-1 — filtros de RRHH > Empleados, en UN solo lugar
 * para que el listado en pantalla (GET /empleados) y las exportaciones
 * Excel/PDF (GET /empleados/export) nunca diverjan.
 *
 *  - Cliente: `construirParamsEmpleados` arma la query del listado y la de los
 *    enlaces de exportación (sin parámetros vacíos; "Todos" = sin `estado`).
 *  - Servidor: `parsearFiltrosEmpleados` valida contra los catálogos existentes
 *    (TIPOS_CONTRATO / FORMAS_PAGO) y solo admite estado Activo | Baja | ausente,
 *    de modo que ningún valor arbitrario llega al SQL.
 * La empresa NUNCA es un filtro: siempre sale de la sesión.
 */
export type FiltrosEmpleados = {
  q?: string;
  tipoContrato?: string;
  formaPago?: string;
  estado?: string;
};

export const ESTADOS_EMPLEADO_FILTRO = ["Activo", "Baja"] as const;

/** Query sin parámetros vacíos (q recortada). `estado` vacío = Todos: no se envía. */
export function construirParamsEmpleados(f: FiltrosEmpleados): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q?.trim()) p.set("q", f.q.trim());
  if (f.tipoContrato) p.set("tipoContrato", f.tipoContrato);
  if (f.formaPago) p.set("formaPago", f.formaPago);
  if (f.estado) p.set("estado", f.estado);
  return p;
}

/** Ruta de exportación (`format` va primero) con los MISMOS filtros que el listado. */
export function hrefExportEmpleados(slug: string, format: "xlsx" | "pdf", f: FiltrosEmpleados): string {
  const p = new URLSearchParams({ format });
  for (const [k, v] of construirParamsEmpleados(f)) p.set(k, v);
  return `/api/empresas/${slug}/empleados/export?${p.toString()}`;
}

export type ResultadoFiltrosEmpleados =
  | { ok: true; filtros: { q: string; tipoContrato?: string; formaPago?: string; estado?: "Activo" | "Baja" } }
  | { ok: false; error: string };

/** Valida los filtros recibidos por query string (servidor). Valores vacíos = sin filtro. */
export function parsearFiltrosEmpleados(sp: URLSearchParams): ResultadoFiltrosEmpleados {
  const q = (sp.get("q") ?? "").trim();

  const estadoRaw = (sp.get("estado") ?? "").trim();
  if (estadoRaw && !(ESTADOS_EMPLEADO_FILTRO as readonly string[]).includes(estadoRaw)) {
    return { ok: false, error: "Estado inválido." };
  }

  const tipoRaw = (sp.get("tipoContrato") ?? "").trim();
  if (tipoRaw && !TIPOS_CONTRATO.some((t) => t.value === tipoRaw.toLowerCase())) {
    return { ok: false, error: "Tipo de contrato inválido." };
  }

  const pagoRaw = (sp.get("formaPago") ?? "").trim();
  if (pagoRaw && !FORMAS_PAGO.some((f) => f.value === pagoRaw.toLowerCase())) {
    return { ok: false, error: "Forma de pago inválida." };
  }

  return {
    ok: true,
    filtros: {
      q,
      tipoContrato: tipoRaw ? tipoRaw.toLowerCase() : undefined,
      formaPago: pagoRaw ? pagoRaw.toLowerCase() : undefined,
      estado: estadoRaw ? (estadoRaw as "Activo" | "Baja") : undefined,
    },
  };
}
