/**
 * PROGRAMACION-EXPORT-IMAGEN-1 — módulo PURO (sin Canvas, sin DOM, sin
 * `document`) para el "Exportar imagen" de Programación: arma el
 * encabezado y las filas de la tabla, decide el ancho de cada columna y
 * decide la paginación cuando el contenido es muy largo. El dibujo real
 * sobre un `<canvas>` (y la descarga del PNG/JPG) vive aparte, en
 * programacion-exportar-imagen.ts (solo se puede probar en el navegador),
 * para que TODA la lógica de negocio quede aquí, testeable en Node.
 *
 * IMPORTANTE — este archivo se importa desde un componente cliente (el
 * botón "Exportar imagen"), así que NUNCA debe importar nada que arrastre
 * dependencias solo-de-servidor: `cotizacion-pdf-layout.ts` usa PDFKit
 * (que a su vez necesita `fs` de Node) — importar su `anchosColumnas`
 * desde aquí rompía el build del navegador ("Module not found: fs"). El
 * reparto proporcional de ancho es la misma fórmula de 3 líneas, pero se
 * define aquí localmente para no arrastrar ese árbol de dependencias.
 *
 * Contenido por fila: código, fecha/hora, cliente, ruta, piloto,
 * auxiliares, unidad, estado, regreso estimado (si existe), tarifa
 * comercial (si aplica) — exactamente los campos que pide el ticket, ya
 * formateados por el llamador (programacion-client.tsx) reutilizando los
 * MISMOS helpers que ya usa el tablero en pantalla (estadoVisible,
 * resumenRegreso, formatearHora12) — esta función nunca vuelve a decidir
 * cómo se ve un estado o un regreso, solo recibe el texto ya resuelto.
 */

export type FilaProgramacionImagen = {
  codigo: string;
  /** Ya formateada por el llamador, p. ej. "2026-09-22 · 08:00 AM". */
  fechaHora: string;
  cliente: string;
  ruta: string;
  piloto: string;
  /** Ya unidos con ", " — vacío si no hay auxiliares. */
  auxiliares: string;
  unidad: string;
  estado: string;
  /** "" si el viaje no tiene regreso estimado — nunca se inventa un valor. */
  regresoEstimado: string;
  /** "" si la cotización/viaje no tiene tarifa comercial. */
  tarifaComercial: string;
};

export type EncabezadoProgramacionImagen = {
  empresa: string;
  /** "2026-09-22" o "2026-09-22 a 2026-09-28" — mismo texto que ya arma reporteQueryString/rango en programacion-client.tsx. */
  rango: string;
  /** "Estado: Programado · Piloto: Juan Pérez" — ya unido con " · ", "" si no hay filtros activos. */
  filtros: string;
  /** Fecha/hora de generación, ya formateada. */
  generado: string;
};

/** Columna de la tabla del reporte — mismo shape que ColumnaTabla en cotizacion-pdf-layout.ts, definido aquí aparte (ver nota de dependencias arriba). */
export type ColumnaImagen = { titulo: string; peso: number; alinear?: "left" | "right" | "center" };

export const COLUMNAS_IMAGEN: ColumnaImagen[] = [
  { titulo: "Código", peso: 1.2 },
  { titulo: "Fecha / Hora", peso: 1.5 },
  { titulo: "Cliente", peso: 1.7 },
  { titulo: "Ruta", peso: 2.1 },
  { titulo: "Piloto", peso: 1.5 },
  { titulo: "Auxiliares", peso: 1.7 },
  { titulo: "Unidad", peso: 1.0 },
  { titulo: "Estado", peso: 1.2 },
  { titulo: "Regreso est.", peso: 1.4 },
  { titulo: "Tarifa", peso: 1.1, alinear: "right" },
];

/** Ancho fijo del reporte (px) — suficiente para 10 columnas legibles sin scroll horizontal en pantallas normales. */
export const ANCHO_IMAGEN = 1700;
export const ALTO_FILA = 34;
export const ALTO_FILA_CABECERA = 38;
/**
 * Alto máximo razonable de UN lienzo (muy por debajo del límite real de
 * los navegadores, ~16000-32000px según motor) — evita un PNG gigantesco
 * o pesado si el filtro trae cientos de viajes. Con esto, una semana
 * completa de Programación (decenas de viajes) siempre cabe en UNA sola
 * imagen; solo un caso extremo se divide en varias.
 */
export const ALTO_MAXIMO_LIENZO = 6000;

/** Anchos de columna en píxeles, proporcionales al peso de cada una (misma fórmula que anchosColumnas en cotizacion-pdf-layout.ts — ver nota de dependencias arriba sobre por qué no se importa de ahí). */
export function anchosColumnasImagen(anchoDisponible: number = ANCHO_IMAGEN): number[] {
  const total = COLUMNAS_IMAGEN.reduce((s, c) => s + c.peso, 0);
  return COLUMNAS_IMAGEN.map((c) => (c.peso / total) * anchoDisponible);
}

/** Una fila -> arreglo de celdas, en el mismo orden que COLUMNAS_IMAGEN. */
export function celdasFila(f: FilaProgramacionImagen): string[] {
  return [f.codigo, f.fechaHora, f.cliente, f.ruta, f.piloto, f.auxiliares, f.unidad, f.estado, f.regresoEstimado, f.tarifaComercial];
}

/** Líneas de texto del encabezado del reporte (empresa/título, luego el subtítulo con rango + filtros + generado). */
export function lineasEncabezado(e: EncabezadoProgramacionImagen): { titulo: string; subtitulo: string } {
  const subtitulo = [e.rango, e.filtros, `Generado ${e.generado}`].filter(Boolean).join(" · ");
  return { titulo: `${e.empresa} — PROGRAMACIÓN`, subtitulo };
}

/** Divide un arreglo en trozos de tamaño `porPagina` (última página puede quedar más corta). `porPagina <= 0` o arreglo vacío -> [] o [[]] según corresponda, nunca revienta. */
export function paginar<T>(items: T[], porPagina: number): T[][] {
  if (!items.length) return [];
  if (porPagina <= 0) return [items];
  const paginas: T[][] = [];
  for (let i = 0; i < items.length; i += porPagina) paginas.push(items.slice(i, i + porPagina));
  return paginas;
}

/**
 * Cuántas filas caben en un solo lienzo antes de tener que dividir en más
 * de una imagen, dado el alto ya ocupado por encabezado + título de tabla.
 * Nunca menos de 1 (una imagen con una sola fila sigue siendo válida).
 */
export function filasPorPagina(altoEncabezado: number, altoMaximo: number = ALTO_MAXIMO_LIENZO): number {
  const disponible = altoMaximo - altoEncabezado - ALTO_FILA_CABECERA;
  return Math.max(1, Math.floor(disponible / ALTO_FILA));
}

export type LayoutImagenPrograma = {
  anchoColumnas: number[];
  encabezado: { titulo: string; subtitulo: string };
  /** Cada página ya es un arreglo de filas (celdas) listo para dibujar; el llamador solo pinta, nunca decide qué va en cada página. */
  paginas: string[][][];
  totalPaginas: number;
};

/**
 * Arma TODO lo que necesita el dibujo en canvas: anchos de columna,
 * encabezado ya resuelto y las filas ya divididas en páginas — sin tocar
 * Canvas ni DOM, así que se prueba igual que cualquier función pura.
 */
export function construirLayoutImagen(
  encabezado: EncabezadoProgramacionImagen,
  filas: FilaProgramacionImagen[],
  opts: { anchoDisponible?: number; altoEncabezado?: number; altoMaximoLienzo?: number } = {},
): LayoutImagenPrograma {
  const ancho = opts.anchoDisponible ?? ANCHO_IMAGEN;
  const altoEncabezadoPx = opts.altoEncabezado ?? 90;
  const porPagina = filasPorPagina(altoEncabezadoPx, opts.altoMaximoLienzo ?? ALTO_MAXIMO_LIENZO);
  const celdas = filas.map(celdasFila);
  const paginas = paginar(celdas, porPagina);
  return {
    anchoColumnas: anchosColumnasImagen(ancho),
    encabezado: lineasEncabezado(encabezado),
    paginas: paginas.length ? paginas : [[]],
    totalPaginas: Math.max(1, paginas.length),
  };
}
