import { LOGO_KUIQTRANS_HEADER, LOGO_KUIQTRANS_WATERMARK } from "./cotizacion-pdf-assets";
import { fechaLarga, type DocumentoComercial } from "./cotizacion-documento";
import { dibujarImagen, dibujarMarcaDeAgua, renderDocumentoComercial, type Pdf, type TemaComercial } from "./cotizacion-pdf-layout";

/**
 * COTIZACIONES — plantilla KuiqTrans: identidad azul / gris, con el LOGO
 * REAL de la marca (ver cotizacion-pdf-assets.ts) — nunca se redibuja con
 * PDFKit/texto. El asset oficial es un lockup con texto oscuro sobre fondo
 * transparente (no blanco-sobre-azul): el encabezado va sobre fondo blanco,
 * igual que la hoja, con líneas de acento discretas en vez de una banda de
 * color sólido — así el logo se muestra tal cual, sin alterar sus colores
 * ni forzarlo sobre un fondo que no le corresponde. Tabla con encabezado
 * azul y filas alternas, y una sola sección "Observaciones y condiciones".
 * Marca de agua: el ícono circular, centrado en el centro físico de cada
 * página. Documento sin firma: se emite y envía en formato digital, nunca
 * en papel.
 */

const AZUL = "#1851da";
const AZUL_OSCURO = "#0b3284";
const GRIS = "#64748b";
const GRIS_CLARO = "#cbd5e1";

const LOGO_ANCHO = 190;

function encabezado(doc: Pdf, ancho: number, m: DocumentoComercial) {
  const x = doc.page.margins.left;
  const y = doc.page.margins.top;
  const logo = dibujarImagen(doc, LOGO_KUIQTRANS_HEADER, x, y, LOGO_ANCHO);
  doc.font("Helvetica").fontSize(8).fillColor(GRIS).text("PROPUESTA COMERCIAL", x, y + 2, { width: ancho, align: "right", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(AZUL_OSCURO).text(m.codigo, x, y + 13, { width: ancho, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text(`Fecha: ${fechaLarga(m.fechaEmision)}`, x, y + 34, { width: ancho, align: "right", lineBreak: false });
  const linea = y + Math.max(logo.height, 60);
  doc.moveTo(x, linea).lineTo(x + ancho, linea).lineWidth(0.8).strokeColor(GRIS_CLARO).stroke();
  doc.moveTo(x, linea).lineTo(x + 90, linea).lineWidth(2.4).strokeColor(AZUL).stroke();
  doc.x = x;
  doc.y = linea + 12;
}

const TEMA: TemaComercial = {
  colores: { acento: AZUL, textoSobreAcento: "#ffffff", texto: "#0f172a", suave: GRIS, borde: GRIS_CLARO, filaAlterna: "#f1f5f9" },
  // Ícono real (fondo ya enmascarado a transparente y horneado a baja opacidad en el propio PNG —
  // ver cotizacion-pdf-assets.ts): se dibuja tal cual, sin `doc.opacity()` adicional.
  marcaDeAgua: (doc) => dibujarMarcaDeAgua(doc, LOGO_KUIQTRANS_WATERMARK, { anchoDestino: 300 }),
  encabezado,
  seccion: (doc, x, ancho, titulo) => {
    const y = doc.y;
    doc.rect(x, y, 4, 14).fill(AZUL);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(AZUL_OSCURO).text(titulo, x + 10, y + 1, { width: ancho - 10 });
    const linea = doc.y + 4;
    doc.moveTo(x, linea).lineTo(x + ancho, linea).lineWidth(0.6).strokeColor(GRIS_CLARO).stroke();
    doc.x = x;
    doc.y = linea + 10;
  },
  seccionUnica: true,
  tituloTabla: "Propuesta comercial",
  tituloCondiciones: "Observaciones y condiciones",
  tituloObservaciones: "Observaciones",
  cabeceraContinuacion: (doc, ancho, m) => {
    const x = doc.page.margins.left;
    const y = doc.page.margins.top - 20;
    doc.rect(x, y, 3, 14).fill(AZUL);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(AZUL_OSCURO).text(`${m.marca.nombre} · ${m.codigo}`, x + 10, y + 2, { width: ancho - 10, lineBreak: false });
    doc.x = x;
    doc.y = y + 26;
  },
  pie: (doc, pagina, total, ancho, m) => {
    const x = doc.page.margins.left;
    const y = doc.page.height - 44;
    doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(0.6).strokeColor(GRIS_CLARO).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(AZUL).text(m.marca.nombre, x, y + 8, { width: ancho * 0.6, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(`Página ${pagina} de ${total}`, x, y + 8, { width: ancho, align: "right", lineBreak: false });
  },
};

export function cotizacionPdfKuiqtrans(modelo: DocumentoComercial): Promise<Buffer> {
  return renderDocumentoComercial(TEMA, modelo);
}
