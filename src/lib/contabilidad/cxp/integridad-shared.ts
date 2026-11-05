import type { AdvertenciaIntegridad, CodigoAdvertencia } from "./estado-cuenta-shared";
import type { EstadoAdminCxp } from "./saldo";

export const CODIGOS_INTEGRIDAD = ["SOBREAPLICACION", "PAGO_VIGENTE_EN_ANULADA", "PAGO_DE_OTRO_PROVEEDOR", "PAGO_DESCUADRADO", "PAGADO_NO_COINCIDE_CON_LINEAS"] as const satisfies readonly CodigoAdvertencia[];
export const CODIGOS_SOLO_PAGOS: readonly CodigoAdvertencia[] = ["PAGO_DE_OTRO_PROVEEDOR", "PAGO_DESCUADRADO", "PAGADO_NO_COINCIDE_CON_LINEAS"];
export const LIMITE_LINEAS = "PAGADO_NO_COINCIDE_CON_LINEAS no se evalúa en este panel: sin una fuente independiente, comparar dos sumas de las mismas aplicaciones en la misma instantánea no demuestra una discrepancia. El estado de cuenta conserva su comprobación de líneas visibles.";
export const ROTULO_INTEGRIDAD = "Integridad de documentos registrados en Novalvion. Lectura actual, sin correcciones automáticas; no certifica equivalencia completa con Milenium ni incluye necesariamente documentos pendientes de migración.";
export type FiltrosIntegridad = { proveedorId?: number; codigo?: CodigoAdvertencia; estado?: EstadoAdminCxp; page?: number; pageSize?: number };
export type FilaIntegridad = {
  entidadId: number; facturaId: number | null; proveedorId: number; proveedor: string; documento: string | null;
  estadoAdmin: EstadoAdminCxp | null; montoPagadero: string | null; pagado: string | null; excesoAplicado: string | null;
  advertencia: AdvertenciaIntegridad;
  /** Exclusivo de permiso Pagos. Un descuadre sin factura individual se representa por pago, no se reparte entre documentos. */
  pago?: { id: number; estado: "REGISTRADO" | "REVERSADO"; montoTotal: string | null; sumaAplicaciones: string | null; montoAplicado: string | null };
};
export type RespuestaIntegridad = {
  entidadId: number; filtros: FiltrosIntegridad; facturasEnAmbito: number; facturasRevisadas: number;
  totalAdvertencias: number; facturasConAnomalias: number; porCodigo: Partial<Record<CodigoAdvertencia, number>>;
  filas: FilaIntegridad[]; page: number; pageSize: number; pagosVisibles: boolean; pagosDisponibles: boolean;
  limitaciones: string[]; rotulo: string;
};

/** Estricto: ausente es opcional, vacío/repetido/desconocido es error; nunca convierte entrada inválida en «todos». */
export function filtrosIntegridadDesdeParams(params: URLSearchParams): { ok: true; filtros: FiltrosIntegridad } | { ok: false; error: string } {
  const allowed = ["entidad", "proveedorId", "codigo", "estado", "page", "pageSize"];
  const f: FiltrosIntegridad = {};
  for (const [key] of params) if (!allowed.includes(key)) return { ok: false, error: `Parámetro no admitido: ${key}.` };
  for (const key of allowed) {
    const values = params.getAll(key);
    if (!values.length) continue;
    if (values.length !== 1 || values[0] === "" || values[0] !== values[0].trim()) return { ok: false, error: `Parámetro inválido o repetido: ${key}.` };
    const v = values[0];
    if (["entidad", "proveedorId", "page", "pageSize"].includes(key)) {
      const max = key === "pageSize" ? 100 : key === "page" ? 1_000_000 : 2_147_483_647;
      if (!/^[1-9]\d{0,9}$/.test(v) || Number(v) > max) return { ok: false, error: `Entero fuera de rango: ${key}.` };
      if (key !== "entidad") f[key as "proveedorId" | "page" | "pageSize"] = Number(v);
    } else if (key === "codigo") {
      if (!CODIGOS_INTEGRIDAD.includes(v as CodigoAdvertencia)) return { ok: false, error: "Tipo de anomalía inválido." };
      f.codigo = v as CodigoAdvertencia;
    } else if (key === "estado") {
      if (v !== "REGISTRADA" && v !== "ANULADA") return { ok: false, error: "Estado administrativo inválido." };
      f.estado = v;
    }
  }
  return { ok: true, filtros: f };
}
