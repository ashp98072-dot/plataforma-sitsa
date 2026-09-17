import { z } from "zod";

export { METODOS_PAGO_COMPRAS } from "./metodos-pago";
export const ESTADOS_COMPRAS = ["Pendiente", "Autorizada", "Rechazada"] as const;
export const fechaCompra = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.").refine(v => {
  const date = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v && v >= "1000-01-01";
}, "Fecha no válida.");
export const idCompra = z.number().int().positive().max(2147483647);
const texto = (max: number) => z.string().trim().max(max).nullable().optional().transform(v => v || null);
// Centavos enteros: la suma de hasta 500 importes DECIMAL(12,2) sigue siendo segura en JS.
export function centavosCompra(v: string | number): number {
  const [entero, decimal = ""] = String(v).split(".");
  return Number(entero) * 100 + Number(decimal.padEnd(2, "0"));
}
export function importeCompra(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}
export const montoCompra = z.union([z.string(), z.number()]).refine(v => {
  const s = String(v);
  return /^\d{1,10}(\.\d{1,2})?$/.test(s) && Number.isFinite(Number(v)) && centavosCompra(v) > 0 && centavosCompra(v) <= 999999999999;
}, "El total debe ser positivo, con máximo dos decimales y compatible con DECIMAL(12,2).")
  .transform(v => importeCompra(centavosCompra(v)));
export const lineaCompraSchema = z.object({
  id: idCompra.optional(), vehiculo_id: idCompra.nullable().optional().transform(v => v ?? null),
  unidad_descripcion: texto(200), fecha: fechaCompra, serie_factura: texto(100), numero_factura: texto(100),
  proveedor_id: idCompra, repuesto_descripcion: z.string().trim().min(1, "El repuesto es obligatorio.").max(1000),
  metodo_pago: z.string().trim().min(1, "El método de pago es obligatorio.").max(80).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "El método de pago contiene caracteres no permitidos."), condicion_pago: z.enum(["Contado", "Crédito"]),
  total: montoCompra, observaciones: texto(10000),
}).strict();
const cabecera = {
  fecha_requerimiento: fechaCompra, entidad_requirente_id: idCompra, requirente_usuario_id: idCompra,
  encargado_compras_usuario_id: idCompra.nullable().optional(),
  observaciones: texto(10000), lineas: z.array(lineaCompraSchema).min(1, "Agrega al menos una línea.").max(500),
};
function validarLineas(datos: { lineas: z.infer<typeof lineaCompraSchema>[] }, ctx: z.RefinementCtx) {
  const ids = datos.lineas.flatMap(l => l.id === undefined ? [] : [l.id]);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["lineas"], message: "Hay IDs de líneas repetidos." });
  if (datos.lineas.reduce((sum, l) => sum + centavosCompra(l.total), 0) > 999999999999) ctx.addIssue({ code: "custom", path: ["lineas"], message: "El total del requerimiento supera DECIMAL(12,2)." });
}
export const crearRequerimientoSchema = z.object(cabecera).strict().superRefine((datos, ctx) => {
  validarLineas(datos, ctx);
  if (datos.lineas.some(l => l.id !== undefined)) ctx.addIssue({ code: "custom", path: ["lineas"], message: "Las líneas nuevas no pueden incluir ID." });
});
export const editarRequerimientoSchema = z.object({ ...cabecera, requirente_usuario_id: idCompra.nullable(), version: idCompra }).strict().superRefine(validarLineas);
export const filtrosCompraSchema = z.object({
  codigo: z.string().trim().max(40).default(""), desde: fechaCompra.optional(), hasta: fechaCompra.optional(),
  estado: z.enum(ESTADOS_COMPRAS).optional(), proveedor_id: z.coerce.number().int().positive().max(2147483647).optional(),
}).strict().refine(v => !v.desde || !v.hasta || v.desde <= v.hasta, "El rango de fechas no es válido.");
export type LineaCompraDatos = z.infer<typeof lineaCompraSchema>;
export type RequerimientoDatos = Omit<z.infer<typeof crearRequerimientoSchema>, "requirente_usuario_id"> & { requirente_usuario_id: number | null; version?: number };
export type FiltrosCompra = z.infer<typeof filtrosCompraSchema>;
export type LineaCompra = LineaCompraDatos & {
  id: number; proveedor_nombre_snapshot: string; proveedor_razon_social_snapshot: string | null;
  proveedor_nit_snapshot: string | null; banco_snapshot: string | null; numero_cuenta_snapshot: string | null; dias_credito_snapshot: number | null;
};
export type RequerimientoCompra = {
  id: number; codigo: string; fecha_requerimiento: string; entidad_requirente_id: number | null; entidad_requirente_nombre: string | null;
  requirente_usuario_id: number | null; requirente_nombre: string | null; solicitante_usuario_id: number | null; solicitante_nombre: string | null;
  encargado_compras_usuario_id: number | null; encargado_compras_nombre: string | null;
  observaciones: string | null; total: string; estado: typeof ESTADOS_COMPRAS[number]; version: number; cantidad_lineas: number;
};
export type DetalleCompra = RequerimientoCompra & { lineas: LineaCompra[] };
