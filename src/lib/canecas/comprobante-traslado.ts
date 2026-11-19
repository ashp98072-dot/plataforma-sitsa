import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type ComprobanteTraslado = {
  empresa: string; numero: string; origen: string; destino: string; fecha: string;
  entrega: string; transporte: string; observaciones: string;
  detalles: { partidaId: number; producto: string; presentacion: string; cantidad: number }[];
  recepciones: { fecha: string; recibe: string; condicion: string; observaciones: string; partidas: { partidaId: number; recibido: number; faltante: number; motivo: string }[] }[];
};

// Las fuentes PDF estándar cubren WinAnsi. Sustituir caracteres no representables
// evita que un nombre arbitrario haga fallar toda la impresión.
function texto(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/[^\u0020-\u007e\u00a0-\u00ff\u20ac\u2013\u2014\u2018\u2019\u201c\u201d]/g, "?");
}

export async function generarComprobanteTraslado(datos: ComprobanteTraslado, logo: Buffer | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const margin = 42;
  const width = 511;
  const linea = (raw: unknown, size = 10, font: PDFFont = regular) => {
    let restante = texto(raw);
    if (!restante) restante = " ";
    while (restante.length) {
      if (y < 55) { page = pdf.addPage([595.28, 841.89]); y = 800; }
      let n = restante.length;
      while (n > 1 && font.widthOfTextAtSize(restante.slice(0, n), size) > width) n--;
      if (n < restante.length) { const corte = restante.lastIndexOf(" ", n); if (corte > 0) n = corte; }
      page.drawText(restante.slice(0, n), { x: margin, y, size, font, color: rgb(0.16, 0.16, 0.16) });
      restante = restante.slice(n).trimStart(); y -= size + 5;
    }
  };
  if (logo) {
    const png = logo.length > 8 && logo.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = logo.length > 3 && logo[0] === 0xff && logo[1] === 0xd8;
    if (!png && !jpg) throw new Error("LOGO_FORMATO_INVALIDO");
    const imagen = png ? await pdf.embedPng(logo) : await pdf.embedJpg(logo);
    const escala = Math.min(150 / imagen.width, 48 / imagen.height);
    page.drawImage(imagen, { x: margin, y: y - 40, width: imagen.width * escala, height: imagen.height * escala });
    y -= 58;
  }
  linea(datos.empresa, 16, negrita);
  linea("COMPROBANTE DE TRASLADO DE CANECAS", 13, negrita);
  linea(`Número: ${datos.numero}    Fecha de envío: ${datos.fecha}`);
  linea(`Origen: ${datos.origen}    Destino: ${datos.destino}`);
  linea(`Entrega: ${datos.entrega}    Transporte: ${datos.transporte || "No aplica"}`);
  linea(`Observaciones: ${datos.observaciones || "Sin observaciones"}`);
  y -= 8; linea("DETALLE DEL ENVÍO", 11, negrita);
  for (const d of datos.detalles) linea(`${d.producto} | ${d.presentacion} | Enviado: ${d.cantidad}`);
  y -= 8; linea("RECEPCIONES", 11, negrita);
  if (!datos.recepciones.length) linea("Pendiente de recepción.");
  for (const r of datos.recepciones) {
    linea(`Fecha: ${r.fecha} | Recibe: ${r.recibe} | Condición: ${r.condicion}`, 10, negrita);
    linea(`Observaciones: ${r.observaciones || "Sin observaciones"}`);
    for (const p of r.partidas) {
      const detalle = datos.detalles.find(d => d.partidaId === p.partidaId);
      linea(`${detalle?.producto ?? "Partida"} | Recibido: ${p.recibido} | Faltante: ${p.faltante}${p.motivo ? ` | Motivo: ${p.motivo}` : ""}`);
    }
  }
  y -= 20;
  if (y < 135) { page = pdf.addPage([595.28, 841.89]); y = 800; }
  linea("Firmas físicas", 11, negrita); y -= 25;
  linea("________________________    ________________________    ________________________");
  linea("Entrega                                            Transporte                                        Recibe");
  return pdf.save();
}

