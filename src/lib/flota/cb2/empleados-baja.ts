/** Empleados de baja en el catálogo de revisión de nombres. Solo lectura: nunca modifica RR. HH. */
export type EmpleadoCatalogo = { id: number; nombre: string; estado?: string; fechaBaja?: string | null; fechaAlta?: string | null };
export type VentanaLaboral = "ACTIVO" | "VALIDA" | "POSTERIOR_A_BAJA" | "ANTERIOR_A_ALTA" | "SIN_FECHA_BAJA" | "SIN_FECHA_CONSUMO";
const iso = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : String(v ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
export const fechaIso = iso;
/** Compara el rango de fechas de consumo con el periodo laboral. Sin fecha de baja confiable → SIN_FECHA_BAJA (confirmación manual, nunca se asume que seguía activo). */
export function ventanaLaboral(e: EmpleadoCatalogo, rango: { min: string | null; max: string | null } | undefined): VentanaLaboral {
    if (e.estado === undefined || e.estado === "Activo") return "ACTIVO";
    const baja = iso(e.fechaBaja), alta = iso(e.fechaAlta);
    if (!baja) return "SIN_FECHA_BAJA";
    if (!rango?.min || !rango.max) return "SIN_FECHA_CONSUMO";
    if (rango.max > baja) return "POSTERIOR_A_BAJA";
    if (alta && rango.min < alta) return "ANTERIOR_A_ALTA";
    return "VALIDA";
}
export const textoVentana: Record<VentanaLaboral, string> = {
    ACTIVO: "", VALIDA: "Los consumos son anteriores o iguales a la fecha de baja.",
    POSTERIOR_A_BAJA: "Hay consumos posteriores a la fecha de baja: revisa que sea la misma persona antes de confirmar.",
    ANTERIOR_A_ALTA: "Hay consumos anteriores a la fecha de alta: revisa antes de confirmar.",
    SIN_FECHA_BAJA: "RR. HH. no tiene fecha de baja confiable: confirma manualmente; no se asume que seguía activo.",
    SIN_FECHA_CONSUMO: "El archivo no trae fechas suficientes para comparar con la baja: confirma manualmente.",
};
export const etiquetaEmpleado = (e: EmpleadoCatalogo) => `${e.nombre} · #${e.id}${e.estado && e.estado !== "Activo" ? ` · ${e.estado}${e.fechaBaja ? ` (${iso(e.fechaBaja)})` : ""}` : ""}`;
