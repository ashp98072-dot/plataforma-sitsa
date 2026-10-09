import PDFDocument from "pdfkit";
import { existsSync, readFileSync } from "fs";
import { absPathFromRelative } from "@/lib/uploads";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { obtenerFactura } from "@/lib/facturacion/facturas";
import { obtenerPerfilEmpresa } from "@/lib/facturacion/repository";
import { etiquetaTratamientoIva, formatearMonto, resumenTratamientoIva } from "@/lib/facturacion/ui-logica";

/**
 * FACTURA DEMO — representación en PDF, NO FISCAL, de una factura de Facturación (FACT-1/FACT-2), para que Contabilidad
 * valide el formato visual ANTES de integrar la factura electrónica.
 *
 * Qué NO es: no es un documento fiscal y no contiene ningún dato de certificación. El único dato reservado para eso es
 * un recuadro que dice «PENDIENTE FEL»; nada de él se simula (sin identificadores, series, números, autorizaciones,
 * códigos QR, certificador ni fechas de certificación).
 *
 * Datos: SOLO los ya congelados de `fact_facturas` / `fact_factura_viajes`, leídos con `obtenerFactura` (que ya filtra por
 * empresa y prefiere los snapshots a los datos vivos). Nunca se recalcula un importe: cada línea se imprime con el
 * tratamiento de IVA (incluido / agregado), la base, el IVA y el total que quedaron guardados, y los totales del
 * documento se VALIDAN contra la suma de sus líneas (si no coinciden, no se genera el PDF). Una factura anterior al
 * desglose por línea (sin snapshot fiscal) tampoco se genera: habría que inventar importes.
 *
 * PDF: se reutiliza PDFKit (mismo patrón que Gastos/Fondos/Boleta de vacaciones), `dibujarTablaEnDoc` para el detalle,
 * el logo de la empresa por `logo_url` (con el mismo respaldo de solo texto) y los datos del emisor del perfil de
 * Facturación de la empresa (`fact_empresa_perfil`).
 */

export const LEYENDA_NO_FISCAL = "DEMO — DOCUMENTO NO FISCAL";
export const TEXTO_PENDIENTE_FEL = "PENDIENTE FEL";

export type EmisorDemo = {
  razonSocial: string;
  nombreComercial: string | null;
  nit: string | null;
  direccion: string | null;
  logo: Buffer | null;
};

export type LineaDemo = {
  fecha: string;
  codigo: string;
  descripcion: string;
  tarifa: number;
  precioIncluyeIva: boolean;
  base: number;
  iva: number;
  total: number;
};

export type FacturaDemo = {
  emisor: EmisorDemo;
  /** «BORRADOR #12 (sin número)» o el número de la factura Emitida. */
  numero: string;
  estado: "Borrador" | "Emitida";
  etiquetaFecha: string;
  /** YYYY-MM-DD */
  fecha: string;
  moneda: string;
  cliente: { nombre: string; nit: string | null; direccion: string | null };
  lineas: LineaDemo[];
  porcentajeIva: number;
  subtotal: number;
  iva: number;
  total: number;
  /** «IVA incluido en la tarifa» / «IVA agregado a la tarifa» / «Mixto: varía por viaje». */
  resumenIva: string;
};

export type ResultadoFacturaDemo =
  | { ok: true; factura: FacturaDemo }
  | { ok: false; status: 404 | 409; error: string };

const aCentavos = (n: number): number => Math.round(n * 100);
const MENSAJE_SIN_SNAPSHOT =
  "Esta factura es anterior al desglose de IVA por línea: no tiene el snapshot fiscal de cada viaje, así que no se puede generar el PDF demo sin recalcularla.";

type DetalleFactura = NonNullable<Awaited<ReturnType<typeof obtenerFactura>>>;

/**
 * PURA (sin DB). Valida y arma el modelo del PDF a partir de lo congelado. `fechaGeneracion` (YYYY-MM-DD) solo se usa como
 * fecha mostrada para un Borrador, que todavía no tiene fecha de emisión.
 */
export function prepararFacturaDemo(
  detalle: DetalleFactura | null,
  emisor: EmisorDemo,
  fechaGeneracion: string,
): ResultadoFacturaDemo {
  if (!detalle) return { ok: false, status: 404, error: "Factura no encontrada." };
  const { factura: f, viajes } = detalle;
  if (f.estadoAdmin === "Anulada") return { ok: false, status: 409, error: "Una factura Anulada no tiene PDF demo." };
  if (!viajes.length) return { ok: false, status: 409, error: "La factura no tiene viajes." };

  if (f.subtotal == null || f.iva == null || f.porcentajeIva == null) return { ok: false, status: 409, error: MENSAJE_SIN_SNAPSHOT };
  const lineas: LineaDemo[] = [];
  for (const v of viajes) {
    if (v.base == null || v.iva == null || v.total == null || v.precioIncluyeIva == null || v.descripcion == null) {
      return { ok: false, status: 409, error: MENSAJE_SIN_SNAPSHOT };
    }
    if (aCentavos(v.base) + aCentavos(v.iva) !== aCentavos(v.total)) {
      return { ok: false, status: 409, error: `La línea del viaje ${v.codigo} no cuadra (base + IVA ≠ total); no se genera el PDF.` };
    }
    lineas.push({
      fecha: v.fechaPlan,
      codigo: v.codigo,
      descripcion: v.descripcion,
      tarifa: v.montoAsignado,
      precioIncluyeIva: v.precioIncluyeIva,
      base: v.base,
      iva: v.iva,
      total: v.total,
    });
  }

  const suma = (k: "base" | "iva" | "total") => lineas.reduce((s, l) => s + aCentavos(l[k]), 0);
  if (
    suma("base") !== aCentavos(f.subtotal) ||
    suma("iva") !== aCentavos(f.iva) ||
    suma("total") !== aCentavos(f.montoTotal) ||
    aCentavos(f.subtotal) + aCentavos(f.iva) !== aCentavos(f.montoTotal)
  ) {
    return { ok: false, status: 409, error: "Los totales congelados de la factura no coinciden con la suma de sus líneas; no se genera el PDF." };
  }

  const emitida = f.estadoAdmin === "Emitida";
  return {
    ok: true,
    factura: {
      emisor,
      numero: emitida && f.numeroFactura ? f.numeroFactura : `BORRADOR #${f.id} (sin número)`,
      estado: emitida ? "Emitida" : "Borrador",
      etiquetaFecha: emitida && f.fechaEmision ? "Fecha de emisión" : "Fecha (borrador)",
      fecha: emitida && f.fechaEmision ? f.fechaEmision : fechaGeneracion,
      moneda: f.moneda,
      cliente: { nombre: f.cliente, nit: f.clienteNit, direccion: f.clienteDireccion },
      lineas,
      porcentajeIva: f.porcentajeIva,
      subtotal: f.subtotal,
      iva: f.iva,
      total: f.montoTotal,
      resumenIva: resumenTratamientoIva(lineas.map((l) => l.precioIncluyeIva)),
    },
  };
}

/** PDFKit con las fuentes estándar no dibuja «→»; en el PDF se escribe «->». El resto del texto (WinAnsi) se conserva. */
const textoPdf = (s: string): string => s.normalize("NFC").replace(/\s*→\s*/g, " -> ");

const COLOR_TEXTO = "#0f172a";
const COLOR_SUAVE = "#475569";

export async function renderizarFacturaDemo(f: FacturaDemo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "portrait",
      margins: { top: 40, bottom: 52, left: 40, right: 40 },
      bufferPages: true,
      info: { Title: `${LEYENDA_NO_FISCAL} — ${f.numero}`, Subject: "Representación de prueba. Sin validez fiscal." },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;
    const pageBottom = () => doc.page.height - doc.page.margins.bottom - 12;
    const moneda = (v: number) => formatearMonto(v, f.moneda);

    // ── Encabezado: logo + emisor (izquierda) · título y datos del documento (derecha) ──────────────────────────────
    const yTop = doc.y;
    let xEmisor = marginL;
    if (f.emisor.logo) {
      try {
        doc.image(f.emisor.logo, marginL, yTop, { fit: [100, 55] });
        xEmisor = marginL + 112;
      } catch {
        xEmisor = marginL; // logo ilegible: encabezado solo de texto
      }
    }
    const anchoEmisor = 330 - xEmisor;
    let yE = yTop;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_TEXTO).text(textoPdf(f.emisor.razonSocial), xEmisor, yE, { width: anchoEmisor });
    yE = doc.y;
    doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_SUAVE);
    if (f.emisor.nombreComercial && f.emisor.nombreComercial !== f.emisor.razonSocial) {
      doc.text(textoPdf(`Nombre comercial: ${f.emisor.nombreComercial}`), xEmisor, yE, { width: anchoEmisor });
      yE = doc.y;
    }
    doc.text(`NIT: ${f.emisor.nit ?? "pendiente de definir"}`, xEmisor, yE, { width: anchoEmisor });
    yE = doc.y;
    doc.text(textoPdf(`Dirección: ${f.emisor.direccion ?? "pendiente de definir"}`), xEmisor, yE, { width: anchoEmisor });
    yE = doc.y;

    const xDoc = 345;
    const anchoDoc = marginL + pageWidth - xDoc;
    doc.font("Helvetica-Bold").fontSize(19).fillColor(COLOR_TEXTO).text("FACTURA DEMO", xDoc, yTop, { width: anchoDoc, align: "right" });
    let yD = doc.y + 2;
    const anchoEtiqueta = 92;
    const campoDoc = (etiqueta: string, valor: string) => {
      // Dos textos independientes (etiqueta a la izquierda, valor a la derecha): `continued` con alineación derecha los superpone.
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_SUAVE).text(`${etiqueta}:`, xDoc, yD, { width: anchoEtiqueta, lineBreak: false });
      doc.font("Helvetica").fillColor(COLOR_TEXTO).text(textoPdf(valor), xDoc + anchoEtiqueta, yD, { width: anchoDoc - anchoEtiqueta, align: "right", lineBreak: false });
      yD += 13;
    };
    campoDoc("N.º", f.numero);
    campoDoc(f.etiquetaFecha, formatearFechaVisible(f.fecha));
    campoDoc("Moneda", f.moneda === "GTQ" ? "GTQ (Quetzales)" : f.moneda);
    campoDoc("Estado interno", f.estado);

    // ── Leyenda bien visible ────────────────────────────────────────────────────────────────────────────────────────
    const yBanner = Math.max(yE, yD, yTop + 58) + 8;
    doc.save();
    doc.rect(marginL, yBanner, pageWidth, 24).fillAndStroke("#fef3c7", "#b45309");
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#92400e").text(LEYENDA_NO_FISCAL, marginL, yBanner + 6.5, { width: pageWidth, align: "center", lineBreak: false });

    // ── Cliente (datos congelados al crear el borrador) ─────────────────────────────────────────────────────────────
    const yCliente = yBanner + 36;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR_SUAVE).text("CLIENTE", marginL, yCliente, { width: pageWidth });
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COLOR_TEXTO).text(textoPdf(f.cliente.nombre), marginL, doc.y + 1, { width: pageWidth });
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXTO);
    doc.text(`NIT: ${f.cliente.nit ?? "—"}`, marginL, doc.y + 1, { width: pageWidth });
    doc.text(textoPdf(`Dirección: ${f.cliente.direccion ?? "—"}`), marginL, doc.y + 1, { width: pageWidth });
    doc.moveDown(0.8);
    doc.x = marginL;

    // ── Detalle: una fila por viaje, con SU tratamiento de IVA ─────────────────────────────────────────────────────
    const filas = f.lineas.map((l) => [
      formatearFechaVisible(l.fecha),
      l.codigo,
      textoPdf(`${l.descripcion} · Tarifa ${moneda(l.tarifa)} · ${etiquetaTratamientoIva(l.precioIncluyeIva)}`),
      moneda(l.base),
      moneda(l.iva),
      moneda(l.total),
    ]);
    dibujarTablaEnDoc(doc, {
      headers: ["Fecha", "Viaje", "Descripción", "Base", "IVA", "Total"],
      rows: filas,
      align: { 3: "right", 4: "right", 5: "right" },
      weight: { 0: 10, 1: 11, 2: 38, 3: 12, 4: 11, 5: 12 },
      preserveSingleLine: [0, 1, 3, 4, 5],
      maxLines: 4,
    });

    // ── Totales (los congelados; ya validados contra la suma de las líneas) ────────────────────────────────────────
    if (doc.y + 120 > pageBottom()) doc.addPage();
    doc.moveDown(1);
    const xTot = marginL + pageWidth - 230;
    let yT = doc.y;
    const filaTotal = (etiqueta: string, valor: string, fuerte = false) => {
      doc.font(fuerte ? "Helvetica-Bold" : "Helvetica").fontSize(fuerte ? 11 : 9.5).fillColor(COLOR_TEXTO);
      doc.text(etiqueta, xTot, yT, { width: 120, lineBreak: false });
      doc.text(valor, xTot + 120, yT, { width: 110, align: "right", lineBreak: false });
      yT += fuerte ? 18 : 15;
    };
    filaTotal("Subtotal", moneda(f.subtotal));
    filaTotal(`IVA (${f.porcentajeIva} %)`, moneda(f.iva));
    doc.strokeColor("#94a3b8").lineWidth(0.6).moveTo(xTot, yT - 2).lineTo(xTot + 230, yT - 2).stroke();
    filaTotal("TOTAL", moneda(f.total), true);
    doc.x = marginL;
    doc.y = yT + 4;

    doc.font("Helvetica").fontSize(8).fillColor(COLOR_SUAVE).text(
      textoPdf(`Tratamiento de IVA: ${f.resumenIva}. El IVA se calcula línea por línea según el tratamiento guardado de cada viaje; el total es la suma de las líneas.`),
      marginL, doc.y, { width: pageWidth - 240 },
    );

    // ── Espacio reservado: no se simula ningún dato de certificación ────────────────────────────────────────────────
    if (doc.y + 70 > pageBottom()) doc.addPage();
    doc.moveDown(1);
    const yFel = doc.y;
    doc.save();
    doc.rect(marginL, yFel, pageWidth, 44).dash(3, { space: 3 }).stroke("#94a3b8");
    doc.undash();
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLOR_SUAVE).text(`Certificación electrónica: ${TEXTO_PENDIENTE_FEL}`, marginL + 10, yFel + 9, { width: pageWidth - 20 });
    doc.font("Helvetica").fontSize(8).fillColor(COLOR_SUAVE).text(
      "Este documento es solo una representación de prueba del formato. No tiene validez fiscal.",
      marginL + 10, doc.y + 2, { width: pageWidth - 20 },
    );

    // ── Marca de agua y pie en TODAS las páginas ────────────────────────────────────────────────────────────────────
    const rango = doc.bufferedPageRange();
    const generado = formatearTimestampVisible(ahoraLocal());
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      doc.save();
      doc.fillColor("#b91c1c").fillOpacity(0.07);
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font("Helvetica-Bold").fontSize(58).text("DEMO - NO FISCAL", 0, doc.page.height / 2 - 30, { width: doc.page.width, align: "center", lineBreak: false });
      doc.restore();
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(
        `${LEYENDA_NO_FISCAL} · Página ${i + 1} de ${rango.count} · Generado el ${generado} (Guatemala)`,
        marginL, doc.page.height - doc.page.margins.bottom - 12,
        { width: pageWidth, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}

// ── Orquestación (DB) ─────────────────────────────────────────────────────────────────────────────────────────────────

function textoDe(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function leerLogo(logoUrl: string | null | undefined): Buffer | null {
  if (!logoUrl) return null;
  try {
    const abs = absPathFromRelative(logoUrl);
    return existsSync(abs) ? readFileSync(abs) : null;
  } catch {
    return null; // sin logo válido: encabezado solo de texto
  }
}

export type ResultadoPdfFacturaDemo =
  | { ok: true; buffer: Buffer; nombreArchivo: string }
  | { ok: false; status: 404 | 409; error: string };

/**
 * `empresa` viene SIEMPRE del guard del endpoint (nunca del cliente) y `obtenerFactura` filtra por `empresa_id`: pedir la
 * factura de otra empresa es indistinguible de pedir una que no existe (404). Solo LEE: nunca modifica la factura.
 */
export async function generarPdfFacturaDemo(
  empresa: { id: number; nombre: string; logoUrl: string | null },
  facturaId: number,
): Promise<ResultadoPdfFacturaDemo> {
  const detalle = await obtenerFactura(empresa.id, facturaId);
  const perfil = await obtenerPerfilEmpresa(empresa.id);
  const r = perfil.respuestas as Record<string, unknown>;
  const emisor: EmisorDemo = {
    razonSocial: textoDe(r.razon_social_factura) ?? empresa.nombre,
    nombreComercial: textoDe(r.nombre_comercial),
    nit: textoDe(r.nit_emisor),
    direccion: textoDe(r.direccion_fiscal),
    logo: leerLogo(empresa.logoUrl),
  };
  const modelo = prepararFacturaDemo(detalle, emisor, ahoraLocal().slice(0, 10));
  if (!modelo.ok) return modelo;
  return { ok: true, buffer: await renderizarFacturaDemo(modelo.factura), nombreArchivo: `factura-demo-${facturaId}.pdf` };
}
