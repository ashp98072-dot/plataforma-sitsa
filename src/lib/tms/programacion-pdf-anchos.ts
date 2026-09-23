/**
 * PROGRAMACION-PDF-ANCHOS-1 — distribución de anchos del PDF de Programación
 * como CONJUNTO (módulo puro, sin BD ni PDFKit).
 *
 * Problema: el ancho automático de dibujarTablaEnDoc reparte por longitud de
 * texto, y parchear una columna con `minWeight` le quitaba ancho a las demás
 * (Mes salía "SE…", Día quedaba angosto, Cliente salía "SAUZALIT…").
 *
 * Solución: pesos EXPLÍCITOS en puntos que suman exactamente el ancho útil
 * de la página (LETTER apaisada, márgenes 32): como suman el ancho útil, el
 * peso de cada columna ES su ancho real en puntos.
 *
 * - Columnas COMPACTAS (Mes, Día, Placa, TC, Hora): ancho fijo con holgura
 *   sobre el texto real más ancho medido con Helvetica 7.5 (SEP/MAR ≈17pt,
 *   "23" ≈8pt, "C-584BSQ" ≈36pt, "TC-045" ≈25pt, "03:00 AM" ≈32pt, más 8pt de
 *   relleno) y `preserveSingleLine`: siempre completas, en una línea, sin "…".
 * - Columnas de TEXTO (Piloto, Auxiliar 1/2, Cliente, Código, Lugar de
 *   Carga/Descarga): reparten el resto y hacen wrap; la fila crece sola.
 *   Tope de líneas: Cliente/Código 2; Piloto/Auxiliares/Carga/Descarga 3.
 *   Los anchos apuntan a que un nombre típico quepa en 2 líneas (ej.
 *   "Anthony Brian García-Aguirre Ávila"), pero un nombre real de 5-6
 *   palabras ("Bayron Eduardo Constanza de la Cruz") necesita 3: se prefiere
 *   el nombre completo a "…". Solo si aun así no cabe, la última línea termina en "…" (último recurso,
 *   nunca en las compactas ni se descarta texto en silencio).
 *
 * "Código" se oculta con estado=Programado, así que hay dos tablas de anchos;
 * ambas suman ANCHO_UTIL_PDF. Menos registros por página (filas más altas)
 * es aceptable: se prefiere más páginas a cortar información.
 */
export const ANCHO_UTIL_PDF = 728; // 792 (LETTER apaisada) - 2 * 32 de margen

type Cfg = { ancho: number; linea?: true; lineas?: number };

const COMPACTAS: Record<string, Cfg> = {
  Mes: { ancho: 30, linea: true },
  "Día": { ancho: 24, linea: true },
  Placa: { ancho: 52, linea: true },
  TC: { ancho: 42, linea: true },
  Hora: { ancho: 46, linea: true },
};

const TEXTO_SIN_CODIGO: Record<string, Cfg> = {
  Piloto: { ancho: 100, lineas: 3 },
  "Auxiliar 1": { ancho: 88, lineas: 3 },
  "Auxiliar 2": { ancho: 88, lineas: 3 },
  Cliente: { ancho: 78, lineas: 2 },
  "Lugar de Carga": { ancho: 90, lineas: 3 },
  "Lugar de Descarga": { ancho: 90, lineas: 3 },
};

const TEXTO_CON_CODIGO: Record<string, Cfg> = {
  Piloto: { ancho: 92, lineas: 3 },
  "Auxiliar 1": { ancho: 80, lineas: 3 },
  "Auxiliar 2": { ancho: 80, lineas: 3 },
  "Código": { ancho: 50, lineas: 2 },
  Cliente: { ancho: 72, lineas: 2 },
  "Lugar de Carga": { ancho: 80, lineas: 3 },
  "Lugar de Descarga": { ancho: 80, lineas: 3 },
};

export type ConfiguracionPdfProgramacion = {
  weight: Record<number, number>;
  preserveSingleLine: number[];
  maxLinesPorColumna: Record<number, number>;
};

/** Anchos (puntos) por encabezado — exportado para pruebas y evidencia. */
export function anchosPdfProgramacion(headers: string[]): Record<string, number> {
  const texto = headers.includes("Código") ? TEXTO_CON_CODIGO : TEXTO_SIN_CODIGO;
  const out: Record<string, number> = {};
  for (const h of headers) {
    const c = COMPACTAS[h] ?? texto[h];
    if (c) out[h] = c.ancho;
  }
  return out;
}

/**
 * Configuración para tablaAPdf según los encabezados reales (con o sin
 * "Código"). Los índices se calculan por nombre, así que siguen correctos
 * cuando una columna se oculta.
 */
export function configuracionPdfProgramacion(headers: string[]): ConfiguracionPdfProgramacion {
  const texto = headers.includes("Código") ? TEXTO_CON_CODIGO : TEXTO_SIN_CODIGO;
  const cfg: ConfiguracionPdfProgramacion = { weight: {}, preserveSingleLine: [], maxLinesPorColumna: {} };
  headers.forEach((h, i) => {
    const c = COMPACTAS[h] ?? texto[h];
    if (!c) return;
    cfg.weight[i] = c.ancho;
    if (c.linea) cfg.preserveSingleLine.push(i);
    if (c.lineas) cfg.maxLinesPorColumna[i] = c.lineas;
  });
  return cfg;
}
