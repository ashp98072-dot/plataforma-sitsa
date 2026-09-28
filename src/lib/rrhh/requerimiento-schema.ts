import { z } from "zod";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — requerimientos de RRHH (uniformes, exámenes médicos, capacitaciones, papelería,
 * servicios profesionales, etc.). Mismo patrón de schema/centavos que src/lib/compras/requerimiento-schema.ts, sin
 * vehículo/factura (específicos de Compras/TMS) y con cantidad × precio_unitario en vez de un total libre por línea.
 */
export const METODOS_PAGO_RRHH = ["Transferencia", "Cheque", "Efectivo", "Crédito"] as const;
export const ESTADOS_RRHH = ["Pendiente", "Autorizada", "Rechazada"] as const;
export const fechaRrhhReq = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.").refine(v => {
  const date = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v && v >= "1000-01-01";
}, "Fecha no válida.");
export const idRrhhReq = z.number().int().positive().max(2147483647);
const texto = (max: number) => z.string().trim().max(max).nullable().optional().transform(v => v || null);

// Centavos enteros: la suma de hasta 500 importes DECIMAL(12,2) sigue siendo segura en JS (igual que Compras).
export function centavosRrhhReq(v: string | number): number {
  const [entero, decimal = ""] = String(v).split(".");
  return Number(entero) * 100 + Number(decimal.padEnd(2, "0"));
}
export function importeRrhhReq(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}
const montoRrhhReq = z.union([z.string(), z.number()]).refine(v => {
  const s = String(v);
  return /^\d{1,10}(\.\d{1,4})?$/.test(s) && Number.isFinite(Number(v)) && Number(v) > 0;
}, "El valor debe ser positivo, con máximo cuatro decimales.");

export const lineaRrhhReqSchema = z.object({
  id: idRrhhReq.optional(),
  proveedor_id: idRrhhReq,
  descripcion: z.string().trim().min(1, "La descripción / concepto es obligatoria.").max(1000),
  cantidad: montoRrhhReq,
  precio_unitario: montoRrhhReq,
  metodo_pago: z.enum(METODOS_PAGO_RRHH),
  condicion_pago: z.enum(["Contado", "Crédito"]),
  observaciones: texto(10000),
}).strict();

const cabecera = {
  fecha_requerimiento: fechaRrhhReq,
  entidad_requirente_id: idRrhhReq,
  requirente_usuario_id: idRrhhReq,
  observaciones: texto(10000),
  lineas: z.array(lineaRrhhReqSchema).min(1, "Agrega al menos una línea.").max(500),
};

function totalCentavos(lineas: { cantidad: string | number; precio_unitario: string | number }[]): number {
  return lineas.reduce((sum, l) => sum + Math.round(centavosRrhhReq(l.cantidad) * centavosRrhhReq(l.precio_unitario) / 100), 0);
}
function validarLineas(datos: { lineas: z.infer<typeof lineaRrhhReqSchema>[] }, ctx: z.RefinementCtx) {
  const ids = datos.lineas.flatMap(l => l.id === undefined ? [] : [l.id]);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["lineas"], message: "Hay IDs de líneas repetidos." });
  if (totalCentavos(datos.lineas) > 999999999999) ctx.addIssue({ code: "custom", path: ["lineas"], message: "El total del requerimiento supera DECIMAL(12,2)." });
}
export const crearRequerimientoRrhhSchema = z.object(cabecera).strict().superRefine((datos, ctx) => {
  validarLineas(datos, ctx);
  if (datos.lineas.some(l => l.id !== undefined)) ctx.addIssue({ code: "custom", path: ["lineas"], message: "Las líneas nuevas no pueden incluir ID." });
});
export const editarRequerimientoRrhhSchema = z.object({ ...cabecera, version: idRrhhReq }).strict().superRefine(validarLineas);

export const cambiarEstadoRequerimientoRrhhSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("autorizar"), version: idRrhhReq }).strict(),
  z.object({
    accion: z.literal("rechazar"),
    version: idRrhhReq,
    motivo: z.string().trim().min(1, "El rechazo requiere un motivo.").max(1000, "El motivo no puede superar 1000 caracteres."),
  }).strict(),
]);
export type CambiarEstadoRequerimientoRrhhDatos = z.infer<typeof cambiarEstadoRequerimientoRrhhSchema>;

export const filtrosRequerimientoRrhhSchema = z.object({
  codigo: z.string().trim().max(40).default(""),
  desde: fechaRrhhReq.optional(),
  hasta: fechaRrhhReq.optional(),
  estado: z.enum(ESTADOS_RRHH).optional(),
  proveedor_id: z.coerce.number().int().positive().max(2147483647).optional(),
  entidad_requirente_id: z.coerce.number().int().positive().max(2147483647).optional(),
}).strict().refine(v => !v.desde || !v.hasta || v.desde <= v.hasta, "El rango de fechas no es válido.");

export type LineaRequerimientoRrhhDatos = z.infer<typeof lineaRrhhReqSchema>;
export type RequerimientoRrhhDatos = z.infer<typeof crearRequerimientoRrhhSchema> & { version?: number };
export type FiltrosRequerimientoRrhh = z.infer<typeof filtrosRequerimientoRrhhSchema>;
export type LineaRequerimientoRrhh = LineaRequerimientoRrhhDatos & {
  id: number; orden?: number;
  proveedor_nombre_snapshot: string; proveedor_razon_social_snapshot: string | null; proveedor_nit_snapshot: string | null;
  banco_snapshot: string | null; numero_cuenta_snapshot: string | null; tipo_cuenta_snapshot: string | null; dias_credito_snapshot: number | null;
  total: string;
};
export type RequerimientoRrhh = {
  id: number; codigo: string; fecha_requerimiento: string;
  entidad_requirente_id: number | null; entidad_requirente_nombre: string | null;
  requirente_usuario_id: number | null; requirente_nombre: string | null;
  solicitante_usuario_id: number | null; solicitante_nombre: string | null;
  observaciones: string | null; total: string; estado: typeof ESTADOS_RRHH[number]; version: number; cantidad_lineas: number;
  autorizante_usuario_id: number | null; autorizante_nombre: string | null;
  autorizado_en: string | null; rechazado_en: string | null; motivo_rechazo: string | null;
};
export type DetalleRequerimientoRrhh = RequerimientoRrhh & { lineas: LineaRequerimientoRrhh[] };
