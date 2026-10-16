import Decimal from "decimal.js";
import { z } from "zod";
import { esFechaCalendarioValida } from "./combustible-form-ui";

const id = z.coerce.number().int().positive();
const decimal = (escala: number, maximo: string) => z.string().trim().regex(/^\d+(?:\.\d+)?$/, "Importe inválido.")
  .refine(v => { try { const n = new Decimal(v); return n.gt(0) && n.lte(maximo) && n.decimalPlaces() <= escala; } catch { return false; } }, "Valor fuera de rango o precisión.");
export const combustibleStaffSchema = z.object({
  proveedorId: id,
  estacionId: z.preprocess(v => v === "" || v == null ? null : v, id.nullable()).optional(),
  vehiculoId: id,
  solicitudFondoLineaId: z.preprocess(v => v === "" || v === null ? null : v, id.nullable()).optional(),
  viajeId: z.preprocess(v => v === "" || v == null ? null : v, id.nullable()).optional(),
  numeroVale: z.string().trim().min(1, "Indica el número de vale.").max(40),
  fechaConsumo: z.string().refine(esFechaCalendarioValida, "Fecha de consumo inválida."),
  tipoCombustible: z.enum(["diesel", "gasolina"]),
  galones: decimal(3, "999999999.999"),
  monto: decimal(2, "99999999.99"),
  km: z.preprocess(v => v === "" || v == null ? null : v, z.coerce.number().int().min(0).max(2147483647).nullable()),
  gasolinera: z.string().trim().max(150).default(""),
  observaciones: z.string().trim().max(1000).default(""),
}).superRefine((v, ctx) => {
  if (/^\d+(?:\.\d+)?$/.test(v.monto) && /^\d+(?:\.\d+)?$/.test(v.galones) && new Decimal(v.galones).gt(0) && new Decimal(v.monto).div(v.galones).toDecimalPlaces(2).gt("99999999.99")) {
    ctx.addIssue({ code: "custom", path: ["monto"], message: "Precio por galón fuera de rango." });
  }
});
export type CombustibleStaffInput = z.infer<typeof combustibleStaffSchema>;
export const precioCalculado = (monto: string, galones: string) => new Decimal(monto).div(galones).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
