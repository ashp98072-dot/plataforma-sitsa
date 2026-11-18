/** Empleados de baja en el catálogo de revisión de nombres. Solo lectura: nunca modifica RR. HH. */
export type EmpleadoCatalogo = { id: number; nombre: string; estado?: string; fechaBaja?: string | null; fechaAlta?: string | null };
export type VentanaLaboral = "ACTIVO" | "VALIDA" | "POSTERIOR_A_BAJA" | "ANTERIOR_A_ALTA" | "SIN_FECHA_BAJA" | "SIN_FECHA_CONSUMO";
const iso = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : String(v ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
export const fechaIso = iso;
/** Solo el error de MySQL/MariaDB «columna desconocida» (1054) autoriza reintentar sin columnas opcionales; conexión, permisos, etc. se propagan. */
export const esColumnaInexistente = (e: unknown) => { const x = e as { code?: string; errno?: number } | null; return x?.code === "ER_BAD_FIELD_ERROR" || x?.errno === 1054; };
export type RangoFechas = { min: string | null; max: string | null; sinFecha?: boolean };
/** Acumula la fecha de una fila en el rango del grupo; una fila sin fecha válida marca `sinFecha`. */
export function acumularFecha(r: RangoFechas | undefined, fecha: unknown): RangoFechas {
    const out: RangoFechas = r ?? { min: null, max: null, sinFecha: false }, f = iso(fecha);
    if (!f) { out.sinFecha = true; return out; }
    if (!out.min || f < out.min) out.min = f;
    if (!out.max || f > out.max) out.max = f;
    return out;
}
/** Compara el rango de fechas de consumo con el periodo laboral. Sin fecha de baja confiable → SIN_FECHA_BAJA (confirmación manual, nunca se asume que seguía activo). */
export function ventanaLaboral(e: EmpleadoCatalogo, rango: RangoFechas | undefined): VentanaLaboral {
    if (e.estado === undefined || e.estado === "Activo") return "ACTIVO";
    const baja = iso(e.fechaBaja), alta = iso(e.fechaAlta);
    if (!baja) return "SIN_FECHA_BAJA";
    if (!rango?.min || !rango.max || rango.sinFecha) return "SIN_FECHA_CONSUMO";
    if (rango.max > baja) return "POSTERIOR_A_BAJA";
    if (alta && rango.min < alta) return "ANTERIOR_A_ALTA";
    return "VALIDA";
}
export const textoVentana: Record<VentanaLaboral, string> = {
    ACTIVO: "", VALIDA: "Los consumos son anteriores o iguales a la fecha de baja.",
    POSTERIOR_A_BAJA: "Aviso: hay consumos posteriores a la fecha de baja; verifica que sea la misma persona.",
    ANTERIOR_A_ALTA: "Aviso: hay consumos anteriores a la fecha de alta.",
    SIN_FECHA_BAJA: "Aviso: RR. HH. no tiene fecha de baja confiable; no se puede comparar con los consumos.",
    SIN_FECHA_CONSUMO: "Aviso: el archivo no trae fechas suficientes para comparar con la baja.",
};
export const etiquetaEmpleado = (e: EmpleadoCatalogo) => `${e.nombre} · #${e.id}${e.estado && e.estado !== "Activo" ? ` · ${e.estado}${e.fechaBaja ? ` (${iso(e.fechaBaja)})` : ""}` : ""}`;
