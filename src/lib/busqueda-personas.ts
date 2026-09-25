/**
 * BÚSQUEDA DE PERSONAL — semántica única y compartida por los selectores de Operaciones (Fondos, Gastos, Compras /
 * Requerimientos, Programación piloto/auxiliares, Viáticos…).
 *
 * La normalización es SOLO para comparar: nunca se guarda ni se muestra. La interfaz siempre enseña el nombre real
 * ("José Antonio Pérez López"). Este módulo NO decide quién es seleccionable (activos, roles, tenant, disponibilidad):
 * eso lo siguen decidiendo los catálogos y los componentes que lo llaman; aquí solo se filtra y ordena lo ya permitido.
 */

/** minúsculas, sin tildes/diacríticos (ñ→n, á→a), espacios repetidos = uno, sin espacios en los extremos. */
export function normalizarTextoBusqueda(texto: string | null | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras de la consulta, normalizadas y sin vacíos. */
export function tokensBusqueda(consulta: string | null | undefined): string[] {
  const q = normalizarTextoBusqueda(consulta);
  return q ? q.split(" ") : [];
}

/** Todas las palabras de la consulta deben estar presentes (en cualquier orden) en el texto buscable. Consulta vacía = coincide. */
export function coincideBusquedaPersona(consulta: string | null | undefined, textoBuscable: string | null | undefined): boolean {
  const tokens = tokensBusqueda(consulta);
  if (!tokens.length) return true;
  const texto = normalizarTextoBusqueda(textoBuscable);
  return tokens.every((t) => texto.includes(t));
}

/** 0 = nombre completo exacto · 1 = el nombre empieza con la consulta · 2 = una palabra del nombre empieza con la consulta
 *  · 3 = todas las palabras están en el nombre · 4 = coincide solo por otro texto buscable (código, puesto…). */
export type RangoCoincidencia = 0 | 1 | 2 | 3 | 4;

export function rangoCoincidenciaPersona(consulta: string, nombre: string): RangoCoincidencia {
  const q = normalizarTextoBusqueda(consulta);
  const n = normalizarTextoBusqueda(nombre);
  if (!q) return 4;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (` ${n}`.includes(` ${q}`)) return 2;
  if (coincideBusquedaPersona(q, n)) return 3;
  return 4;
}

const comparar = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

type Extractores<T> = {
  /** Nombre real (se usa para rankear y como desempate alfabético). */
  nombre: (item: T) => string;
  /** Texto buscable adicional (código, puesto, detalle…). El nombre siempre participa. */
  buscable?: (item: T) => string | null | undefined;
};

/**
 * Filtra por la semántica compartida y ordena: rango (exacto > prefijo > palabra > todos los tokens > otro texto) y, dentro del
 * mismo rango, por nombre real alfabéticamente. Sin consulta devuelve el catálogo tal cual (sin reordenar ni recortar).
 */
export function filtrarPersonas<T>(items: readonly T[], consulta: string | null | undefined, extraer: Extractores<T>, limite = 200): T[] {
  const q = normalizarTextoBusqueda(consulta);
  if (!q) return items.slice() as T[];
  return items
    .filter((it) => coincideBusquedaPersona(q, `${extraer.nombre(it)} ${extraer.buscable?.(it) ?? ""}`))
    .map((it) => ({ it, rango: rangoCoincidenciaPersona(q, extraer.nombre(it)), nombre: extraer.nombre(it) }))
    .sort((a, b) => a.rango - b.rango || comparar(a.nombre, b.nombre))
    .slice(0, limite)
    .map((x) => x.it);
}

/** Etiqueta de una persona en un desplegable: nombre real + datos de identificación que YA existan (nunca DPI). */
export function etiquetaPersona(nombre: string, ...identificacion: Array<string | null | undefined>): string {
  const extra = identificacion.map((v) => (v ?? "").trim()).filter(Boolean);
  return extra.length ? `${nombre} · ${extra.join(" · ")}` : nombre;
}
