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
 * public/brands/kuiqtrans/logo-header.png     — lockup completo (ícono +
 *                                          "KUIQTRANS" + slogan) sobre el
 *                                          azul de marca, para el encabezado.
 * public/brands/kuiqtrans/logo-watermark.png  — SOLO el ícono circular,
 *                                          recortado y con el fondo azul ya
 *                                          enmascarado a transparente y el
 *                                          trazo horneado a opacidad baja en
 *                                          el propio PNG (no depende de
 *                                          `doc.opacity()` sobre un fondo
 *                                          coloreado).
 *
 * IMPORTANTE — origen de estos archivos: negocio proporcionó como
 * referencia el diseño OFICIAL completo de cada marca (una propuesta ya
 * maquetada), no el logotipo aislado en un archivo vectorial/transparente
 * separado. Estos PNG son un RECORTE de esa referencia — el logo real, tal
 * cual, no una reconstrucción — pero no un asset vectorial oficial. Si
 * negocio entrega más adelante el archivo oficial (PNG con fondo
 * transparente o SVG), basta reemplazar estos 3 archivos sin tocar código.
 */
const RAIZ_MARCAS = join(process.cwd(), "public", "brands");

function leerAsset(...segmentos: string[]): Buffer {
  return readFileSync(join(RAIZ_MARCAS, ...segmentos));
}

export const LOGO_MONACO = leerAsset("monaco", "logo.png");
export const LOGO_KUIQTRANS_HEADER = leerAsset("kuiqtrans", "logo-header.png");
export const LOGO_KUIQTRANS_WATERMARK = leerAsset("kuiqtrans", "logo-watermark.png");
