/** Comparación de catálogos autorizados. Nunca elimina prefijos ni corrige caracteres. */
export function placaComparable(value: string): string {
    const s = value.normalize("NFC").trim().toUpperCase().replace(/[‐‑–—]/g, "-");
    return /^[A-Z0-9\s-]+$/.test(s) ? s.replace(/[\s-]/g, "") : "";
}
export const nombreComparable = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toUpperCase();
export type Coincidencia<T> = { estado: "EXACTA" | "ABREVIADA" | "APROXIMADA" | "AMBIGUA" | "INEXISTENTE"; candidatos: T[] };
/** Solo la omisión del prefijo en una placa de tres dígitos y tres letras.
 * No cambia identificadores persistidos ni confunde prefijos expresamente informados. */
export function esPlacaAbreviada(value: string) { return /^\d{3}[A-Z]{3}$/.test(placaComparable(value)); }
export function identificarPlaca<T>(original: string, catalogo: T[], etiqueta: (v: T) => string): Coincidencia<T> {
    const key = placaComparable(original);
    if (!key) return { estado: "INEXISTENTE", candidatos: [] };
    const abreviada = esPlacaAbreviada(key);
    const candidatos = catalogo.filter(v => {
        const placa = placaComparable(etiqueta(v));
        return abreviada ? /^(?:[A-Z])?\d{3}[A-Z]{3}$/.test(placa) && placa.slice(-6) === key : placa === key;
    });
    return { estado: candidatos.length > 1 ? "AMBIGUA" : !candidatos.length ? "INEXISTENTE" : placaComparable(etiqueta(candidatos[0])) === key ? "EXACTA" : "ABREVIADA", candidatos };
}
export function placaCompatible<T extends { id: number; placa: string }>(original: string, id: number, catalogo: T[]) {
    const match = identificarPlaca(original, catalogo, v => v.placa);
    // Una placa completa ambigua se resuelve mediante selección manual de una exacta.
    // Una abreviada ambigua nunca permite inferir el prefijo, ni siquiera al enviar un ID.
    return (!esPlacaAbreviada(original) || match.candidatos.length === 1) && match.candidatos.some(v => v.id === id);
}
function distancia(a: string, b: string): number {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + Number(a[i - 1] !== b[j - 1]));
        prev = next;
    }
    return prev[b.length];
}
export function buscarCoincidencias<T>(original: string, catalogo: T[], etiqueta: (v: T) => string, tipo: "placa" | "piloto"): Coincidencia<T> {
    const normalizar = tipo === "placa" ? placaComparable : nombreComparable;
    const key = normalizar(original);
    if (!key || key.length > 255) return { estado: "INEXISTENTE", candidatos: [] };
    if (tipo === "placa") {
        const match = identificarPlaca(original, catalogo, etiqueta);
        if (match.candidatos.length) return match;
    }
    const exactas = catalogo.filter(v => normalizar(etiqueta(v)) === key);
    if (exactas.length) return { estado: exactas.length === 1 ? "EXACTA" : "AMBIGUA", candidatos: exactas };
    const aproximadas = catalogo.map((v, i) => {
        const s = normalizar(etiqueta(v));
        // Orden de nombres/apellidos y nombres incompletos son sugerencias, nunca identidad exacta.
        const tokens = key.split(" "), otras = s.split(" ");
        const parcial = tipo === "piloto" && tokens.length >= 2 && tokens.every(t => otras.includes(t));
        const d = s.length <= 255 ? distancia(key, s) : 256;
        return { v, i, score: parcial ? 0 : d, aceptar: !!s && (parcial || d <= (tipo === "placa" ? 1 : Math.min(3, Math.floor(key.length / 5)))) };
    }).filter(v => v.aceptar).sort((a, b) => a.score - b.score || etiqueta(a.v).localeCompare(etiqueta(b.v)) || a.i - b.i);
    return { estado: aproximadas.length ? "APROXIMADA" : "INEXISTENTE", candidatos: aproximadas.slice(0, 8).map(v => v.v) };
}
