import { createHash } from "node:crypto";
import { z } from "zod";
import { ROLES_CONTABLES } from "./cuentas-rol";

const id = z.number().int().positive().max(2147483647);
const codigo = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/);
const importe = z.string().regex(/^\d{1,12}\.\d{2}$/);
/** Contrato cerrado: no admite texto libre, secretos, rutas ni números bancarios. */
export const snapshotContableSchema = z.object({
  version: z.literal(1),
  versionCalculo: codigo,
  origen: z.object({ tipo: codigo, id }).strict(),
  cuentas: z.array(z.object({ cuentaId: id, rol: z.enum(ROLES_CONTABLES) }).strict()).max(500),
  importes: z.array(z.object({ concepto: codigo, monto: importe }).strict()).max(500),
  impuestos: z.array(z.object({ concepto: codigo, monto: importe }).strict()).max(100),
}).strict();
export type SnapshotContable = z.infer<typeof snapshotContableSchema>;
export function crearSnapshotContable(input: unknown): SnapshotContable { return snapshotContableSchema.parse(input); }

/** Orden de claves canónico; el orden de arrays sigue siendo funcional. Solo datos JSON validados. */
export function serializarCanonico(input: unknown): string {
  if (input === null || typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
  if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(serializarCanonico).join(",")}]`;
  if (typeof input === "object" && input && Object.getPrototypeOf(input) === Object.prototype) {
    return `{${Object.keys(input).sort().map(k => `${JSON.stringify(k)}:${serializarCanonico((input as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  throw new TypeError("Solo se admiten valores JSON canónicos.");
}
export function huellaContable(input: unknown): string {
  return createHash("sha256").update(serializarCanonico({ version: 1, contenido: input })).digest("hex");
}
export const TIPOS_EVENTO = ["FACTURA_EMITIDA", "COBRO_CONFIRMADO", "RETENCION_NO_EMITIDA"] as const;
export type TipoEvento = typeof TIPOS_EVENTO[number];
export function claveEventoContable(tipo: TipoEvento, origenId: number): string {
  z.enum(TIPOS_EVENTO).parse(tipo); id.parse(origenId);
  return `${tipo}:${origenId}`;
}
