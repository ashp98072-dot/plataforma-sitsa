import { nombreComparable } from "../combustible-coincidencias";

export const metodosEmpleado = ["EXACTA_NORMALIZADA", "TOKENS_COMPLETOS_UNICOS", "MANUAL", "SIN_ASIGNACION"] as const;
export type MetodoEmpleado = typeof metodosEmpleado[number];
type MetodoAutomatico = Extract<MetodoEmpleado, "EXACTA_NORMALIZADA" | "TOKENS_COMPLETOS_UNICOS">;
type Empleado = { id: number; nombre: string; estado?: string; fechaBaja?: string | null; fechaAlta?: string | null };
export type CoincidenciaEmpleado<T> = {
    estado: "EXACTA" | "PARCIAL_UNICA" | "AMBIGUA" | "INEXISTENTE";
    candidatos: T[];
    propuesta: T | null;
    metodo: MetodoAutomatico | null;
    motivo: string;
};
export const nombreEmpleadoComparable = (s: string) => nombreComparable(s).replace(/\p{P}+/gu, " ").replace(/\s+/g, " ").trim();
const sinNombre = new Set(["NO TIENE NOMBRE", "SIN NOMBRE", "NO INFORMADO", "N A", "PENDIENTE"]);

/** Partículas que no cuentan como «palabra» de identidad (evitan que «de/la» + un apellido común identifiquen a otra persona).
 * Una palabra cuenta si tiene al menos 2 letras y no es una partícula. */
const particulas = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "VON", "VAN", "DA", "DO", "DI"]);
export const palabraSignificativa = (t: string) => t.length >= 2 && !particulas.has(t);
export const MIN_PALABRAS_COINCIDENTES = 2;

/** Política ÚNICA de reconocimiento (Shell, HALEL, terceros directos y validación del servidor).
 * El llamador aporta exclusivamente el catálogo autorizado de la empresa actual (empleados Activo y Baja; el estado no cambia el reconocimiento).
 * Un empleado es elegible si comparte al menos DOS palabras completas distintas con el nombre importado (sin importar posición, tildes ni mayúsculas).
 * Exactamente un elegible → propuesta con su ID real; dos o más → ambiguo; ninguno → revisión manual.
 * Índice invertido y caché por nombre: no recorre todo el catálogo por consumo. */
export function crearBuscadorEmpleados<T extends Empleado>(catalogo: readonly T[]) {
    const indice = new Map<string, Set<number>>(), nombres = new Map<number, string>(), cache = new Map<string, CoincidenciaEmpleado<T>>();
    catalogo.forEach((p, i) => {
        if (p.estado !== undefined && p.estado !== "Activo" && p.estado !== "Baja") return;
        const nombre = nombreEmpleadoComparable(p.nombre);
        nombres.set(i, nombre);
        for (const token of new Set(nombre.split(" ").filter(Boolean))) {
            const lista = indice.get(token) ?? new Set<number>(); lista.add(i); indice.set(token, lista);
        }
    });
    return (original: string): CoincidenciaEmpleado<T> => {
        const key = nombreEmpleadoComparable(original), previa = cache.get(key);
        if (previa) return previa;
        const todos = [...new Set(key.split(" ").filter(Boolean))];
        const tokens = todos.filter(palabraSignificativa);
        let indices: number[] = [];
        if (tokens.length >= MIN_PALABRAS_COINCIDENTES && key.length <= 255 && !sinNombre.has(key) && todos.every(t => /^\p{L}+$/u.test(t))) {
            const cuenta = new Map<number, number>();
            for (const t of tokens) for (const i of indice.get(t) ?? []) cuenta.set(i, (cuenta.get(i) ?? 0) + 1);
            indices = [...cuenta].filter(([, n]) => n >= MIN_PALABRAS_COINCIDENTES).map(([i]) => i).sort((a, b) => a - b);
        }
        const candidatos = indices.map(i => catalogo[i]), unica = candidatos.length === 1;
        // Sin excepciones: si dos o más empleados reúnen el mínimo de palabras completas, es ambiguo aunque el nombre importado sea idéntico al de uno de ellos.
        const exacta = unica && nombres.get(indices[0]) === key;
        const resultado: CoincidenciaEmpleado<T> = {
            estado: unica ? exacta ? "EXACTA" : "PARCIAL_UNICA" : candidatos.length ? "AMBIGUA" : "INEXISTENTE",
            candidatos, propuesta: unica ? candidatos[0] : null,
            metodo: unica ? exacta ? "EXACTA_NORMALIZADA" : "TOKENS_COMPLETOS_UNICOS" : null,
            motivo: unica ? exacta ? "Nombre normalizado completo y único en el catálogo de la empresa (activo o de baja)" : "Dos o más palabras completas coinciden con un único empleado de la empresa (activo o de baja)" : candidatos.length ? "Varios empleados comparten dos o más palabras completas; requiere elección manual" : "Sin empleado con al menos dos palabras completas coincidentes; revisión manual",
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
