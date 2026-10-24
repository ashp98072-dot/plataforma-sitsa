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
export { identificarEmpleado } from "./empleados-coincidencias";
