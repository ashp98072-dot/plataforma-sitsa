import type { FacturaExistente } from "./factura-compra";

/**
 * COMPRAS — validación de factura duplicada en el FORMULARIO (lógica pura). Es solo UX: el servidor vuelve a validar al guardar.
 * Se consulta con debounce, solo con proveedor seleccionado y número no vacío (la serie puede ir vacía).
 */
export const DEBOUNCE_FACTURA_MS = 400;

export type EstadoFactura = "sin_validar" | "validando" | "disponible" | "duplicada" | "error";
export type VerificacionFactura = { clave: string; estado: EstadoFactura; factura?: FacturaExistente };

export type LineaFacturaForm = { id?: number; proveedor_id: number; serie_factura?: string | null; numero_factura?: string | null };

export const debeConsultarFactura = (l: LineaFacturaForm) => l.proveedor_id > 0 && (l.numero_factura ?? "").trim() !== "";

/** Clave de una consulta: si cambia proveedor, serie, número o la línea, el resultado anterior deja de valer. */
export const claveConsultaFactura = (l: LineaFacturaForm) => `${l.proveedor_id}\u0001${l.serie_factura ?? ""}\u0001${l.numero_factura ?? ""}\u0001${l.id ?? 0}`;

export const urlVerificarFactura = (slug: string, l: LineaFacturaForm) => {
  const p = new URLSearchParams({ proveedorId: String(l.proveedor_id), serie: l.serie_factura ?? "", numero: l.numero_factura ?? "" });
  if (l.id) p.set("lineaId", String(l.id)); // excluye SOLO la propia línea
  return `/api/empresas/${slug}/compras/requerimientos/facturas/verificar?${p.toString()}`;
};

export const urlVerRequerimiento = (slug: string, requerimientoId: number) => `/e/${slug}/compras/requerimientos/${requerimientoId}`;

type FetchFn = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
export type ResultadoConsulta = { tipo: "ok"; existe: boolean; factura?: FacturaExistente } | { tipo: "error" };

export async function consultarFactura(fetchFn: FetchFn, slug: string, l: LineaFacturaForm): Promise<ResultadoConsulta> {
  try {
    const res = await fetchFn(urlVerificarFactura(slug, l), { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { existe?: boolean; factura?: FacturaExistente };
    if (!res.ok || typeof data.existe !== "boolean") return { tipo: "error" };
    return { tipo: "ok", existe: data.existe, factura: data.factura };
  } catch { return { tipo: "error" }; }
}

export const estadoDeConsulta = (r: ResultadoConsulta): EstadoFactura => (r.tipo === "error" ? "error" : r.existe ? "duplicada" : "disponible");

/** Guardar se deshabilita con duplicado interno o con una factura ya registrada (confirmada por la consulta). El servidor decide igual. */
export const bloqueaGuardarPorFactura = (repetidasInternas: ReadonlySet<number>, verificaciones: Record<string, VerificacionFactura>) =>
  repetidasInternas.size > 0 || Object.values(verificaciones).some((v) => v.estado === "duplicada");
