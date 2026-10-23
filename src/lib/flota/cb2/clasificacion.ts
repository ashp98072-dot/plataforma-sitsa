import { nombreComparable } from "../combustible-coincidencias";
export const productos = ["DIESEL", "GASOLINA_REGULAR", "GASOLINA_SUPERIOR", "VPOWER_DIESEL", "VPOWER_GASOLINA", "VPOWER_NO_DETERMINADO", "NO_DETERMINADO"] as const;
export type Producto = typeof productos[number];
export const etiquetasProducto: Record<Producto, string> = { DIESEL: "DIÉSEL", GASOLINA_REGULAR: "GASOLINA REGULAR", GASOLINA_SUPERIOR: "GASOLINA SUPERIOR / SÚPER", VPOWER_DIESEL: "V-POWER DIÉSEL", VPOWER_GASOLINA: "V-POWER GASOLINA", VPOWER_NO_DETERMINADO: "V-POWER · variante no determinada", NO_DETERMINADO: "NO DETERMINADO" };
export function clasificarProducto(original: string | null | undefined): Producto | null {
    const s = nombreComparable(original ?? "").replace(/[-‐‑–—]/g, " ").replace(/\s+/g, " ");
    if (/^V ?POWER(?: DIESEL)?$/.test(s)) return s.endsWith("DIESEL") ? "VPOWER_DIESEL" : null;
    if (/^V ?POWER (GASOLINA|SUPER|SUPERIOR)$/.test(s)) return "VPOWER_GASOLINA";
    if (s === "DIESEL") return "DIESEL";
    if (/^(GASOLINA )?REGULAR$/.test(s)) return "GASOLINA_REGULAR";
    if (/^(GASOLINA )?(SUPER|SUPERIOR)$/.test(s)) return "GASOLINA_SUPERIOR";
    return null;
}
export function identificarEmpleado<T extends { id: number; nombre: string }>(original: string, catalogo: T[]) {
    const key = nombreComparable(original), tokens = [...new Set(key.split(" ").filter(Boolean))];
    const exactas = key ? catalogo.filter(p => nombreComparable(p.nombre) === key) : [];
    if (exactas.length) return { estado: exactas.length === 1 ? "EXACTA" : "AMBIGUA", candidatos: exactas, propuesta: exactas.length === 1 && tokens.length >= 2 ? exactas[0] : null, motivo: "Igualdad de nombre normalizado; autopropuesta requiere al menos dos tokens distintos" };
    const candidatos = tokens.length >= 2 ? catalogo.filter(p => { const otras = nombreComparable(p.nombre).split(" "); return tokens.every(t => otras.includes(t)); }) : [];
    // Dos tokens completos ofrecen candidatos, pero no prueban identidad: no se autopropone una persona incompleta.
    return { estado: candidatos.length === 1 ? "PARCIAL_UNICA" : candidatos.length > 1 ? "AMBIGUA" : "INEXISTENTE", candidatos, propuesta: null, motivo: candidatos.length ? "Tokens completos sin exigir orden; confirmar manualmente el nombre completo" : "No hay coincidencia confiable" };
}
