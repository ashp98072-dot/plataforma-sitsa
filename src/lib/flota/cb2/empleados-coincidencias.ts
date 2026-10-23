import { nombreComparable } from "../combustible-coincidencias";

export const metodosEmpleado = ["EXACTA_NORMALIZADA", "TOKENS_COMPLETOS_UNICOS", "MANUAL", "SIN_ASIGNACION"] as const;
export type MetodoEmpleado = typeof metodosEmpleado[number];
type MetodoAutomatico = Extract<MetodoEmpleado, "EXACTA_NORMALIZADA" | "TOKENS_COMPLETOS_UNICOS">;
type Empleado = { id: number; nombre: string; estado?: string };
export type CoincidenciaEmpleado<T> = {
    estado: "EXACTA" | "PARCIAL_UNICA" | "AMBIGUA" | "INEXISTENTE";
    candidatos: T[];
    propuesta: T | null;
    metodo: MetodoAutomatico | null;
    motivo: string;
};
export const nombreEmpleadoComparable = (s: string) => nombreComparable(s).replace(/\p{P}+/gu, " ").replace(/\s+/g, " ").trim();
const sinNombre = new Set(["NO TIENE NOMBRE", "SIN NOMBRE", "NO INFORMADO", "N A", "PENDIENTE"]);

/** El llamador aporta exclusivamente el catálogo autorizado de la empresa actual.
 * Índice invertido y caché por nombre: no recorre todo el catálogo por consumo. */
export function crearBuscadorEmpleados<T extends Empleado>(catalogo: readonly T[]) {
    const indice = new Map<string, Set<number>>(), nombres = new Map<number, string>(), cache = new Map<string, CoincidenciaEmpleado<T>>();
    catalogo.forEach((p, i) => {
        if (p.estado !== undefined && p.estado !== "Activo") return;
        const nombre = nombreEmpleadoComparable(p.nombre);
        nombres.set(i, nombre);
        for (const token of new Set(nombre.split(" ").filter(Boolean))) {
            const lista = indice.get(token) ?? new Set<number>(); lista.add(i); indice.set(token, lista);
        }
    });
    return (original: string): CoincidenciaEmpleado<T> => {
        const key = nombreEmpleadoComparable(original), previa = cache.get(key);
        if (previa) return previa;
        const tokens = [...new Set(key.split(" ").filter(Boolean))];
        let indices: number[] = [];
        if (tokens.length >= 2 && key.length <= 255 && !sinNombre.has(key) && tokens.every(t => /^\p{L}+$/u.test(t))) {
            const listas = tokens.map(t => indice.get(t) ?? new Set<number>()).sort((a,b) => a.size-b.size);
            indices = [...listas[0]].filter(i => listas.every(lista => lista.has(i))).sort((a,b) => a-b);
        }
        const candidatos = indices.map(i => catalogo[i]), unica = candidatos.length === 1;
        const exacta = unica && nombres.get(indices[0]) === key;
        // Una exacta no gana sobre otra persona cuyo nombre también contiene los tokens.
        const resultado: CoincidenciaEmpleado<T> = {
            estado: unica ? exacta ? "EXACTA" : "PARCIAL_UNICA" : candidatos.length ? "AMBIGUA" : "INEXISTENTE",
            candidatos, propuesta: unica ? candidatos[0] : null,
            metodo: unica ? exacta ? "EXACTA_NORMALIZADA" : "TOKENS_COMPLETOS_UNICOS" : null,
            motivo: unica ? exacta ? "Nombre normalizado completo y único en el catálogo activo" : "Dos o más tokens completos, sin exigir orden, identifican un único empleado activo" : candidatos.length ? "Varios empleados contienen todos los tokens; requiere elección manual" : "Sin coincidencia confiable de al menos dos tokens completos; piloto pendiente",
        };
        if (key.length <= 255 && cache.size < 10000) cache.set(key, resultado);
        return resultado;
    };
}
// Catálogos inmutables recibidos del endpoint: cada recarga construye un array nuevo.
const buscadores = new WeakMap<readonly Empleado[], ReturnType<typeof crearBuscadorEmpleados<Empleado>>>();
export function identificarEmpleado<T extends Empleado>(original: string, catalogo: readonly T[]): CoincidenciaEmpleado<T> {
    let buscar = buscadores.get(catalogo);
    if (!buscar) { buscar = crearBuscadorEmpleados(catalogo); buscadores.set(catalogo, buscar); }
    return buscar(original) as CoincidenciaEmpleado<T>;
}
/** undefined conserva la autopropuesta; null es un borrado manual y nunca se repone. */
export function seleccionarEmpleado(original: string, catalogo: readonly Empleado[], manual: number | null | undefined) {
    if (manual !== undefined) return { empleadoId: manual, metodoEmpleado: manual === null ? "SIN_ASIGNACION" as const : "MANUAL" as const };
    const match = identificarEmpleado(original, catalogo);
    return { empleadoId: match.propuesta?.id ?? null, metodoEmpleado: match.metodo ?? "SIN_ASIGNACION" as const };
}
