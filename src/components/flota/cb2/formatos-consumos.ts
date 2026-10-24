import Decimal from "decimal.js";
import { etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";

export function combustibleConsumo(valor: unknown): string {
    return valor == null || valor === "" ? "Sin clasificación" : etiquetasProducto[String(valor) as Producto] ?? `Clasificación no reconocida: ${String(valor)}`;
}

/** Solo presentación: no convierte DECIMAL a Number ni modifica el registro. */
export function cifraConsumo(valor: unknown, minimo: number, maximo: number): string {
    if (valor == null || valor === "") return "No informado";
    if ((typeof valor !== "string" && typeof valor !== "number") || !/^-?\d+(?:\.\d+)?$/.test(String(valor))) return "No disponible";
    const partes = new Decimal(String(valor)).toFixed(maximo, Decimal.ROUND_HALF_UP).split(".");
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (maximo) {
        while (partes[1].length > minimo && partes[1].endsWith("0")) partes[1] = partes[1].slice(0, -1);
    }
    return partes[1] ? partes.join(".") : partes[0];
}

export function importeConsumo(valor: unknown, moneda: unknown, precio = false): string {
    const cifra = cifraConsumo(valor, 2, precio ? 6 : 2);
    if (cifra === "No informado" || cifra === "No disponible") return cifra;
    return moneda === "GTQ" ? `Q ${cifra}` : moneda === "USD" ? `US$ ${cifra}` : `${cifra} · ${moneda || "Moneda no informada"}`;
}

export function galonesRedondeados(valor: unknown): boolean {
    const mostrado = cifraConsumo(valor, 0, 3);
    return mostrado !== "No informado" && mostrado !== "No disponible" && !new Decimal(String(valor)).eq(mostrado.replaceAll(",", ""));
}
