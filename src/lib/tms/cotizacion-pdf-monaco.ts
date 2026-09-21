import { fechaLarga, type DocumentoComercial } from "./cotizacion-documento";
import { renderDocumentoComercial, type Pdf, type TemaComercial } from "./cotizacion-pdf-layout";

/**
 * COTIZACIONES FASE 6 — plantilla Logiservicios Mónaco: identidad roja / gris.
 * Encabezado sobre fondo blanco con barra roja vertical y nombre en dos
 * líneas, bloque de código y fecha a la derecha, secciones separadas de
 * "Condiciones" y "Observaciones" con títulos en mayúsculas. Sin logotipo: en
 * el repositorio no existe un asset aprobado de Mónaco, así que la marca se
 * compone tipográficamente.
 */

const ROJO = "#b91c1c";
const GRIS_OSCURO = "#374151";
const GRIS = "#6b7280";

function encabezado(doc: Pdf, ancho: number, m: DocumentoComercial) {
  const x = doc.page.margins.left;
  const y = doc.page.margins.top;
  const [primera, ...resto] = m.marca.nombre.split(" ");
  doc.rect(x, y, 5, 46).fill(ROJO);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ROJO).text(primera.toUpperCase(), x + 15, y + 2, { width: ancho * 0.55, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(GRIS_OSCURO).text(resto.join(" ").toUpperCase(), x + 15, y + 17, { width: ancho * 0.55, lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor(GRIS).text("COTIZACIÓN", x, y + 2, { width: ancho, align: "right", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(GRIS_OSCURO).text(m.codigo, x, y + 13, { width: ancho, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text(`Fecha: ${fechaLarga(m.fechaEmision)}`, x, y + 34, { width: ancho, align: "right", lineBreak: false });
  const linea = y + 60;
  doc.moveTo(x, linea).lineTo(x + ancho, linea).lineWidth(0.8).strokeColor("#d1d5db").stroke();
  doc.moveTo(x, linea).lineTo(x + 90, linea).lineWidth(2.4).strokeColor(ROJO).stroke();
  doc.x = x;
  doc.y = linea + 12;
}

const TEMA: TemaComercial = {
  colores: { acento: ROJO, textoSobreAcento: "#ffffff", texto: "#1f2937", suave: GRIS, borde: "#d1d5db", filaAlterna: "#f3f4f6" },
  encabezado,
  seccion: (doc, x, ancho, titulo) => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(ROJO).text(titulo.toUpperCase(), x, y, { width: ancho, characterSpacing: 0.8 });
    const linea = doc.y + 2;
    doc.moveTo(x, linea).lineTo(x + ancho, linea).lineWidth(0.6).strokeColor("#d1d5db").stroke();
    doc.x = x;
    doc.y = linea + 8;
  },
  seccionUnica: false,
  tituloTabla: "Detalle del servicio",
  tituloCondiciones: "Condiciones",
  tituloObservaciones: "Observaciones",
  cabeceraContinuacion: (doc, ancho, m) => {
    const x = doc.page.margins.left;
    const y = doc.page.margins.top - 20;
    doc.rect(x, y, 3, 14).fill(ROJO);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GRIS_OSCURO).text(`${m.marca.nombre} · ${m.codigo}`, x + 10, y + 2, { width: ancho - 10, lineBreak: false });
    doc.x = x;
    doc.y = y + 26;
  },
  pie: (doc, pagina, total, ancho, m) => {
    const x = doc.page.margins.left;
    const y = doc.page.height - 44;
    doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(0.6).strokeColor("#d1d5db").stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(ROJO).text(m.marca.nombre, x, y + 8, { width: ancho * 0.6, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(`Página ${pagina} de ${total}`, x, y + 8, { width: ancho, align: "right", lineBreak: false });
  },
};

export function cotizacionPdfMonaco(modelo: DocumentoComercial): Promise<Buffer> {
  return renderDocumentoComercial(TEMA, modelo);
}
