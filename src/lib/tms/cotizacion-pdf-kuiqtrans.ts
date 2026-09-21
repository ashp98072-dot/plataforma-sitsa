import { fechaLarga, type DocumentoComercial } from "./cotizacion-documento";
import { renderDocumentoComercial, type Pdf, type TemaComercial } from "./cotizacion-pdf-layout";

/**
 * COTIZACIONES FASE 6 — plantilla KuiqTrans: identidad azul / gris.
 * Encabezado en banda azul de página completa con el nombre en blanco,
 * tabla con encabezado azul y filas alternas, y una sola sección
 * "Observaciones y condiciones". Sin logotipo: en el repositorio no existe un
 * asset aprobado de KuiqTrans, así que la marca se compone tipográficamente.
 */

const AZUL = "#1d4ed8";
const AZUL_OSCURO = "#0f2a5c";
const GRIS = "#64748b";

const BANDA_ALTO = 74;

function encabezado(doc: Pdf, ancho: number, m: DocumentoComercial) {
  const x = doc.page.margins.left;
  doc.rect(0, 0, doc.page.width, BANDA_ALTO).fill(AZUL);
  doc.rect(0, BANDA_ALTO, doc.page.width, 3).fill(AZUL_OSCURO);
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#ffffff").text(m.marca.nombre, x, 20, { width: ancho * 0.6, lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor("#dbeafe").text("Transporte y logística", x, 50, { width: ancho * 0.6, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor("#dbeafe").text("PROPUESTA COMERCIAL", x, 18, { width: ancho, align: "right", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text(m.codigo, x, 30, { width: ancho, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor("#ffffff").text(`Fecha: ${fechaLarga(m.fechaEmision)}`, x, 52, { width: ancho, align: "right", lineBreak: false });
  doc.x = x;
  doc.y = BANDA_ALTO + 3 + 14;
}

const TEMA: TemaComercial = {
  colores: { acento: AZUL, textoSobreAcento: "#ffffff", texto: "#0f172a", suave: GRIS, borde: "#cbd5e1", filaAlterna: "#f1f5f9" },
  encabezado,
  seccion: (doc, x, ancho, titulo) => {
    const y = doc.y;
    doc.rect(x, y, 4, 14).fill(AZUL);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(AZUL_OSCURO).text(titulo, x + 10, y + 1, { width: ancho - 10 });
    doc.x = x;
    doc.y = y + 22;
  },
  seccionUnica: true,
  tituloTabla: "Propuesta comercial",
  tituloCondiciones: "Observaciones y condiciones",
  tituloObservaciones: "Observaciones",
  cabeceraContinuacion: (doc, ancho, m) => {
    const x = doc.page.margins.left;
    doc.rect(0, 0, doc.page.width, 26).fill(AZUL);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(`${m.marca.nombre} · ${m.codigo}`, x, 9, { width: ancho, lineBreak: false });
    doc.x = x;
    doc.y = 26 + 16;
  },
  pie: (doc, pagina, total, ancho, m) => {
    const x = doc.page.margins.left;
    const y = doc.page.height - 44;
    doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(1.2).strokeColor(AZUL).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(`${m.marca.nombre} · Propuesta comercial ${m.codigo}`, x, y + 8, { width: ancho * 0.7, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(`Página ${pagina} de ${total}`, x, y + 8, { width: ancho, align: "right", lineBreak: false });
  },
};

export function cotizacionPdfKuiqtrans(modelo: DocumentoComercial): Promise<Buffer> {
  return renderDocumentoComercial(TEMA, modelo);
}
