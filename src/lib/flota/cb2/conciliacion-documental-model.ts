import DecimalJS from "decimal.js";
export const DecimalDocumental = DecimalJS.clone({ precision: 48, rounding: DecimalJS.ROUND_HALF_UP });
export const TOLERANCIA_DOCUMENTAL = "0.01";
export const estadosDocumentales = ["SIN_TOTAL_DOCUMENTAL", "SIN_CONSUMOS", "CUADRADA", "CON_DIFERENCIA"] as const;
export type EstadoDocumental = typeof estadosDocumentales[number];
export function balanceDocumental(total: string | null, cantidad: number, monto: string, galones: string) {
    const suma = new DecimalDocumental(monto), diferencia = total === null ? null : new DecimalDocumental(total).minus(suma);
    const estado: EstadoDocumental = total === null ? "SIN_TOTAL_DOCUMENTAL" : cantidad === 0 ? "SIN_CONSUMOS"
        : diferencia!.abs().lte(TOLERANCIA_DOCUMENTAL) ? "CUADRADA" : "CON_DIFERENCIA";
    return { estado, diferencia: diferencia?.toFixed() ?? null, montoConsumos: suma.toFixed(), galones: new DecimalDocumental(galones).toFixed() };
}
export type FacturaDocumental = ReturnType<typeof balanceDocumental> & {
    id: number; proveedorId: number; proveedor: string; serie: string; numero: string;
    fecha: string | null; moneda: string; totalDocumental: string | null; cantidad: number;
};
export type ConsumoDocumental = { id: number; importacionId: number; vale: string; placa: string; fecha: string; moneda: string; galones: string; monto: string };
export type PaginaDocumental<T> = { filas: T[]; siguiente: number | null };
