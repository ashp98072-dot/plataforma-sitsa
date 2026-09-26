/**
 * PROGRAMACION-EXPORT-IMAGEN-1 (ajuste: mismo formato que el reporte
 * tradicional) — módulo PURO (sin Canvas, sin DOM, sin `document`) para
 * el "Exportar imagen" de Programación: arma el encabezado y las filas de
 * la tabla, decide el ancho de cada columna y decide la paginación cuando
 * el contenido es muy largo. El dibujo real sobre un `<canvas>` (y la
 * descarga del PNG/JPG) vive aparte, en programacion-exportar-imagen.ts
 * (solo se puede probar en el navegador), para que TODA la lógica de
 * negocio quede aquí, testeable en Node.
 *
 * IMPORTANTE — este archivo se importa desde un componente cliente (el
 * botón "Exportar imagen"), así que NUNCA debe importar nada que arrastre
 * dependencias solo-de-servidor: `cotizacion-pdf-layout.ts` usa PDFKit
 * (que a su vez necesita `fs` de Node) — importar su `anchosColumnas`
 * desde aquí rompía el build del navegador ("Module not found: fs"). El
 * reparto proporcional de ancho es la misma fórmula de 3 líneas, pero se
 * define aquí localmente para no arrastrar ese árbol de dependencias.
 *
 * COLUMNAS — a propósito son las MISMAS 10 del reporte tradicional
 * Excel/PDF de Programación (src/app/api/.../tms/programacion/reporte/
 * route.ts: Mes, Día, Placa, Piloto, Auxiliar 1, Auxiliar 2, Cliente,
 * Lugar de Carga, Hora, Lugar de Descarga) — nunca Código/Estado/Regreso
 * estimado/Tarifa/una "Ruta" combinada, que sí llevaba la primera versión
 * de este export y el negocio pidió quitar para que la imagen se vea
 * igual al reporte que Operaciones ya conoce. El llamador
 * (programacion-client.tsx) arma cada celda con el MISMO criterio que ya
 * usa ese reporte tradicional:
 *   - Mes/Día: `mesDia()` de abajo, misma tabla de abreviaturas de 3
 *     letras (ENE..DIC) que ya usa reporte/route.ts (no exportada desde
 *     ahí — es una tabla de 12 valores fijos, se repite aquí a propósito
 *     en vez de importar un archivo de ruta API como si fuera una
 *     librería).
 *   - Auxiliar 1 / Auxiliar 2: primeros dos de la lista, en el mismo
 *     orden — un tercer auxiliar (o más) se descarta, igual que el
 *     reporte tradicional (nunca se inventa una tercera columna ni un
 *     "+N").
 *   - Lugar de Carga: primera parada tipo "Carga" del plan
 *     (`paradas`), igual que reporte/route.ts.
 *   - Lugar de Descarga: `lugar_descarga_historico` de la cotización —
 *     NUNCA "primera parada" (regla VIAT-4b, ya documentada en
 *     reporte/route.ts) — nunca una reconstrucción distinta aquí.
 *   - Hora: `hora_carga` recortada a "HH:mm" (24h), igual que el reporte
 *     tradicional — sin AM/PM, a propósito distinto del resto de
 *     Programación (que sí usa 12h) para mantener consistencia con el
 *     PDF/Excel existente.
 */

export type FilaProgramacionImagen = {
  mes: string;
  dia: string;
  placa: string;
  /**
   * PROGRAMACION-TC-CAJA-REMOLQUE-1 — TC/caja/remolque del viaje (Propio:
   * interno; Tercerizado: snapshot externo — mismo concepto "TC"). Vacío si
   * el viaje no lleva TC.
   */
  tc: string;
  piloto: string;
  auxiliar1: string;
  auxiliar2: string;
  cliente: string;
  lugarCarga: string;
  /** "HH:mm" (24h) — mismo formato que el reporte tradicional, nunca 12h aquí. */
  hora: string;
  lugarDescarga: string;
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

/** Mismas abreviaturas de 3 letras que ya usa el reporte tradicional (MESES en reporte/route.ts) — confirmadas contra el Excel real de Operaciones. */
export const MESES_ABREVIADOS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** "2026-09-22" (fecha_plan) -> { mes: "SEP", dia: "22" } — misma tabla y el mismo criterio que ya usa el reporte tradicional. */
export function mesDia(fechaPlan: string): { mes: string; dia: string } {
  const [, mes, dia] = String(fechaPlan).split("-").map(Number);
  return { mes: MESES_ABREVIADOS[(mes ?? 1) - 1] ?? "", dia: dia ? String(dia) : "" };
}

export const COLUMNAS_IMAGEN: ColumnaImagen[] = [
  { titulo: "Mes", peso: 0.7 },
  { titulo: "Día", peso: 0.6 },
  { titulo: "Placa", peso: 1.1 },
  { titulo: "TC", peso: 0.9 },
  { titulo: "Piloto", peso: 1.7 },
  { titulo: "Auxiliar 1", peso: 1.5 },
  { titulo: "Auxiliar 2", peso: 1.5 },
  { titulo: "Cliente", peso: 1.9 },
  { titulo: "Lugar de Carga", peso: 2.1 },
  { titulo: "Hora", peso: 0.7 },
  { titulo: "Lugar de Descarga", peso: 2.1 },
];

/** Ancho del lienzo (px) — formato horizontal/landscape, suficiente para 10 columnas (2 de ellas texto largo) legibles y nítidas. */
export const ANCHO_IMAGEN = 2000;
export const ALTO_FILA = 34;
export const ALTO_FILA_CABECERA = 38;
/** Alto de cada línea ADICIONAL de una celda con varias líneas (p. ej. piloto principal + piloto extra en la misma celda "Piloto"). */
export const ALTO_LINEA_EXTRA = 17;
/** Separador de líneas dentro de UNA celda (cada piloto en su propia línea; nunca una columna nueva). */
export const SEPARADOR_LINEAS_CELDA = "\n";

/**
 * Texto de la celda "Piloto" de la imagen: el principal y, si existe, el piloto EXTRA — cada uno en su propia línea DENTRO de la misma
 * columna. Sin extra queda exactamente el texto de siempre (una línea). Nunca se manda al piloto extra a Auxiliar 1/2.
 */
export function celdaPilotoImagen(principal: string | null | undefined, extra: string | null | undefined): string {
  return [principal, extra].map((n) => (n ?? "").trim()).filter(Boolean).join(SEPARADOR_LINEAS_CELDA);
}

/**
 * Parte un texto en líneas que quepan en `anchoMax` (medido con `medir`, p. ej. ctx.measureText): respeta los saltos de línea de la celda y
 * envuelve por PALABRAS, de modo que un nombre largo se muestra COMPLETO en varias líneas. Solo una palabra suelta más ancha que la celda
 * se corta al final (última defensa; no ocurre con nombres reales).
 */
export function envolverTexto(texto: string, anchoMax: number, medir: (t: string) => number): string[] {
  const salida: string[] = [];
  for (const bloque of String(texto ?? "").split(SEPARADOR_LINEAS_CELDA)) {
    const palabras = bloque.split(/\s+/).filter(Boolean);
    if (!palabras.length) { salida.push(""); continue; }
    let actual = "";
    for (const palabra of palabras) {
      const candidata = actual ? `${actual} ${palabra}` : palabra;
      if (!actual || medir(candidata) <= anchoMax) actual = candidata;
      else { salida.push(actual); actual = palabra; }
    }
    salida.push(actual);
  }
  return salida.length ? salida : [""];
}

/** Alto de una fila según su celda con MÁS líneas: una línea = ALTO_FILA (aspecto de siempre); cada línea extra suma ALTO_LINEA_EXTRA. */
export function altoFilaImagen(lineasPorCelda: number[]): number {
  const maximo = Math.max(1, ...lineasPorCelda);
  return ALTO_FILA + (maximo - 1) * ALTO_LINEA_EXTRA;
}
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
  return [f.mes, f.dia, f.placa, f.tc, f.piloto, f.auxiliar1, f.auxiliar2, f.cliente, f.lugarCarga, f.hora, f.lugarDescarga];
}

/** Líneas de texto del encabezado del reporte: título fijo "PROGRAMACIÓN", subtítulo con empresa + rango + filtros + generado (mismo orden que pide el ticket). */
export function lineasEncabezado(e: EncabezadoProgramacionImagen): { titulo: string; subtitulo: string } {
  const subtitulo = [e.empresa, e.rango, e.filtros, `Generado ${e.generado}`].filter(Boolean).join(" · ");
  return { titulo: "PROGRAMACIÓN", subtitulo };
}

/** Divide un arreglo en trozos de tamaño `porPagina` (última página puede quedar más corta). `porPagina <= 0` o arreglo vacío -> [] o [[]] según corresponda, nunca revienta. */
export function paginar<T>(items: T[], porPagina: number): T[][] {
  if (!items.length) return [];
  if (porPagina <= 0) return [items];
  const paginas: T[][] = [];
  for (let i = 0; i < items.length; i += porPagina) paginas.push(items.slice(i, i + porPagina));
  return paginas;
}

/** Pagina por alto acumulado (las filas con celdas de varias líneas miden más). Nunca deja una página vacía ni parte una fila. */
export function paginarPorAlto(filas: string[][], altoDisponible: number): string[][][] {
  const paginas: string[][][] = [];
  let actual: string[][] = [];
  let usado = 0;
  for (const fila of filas) {
    const alto = altoFilaImagen(fila.map((c) => c.split(SEPARADOR_LINEAS_CELDA).length));
    if (actual.length && usado + alto > altoDisponible) { paginas.push(actual); actual = []; usado = 0; }
    actual.push(fila);
    usado += alto;
  }
  if (actual.length) paginas.push(actual);
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
  const altoMaximo = opts.altoMaximoLienzo ?? ALTO_MAXIMO_LIENZO;
  const porPagina = filasPorPagina(altoEncabezadoPx, altoMaximo);
  const celdas = filas.map(celdasFila);
  // Si alguna celda tiene varias líneas (piloto principal + extra) las filas miden más: se pagina por el alto acumulado (con todo de una línea,
  // exactamente las mismas filas por página de siempre).
  const varias = celdas.some((fila) => fila.some((c) => c.includes(SEPARADOR_LINEAS_CELDA)));
  const paginas = varias ? paginarPorAlto(celdas, altoMaximo - altoEncabezadoPx - ALTO_FILA_CABECERA) : paginar(celdas, porPagina);
  return {
    anchoColumnas: anchosColumnasImagen(ancho),
    encabezado: lineasEncabezado(encabezado),
    paginas: paginas.length ? paginas : [[]],
    totalPaginas: Math.max(1, paginas.length),
  };
}
