import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Logos REALES de cada marca para el PDF comercial de Cotizaciones — se leen
 * de disco (mismo patrón que ya usa evidencias/route.ts con
 * `join(process.cwd(), …)`) en vez de redibujarse con PDFKit/texto.
 *
 * public/brands/monaco/logo.png        — encabezado y marca de agua (mismo
 *                                          archivo: el fondo de la imagen ya
 *                                          es blanco, igual que la hoja).
 * public/brands/kuiqtrans/logo-header.png     — lockup horizontal completo
 *                                          (ícono + "KUIQTRANS" + slogan),
 *                                          recorte con bbox exacto de un PNG
 *                                          con transparencia real entregado
 *                                          por negocio (1037×301 — mucho más
 *                                          resolución que el mínimo necesario
 *                                          en el PDF, para que no se vea
 *                                          pixelado ni ampliado). Se dibuja
 *                                          sobre fondo blanco (ver
 *                                          cotizacion-pdf-kuiqtrans.ts): el
 *                                          asset oficial es texto oscuro
 *                                          sobre transparente, nunca se
 *                                          recoloreó para forzarlo sobre un
 *                                          fondo azul.
 * public/brands/kuiqtrans/logo-watermark.png  — SOLO el ícono circular,
 *                                          recortado (445×443) del mismo PNG
 *                                          con transparencia real. El canal
 *                                          alfa original se escaló a ~8% de
 *                                          opacidad y quedó horneado en el
 *                                          propio PNG (no depende de
 *                                          `doc.opacity()` sobre un fondo
 *                                          coloreado, y el fondo detrás del
 *                                          ícono es transparencia real, no
 *                                          una máscara por luminancia).
 *
 * Ambos archivos de KuiqTrans son un RECORTE del logo oficial que entregó
 * negocio (PNG de alta resolución con transparencia real) — el logo tal
 * cual, en su color y proporción originales, nunca una reconstrucción
 * tipográfica ni un recoloreo. Si negocio entrega más adelante un SVG
 * oficial, basta reemplazar estos archivos sin tocar código.
 */
const RAIZ_MARCAS = join(process.cwd(), "public", "brands");

function leerAsset(...segmentos: string[]): Buffer {
  return readFileSync(join(RAIZ_MARCAS, ...segmentos));
}

export const LOGO_MONACO = leerAsset("monaco", "logo.png");
export const LOGO_KUIQTRANS_HEADER = leerAsset("kuiqtrans", "logo-header.png");
export const LOGO_KUIQTRANS_WATERMARK = leerAsset("kuiqtrans", "logo-watermark.png");
