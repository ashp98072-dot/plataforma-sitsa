import { z } from "zod";
import { id, clave, hash, ErrorCB2 } from "./model";
import { DecimalDocumental } from "./conciliacion-documental-model";
export const editarDocumentoSchema = z.object({
    proveedorId: id, revision: z.number().int().min(0).max(2147483646), clave,
    fecha: z.iso.date().optional(),
    total: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/).transform(v => new DecimalDocumental(v).toFixed()).optional(),
    motivo: z.string().trim().min(10).max(1000),
}).strict().refine(v => v.fecha !== undefined || v.total !== undefined, "Indica fecha o total");
export type EdicionDocumento = z.infer<typeof editarDocumentoSchema>;
export type TipoDocumento = "COMPLETAR" | "CORREGIR" | "SIN_CAMBIO";
export type ValoresDocumento = { fecha: string | null; total: string | null };
export type ResultadoDocumento = { facturaId: number; revision: number; moneda: string; valores: ValoresDocumento; tipo: TipoDocumento };
export function cambioDocumento(antes: ValoresDocumento, op: Pick<EdicionDocumento, "fecha" | "total">) {
    const nuevo = { fecha: op.fecha ?? antes.fecha, total: op.total ?? antes.total };
    const fechaCambia = nuevo.fecha !== antes.fecha;
    const totalCambia = nuevo.total === null || antes.total === null ? nuevo.total !== antes.total : !new DecimalDocumental(nuevo.total).eq(antes.total);
    const tipo: TipoDocumento = !fechaCambia && !totalCambia ? "SIN_CAMBIO"
        : (fechaCambia && antes.fecha !== null) || (totalCambia && antes.total !== null) ? "CORREGIR" : "COMPLETAR";
    return { nuevo, tipo };
}
export function huellaDocumento(empresa: number, actor: number, facturaId: number, op: EdicionDocumento) {
    // Orden explícito; ausencia y valor declarado no son intercambiables.
    return hash(JSON.stringify([1, empresa, op.proveedorId, facturaId, actor, op.revision, op.fecha ?? null, op.total ?? null, op.motivo]));
}
export function verificarRecibo(r: { digest: string; usuario_id: number; factura_id: number }, digest: string, actor: number, facturaId: number) {
    if (r.digest !== digest || Number(r.usuario_id) !== actor || Number(r.factura_id) !== facturaId)
        throw new ErrorCB2("Clave documental usada con otra solicitud o actor.", 409);
}
