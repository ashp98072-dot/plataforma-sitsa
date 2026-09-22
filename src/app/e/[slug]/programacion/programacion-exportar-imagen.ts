"use client";

import {
  ALTO_FILA,
  ALTO_FILA_CABECERA,
  COLUMNAS_IMAGEN,
  construirLayoutImagen,
  type EncabezadoProgramacionImagen,
  type FilaProgramacionImagen,
} from "@/lib/tms/programacion-imagen";

/**
 * PROGRAMACION-EXPORT-IMAGEN-1 — dibuja el reporte de Programación como
 * PNG/JPG usando el Canvas 2D nativo del navegador: sin dependencia nueva
 * (nada de `canvas`/`puppeteer`/html2canvas — ese tipo de librería suele
 * requerir un binario nativo, frágil de desplegar en Hostinger). Es
 * deliberadamente un REPORTE dibujado (encabezado, tabla con bordes,
 * filas alternas), no una captura cruda de la pantalla.
 *
 * AJUSTE (negocio pidió que se vea igual al reporte tradicional): la
 * paleta de colores de abajo es la MISMA que ya usa el PDF tradicional de
 * Programación (dibujarTitulo/pdfTabla en src/lib/rrhh/export-files.ts) —
 * fondo blanco, encabezado de tabla azul marino #1e3a5f con texto blanco,
 * filas blancas/gris muy claro alternadas, texto casi negro, bordes
 * finos — copiada literalmente de esos mismos valores hexadecimales, no
 * inventada de nuevo aquí.
 *
 * TODA la lógica de negocio (qué va en cada columna, anchos, paginación)
 * ya viene resuelta por construirLayoutImagen (programacion-imagen.ts,
 * módulo puro y probado en Node) — este archivo solo pinta lo que esa
 * función ya decidió, y no se puede probar con vitest (usa `document`,
 * `canvas`, `Blob`) — motivo por el que la lógica se separó.
 */

const COLOR_FONDO = "#ffffff";
const COLOR_TITULO = "#0f172a";
const COLOR_SUBTITULO = "#475569";
const COLOR_ENCABEZADO_TABLA = "#1e3a5f";
const COLOR_TEXTO_ENCABEZADO_TABLA = "#ffffff";
const COLOR_BORDE_ENCABEZADO_TABLA = "#0f172a";
const COLOR_TEXTO = "#0f172a";
const COLOR_BORDE_CELDA = "#e2e8f0";
const COLOR_BORDE_TABLA = "#94a3b8";
const COLOR_FILA_ALTERNA = "#f1f5f9";
const PAD_X = 8;
const MARGEN = 24;

function truncar(ctx: CanvasRenderingContext2D, texto: string, anchoMax: number): string {
  if (ctx.measureText(texto).width <= anchoMax) return texto;
  let recortado = texto;
  while (recortado.length > 1 && ctx.measureText(`${recortado}…`).width > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return `${recortado}…`;
}

function dibujarPagina(
  encabezadoTitulo: string,
  encabezadoSubtitulo: string,
  anchoColumnas: number[],
  filas: string[][],
  anchoLienzo: number,
  altoEncabezado: number,
): HTMLCanvasElement {
  const anchoTabla = anchoColumnas.reduce((s, a) => s + a, 0);
  const altoTabla = ALTO_FILA_CABECERA + filas.length * ALTO_FILA;
  const alto = altoEncabezado + altoTabla + MARGEN * 2;
  const ancho = anchoTabla + MARGEN * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(ancho, anchoLienzo);
  canvas.height = alto;
  const ctx = canvas.getContext("2d")!;

  // Fondo BLANCO de toda la imagen (mismo criterio que el PDF tradicional: nunca un tema oscuro).
  ctx.fillStyle = COLOR_FONDO;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textBaseline = "top";
  ctx.fillStyle = COLOR_TITULO;
  ctx.font = "bold 22px Arial, sans-serif";
  ctx.fillText(encabezadoTitulo, MARGEN, 18);
  ctx.fillStyle = COLOR_SUBTITULO;
  ctx.font = "13px Arial, sans-serif";
  ctx.fillText(encabezadoSubtitulo, MARGEN, 50);

  let y = altoEncabezado;
  let x = MARGEN;
  ctx.fillStyle = COLOR_ENCABEZADO_TABLA;
  ctx.fillRect(MARGEN, y, anchoTabla, ALTO_FILA_CABECERA);
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillStyle = COLOR_TEXTO_ENCABEZADO_TABLA;
  COLUMNAS_IMAGEN.forEach((col, i) => {
    const w = anchoColumnas[i];
    const texto = truncar(ctx, col.titulo, w - PAD_X * 2);
    if (col.alinear === "right") ctx.fillText(texto, x + w - PAD_X - ctx.measureText(texto).width, y + 11);
    else ctx.fillText(texto, x + PAD_X, y + 11);
    x += w;
  });
  // Contorno del encabezado de tabla (mismo #0f172a que el PDF tradicional).
  ctx.strokeStyle = COLOR_BORDE_ENCABEZADO_TABLA;
  ctx.lineWidth = 0.75;
  ctx.strokeRect(MARGEN, y, anchoTabla, ALTO_FILA_CABECERA);
  y += ALTO_FILA_CABECERA;

  ctx.font = "13px Arial, sans-serif";
  filas.forEach((celdas, indice) => {
    if (indice % 2 === 1) {
      ctx.fillStyle = COLOR_FILA_ALTERNA;
      ctx.fillRect(MARGEN, y, anchoTabla, ALTO_FILA);
    }
    x = MARGEN;
    ctx.fillStyle = COLOR_TEXTO;
    celdas.forEach((valor, i) => {
      const w = anchoColumnas[i];
      const texto = truncar(ctx, valor || "", w - PAD_X * 2);
      if (COLUMNAS_IMAGEN[i]?.alinear === "right") ctx.fillText(texto, x + w - PAD_X - ctx.measureText(texto).width, y + 9);
      else ctx.fillText(texto, x + PAD_X, y + 9);
      x += w;
    });
    y += ALTO_FILA;
  });

  // Bordes finos: contorno exterior de toda la tabla + líneas horizontales
  // entre filas + líneas verticales entre columnas — mismos colores que ya
  // usa pdfTabla() en export-files.ts (#94a3b8 exterior, #e2e8f0 interior).
  ctx.strokeStyle = COLOR_BORDE_TABLA;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGEN, altoEncabezado, anchoTabla, altoTabla);

  ctx.strokeStyle = COLOR_BORDE_CELDA;
  ctx.lineWidth = 0.5;
  let yLinea = altoEncabezado + ALTO_FILA_CABECERA;
  for (let i = 0; i < filas.length; i++) {
    ctx.beginPath();
    ctx.moveTo(MARGEN, yLinea);
    ctx.lineTo(MARGEN + anchoTabla, yLinea);
    ctx.stroke();
    yLinea += ALTO_FILA;
  }
  let xLinea = MARGEN;
  anchoColumnas.slice(0, -1).forEach((w) => {
    xLinea += w;
    ctx.beginPath();
    ctx.moveTo(xLinea, altoEncabezado);
    ctx.lineTo(xLinea, altoEncabezado + altoTabla);
    ctx.stroke();
  });

  return canvas;
}

function canvasABlob(canvas: HTMLCanvasElement, tipo: "image/png" | "image/jpeg"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen."))), tipo, tipo === "image/jpeg" ? 0.92 : undefined);
  });
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Genera y descarga el reporte de Programación como imagen(es) — una
 * descarga por página (casi siempre una sola; ver ALTO_MAXIMO_LIENZO en
 * programacion-imagen.ts). `formato` por defecto PNG (mejor nitidez de
 * texto, pedido explícito del ticket); JPG queda disponible como opción.
 */
export async function exportarProgramacionComoImagen(
  encabezado: EncabezadoProgramacionImagen,
  filas: FilaProgramacionImagen[],
  opts: { formato?: "png" | "jpeg"; nombreBase?: string } = {},
): Promise<{ paginas: number }> {
  const formato = opts.formato ?? "png";
  const tipo = formato === "jpeg" ? "image/jpeg" : "image/png";
  const extension = formato === "jpeg" ? "jpg" : "png";
  const nombreBase = opts.nombreBase ?? "programacion";

  const altoEncabezado = 90;
  const layout = construirLayoutImagen(encabezado, filas, { altoEncabezado });

  for (let i = 0; i < layout.paginas.length; i++) {
    const canvas = dibujarPagina(
      layout.encabezado.titulo,
      layout.encabezado.subtitulo,
      layout.anchoColumnas,
      layout.paginas[i],
      layout.anchoColumnas.reduce((s, a) => s + a, 0) + MARGEN * 2,
      altoEncabezado,
    );
    const blob = await canvasABlob(canvas, tipo);
    const sufijo = layout.totalPaginas > 1 ? `-pagina-${i + 1}-de-${layout.totalPaginas}` : "";
    descargarBlob(blob, `${nombreBase}${sufijo}.${extension}`);
  }

  return { paginas: layout.totalPaginas };
}
