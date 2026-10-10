import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { existsSync, readFileSync, statSync } from "fs";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { obtenerFactura } from "@/lib/facturacion/facturas";
import { obtenerPerfilEmpresa } from "@/lib/facturacion/repository";
import { totalEnLetras } from "@/lib/facturacion/numero-letras";
import { formatearMonto } from "@/lib/facturacion/ui-logica";

/**
 * FACTURA DEMO — representación en PDF, NO FISCAL, de una factura de Facturación (FACT-1/FACT-2), para que Contabilidad
 * valide el formato visual ANTES de integrar la factura electrónica.
 *
 * FORMATO: sigue la factura que la empresa usa hoy (referencia «FRAIJANES 4855»): emisor a la izquierda, bloque tributario
 * y fecha DÍA/MES/AÑO a la derecha, cliente en bloque, detalle CÓDIGO / DESCRIPCIÓN / TOTAL, total en letras, leyenda,
 * observaciones, TOTAL y datos de certificación al pie. NO se muestran Base ni IVA por línea: se guardan y VALIDAN
 * internamente (ver abajo), pero la representación visual es la del documento real.
 *
 * Qué NO es: no es un documento fiscal y no contiene ningún dato de certificación. Los espacios del formato real que
 * corresponden a la certificación (serie, número, autorización, certificador, NIT del certificador y el recuadro del
 * código QR) dicen «PENDIENTE FEL»; nada de ello se simula.
 *
 * Datos: SOLO los ya congelados de `fact_facturas` / `fact_factura_viajes`, leídos con `obtenerFactura` (que ya filtra por
 * empresa y prefiere los snapshots a los datos vivos). Nunca se recalcula un importe: cada línea conserva el tratamiento
 * de IVA, la base, el IVA y el total que quedaron guardados, y los totales del documento se VALIDAN contra la suma de sus
 * líneas (si no coinciden, no se genera el PDF). Una factura anterior al desglose por línea (sin snapshot fiscal)
 * tampoco se genera: habría que inventar importes.
 *
 * Datos que el formato real tiene y la plataforma AÚN NO modela (no se inventan; salen como «Pendiente de definir»):
 * teléfono del emisor, condiciones de pago de la factura y leyenda tributaria. El código de cliente es el único dato no
 * congelado que se lee (`clientes.codigo`, filtrado por empresa); no es un dato fiscal del snapshot.
 *
 * FACTURA ANULADA (FACT-3): también tiene PDF demo. Sus líneas salen del histórico que se conserva al anular
 * (`fact_factura_viajes_anuladas`, solo su fotografía; nunca datos vivos) y el documento lleva la marca «ANULADA» muy
 * visible, además de «DEMO — DOCUMENTO NO FISCAL». Una factura anulada ANTES de FACT-3 perdió sus líneas y no se
 * reconstruye: responde 409 con el motivo.
 *
 * LOGO OBLIGATORIO: la factura siempre muestra el logo de la empresa emisora (`empresas.logo_url` de la empresa del guard,
 * nunca una ruta del cliente ni el logo de otra empresa). Si falta, el archivo no existe, no es legible por PDFKit o su
 * ruta apunta al directorio de otra empresa, NO se genera el PDF (409): no hay respaldo silencioso a solo texto.
 *
 * PDF: se reutiliza PDFKit (mismo patrón que Gastos/Fondos/Boleta de vacaciones) y los datos del emisor del perfil de
 * Facturación de la empresa (`fact_empresa_perfil`).
 */

export const LEYENDA_NO_FISCAL = "DEMO — DOCUMENTO NO FISCAL";
export const TEXTO_PENDIENTE_FEL = "PENDIENTE FEL";
export const TEXTO_PENDIENTE_DEFINIR = "Pendiente de definir";
export const MARCA_ANULADA = "ANULADA";
export const MENSAJE_ANULADA_SIN_DETALLE =
  "Esta factura se anuló antes de que se conservara el histórico de sus viajes: no hay detalle que mostrar y no se reconstruye con datos vivos.";
export const MENSAJE_SIN_LOGO = "Esta empresa no tiene un logo válido configurado para la factura.";

export type EmisorDemo = {
  razonSocial: string;
  nombreComercial: string | null;
  nit: string | null;
  direccion: string | null;
  /** La plataforma todavía no guarda el teléfono del emisor: hoy llega siempre `null`. */
  telefono: string | null;
};

/** Datos del formato real que no están en el snapshot de la factura. `null` = pendiente de definir. */
export type ComplementosDemo = {
  clienteCodigo: string | null;
  condiciones: string | null;
  leyendaTributaria: string | null;
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
  /** «BORRADOR #12 (sin número)» o el número de la factura Emitida; es el «No. interno» y el correlativo interno. */
  numero: string;
  estado: "Borrador" | "Emitida" | "Anulada";
  /** «Fecha de emisión» / «Fecha del borrador (sin emitir)» / «Fecha de anulación». */
  etiquetaFecha: string;
  /** YYYY-MM-DD */
  fecha: string;
  moneda: string;
  cliente: { nombre: string; nit: string | null; direccion: string | null; codigo: string | null };
  condiciones: string | null;
  observaciones: string | null;
  leyendaTributaria: string | null;
  lineas: LineaDemo[];
  porcentajeIva: number;
  subtotal: number;
  iva: number;
  total: number;
};

export type ResultadoFacturaDemo =
  | { ok: true; factura: FacturaDemo }
  | { ok: false; status: 404 | 409; error: string };

const aCentavos = (n: number): number => Math.round(n * 100);
/** «YYYY-MM-DD» → «DD/MM/YYYY». */
const fmtFecha = (iso: string): string => iso.split("-").reverse().join("/");
const MENSAJE_SIN_SNAPSHOT =
  "Esta factura es anterior al desglose de IVA por línea: no tiene el snapshot fiscal de cada viaje, así que no se puede generar el PDF demo sin recalcularla.";

type DetalleFactura = NonNullable<Awaited<ReturnType<typeof obtenerFactura>>>;

const SIN_COMPLEMENTOS: ComplementosDemo = { clienteCodigo: null, condiciones: null, leyendaTributaria: null };

/**
 * PURA (sin DB). Valida y arma el modelo del PDF a partir de lo congelado. `fechaGeneracion` (YYYY-MM-DD) solo se usa como
 * fecha mostrada para un Borrador, que todavía no tiene fecha de emisión.
 */
export function prepararFacturaDemo(
  detalle: DetalleFactura | null,
  emisor: EmisorDemo,
  fechaGeneracion: string,
  complementos: ComplementosDemo = SIN_COMPLEMENTOS,
): ResultadoFacturaDemo {
  if (!detalle) return { ok: false, status: 404, error: "Factura no encontrada." };
  const { factura: f, viajes } = detalle;
  const anulada = f.estadoAdmin === "Anulada";
  if (!viajes.length) {
    return { ok: false, status: 409, error: anulada ? MENSAJE_ANULADA_SIN_DETALLE : "La factura no tiene viajes." };
  }

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
  // Una anulada conserva el número y la fecha que tenía; si nunca los tuvo, la fecha mostrada es la de la anulación.
  const fechaAnulacion = detalle.anulacion?.fecha ? detalle.anulacion.fecha.slice(0, 10) : null;
  const numero = anulada
    ? (f.numeroFactura ?? `ANULADA #${f.id} (sin número)`)
    : emitida && f.numeroFactura ? f.numeroFactura : `BORRADOR #${f.id} (sin número)`;
  const etiquetaFecha = anulada
    ? (f.fechaEmision ? "Fecha de emisión" : fechaAnulacion ? "Fecha de anulación" : "Fecha de generación")
    : emitida && f.fechaEmision ? "Fecha de emisión" : "Fecha del borrador (sin emitir)";
  const fecha = anulada
    ? (f.fechaEmision ?? fechaAnulacion ?? fechaGeneracion)
    : emitida && f.fechaEmision ? f.fechaEmision : fechaGeneracion;
  return {
    ok: true,
    factura: {
      emisor,
      numero,
      estado: anulada ? "Anulada" : emitida ? "Emitida" : "Borrador",
      etiquetaFecha: anulada && detalle.anulacion?.fecha && f.fechaEmision
        ? `${etiquetaFecha} · anulada el ${fmtFecha(detalle.anulacion.fecha.slice(0, 10))}`
        : etiquetaFecha,
      fecha,
      moneda: f.moneda,
      cliente: { nombre: f.cliente, nit: f.clienteNit, direccion: f.clienteDireccion, codigo: complementos.clienteCodigo },
      condiciones: complementos.condiciones,
      observaciones: f.observaciones?.trim() ? f.observaciones.trim() : null,
      leyendaTributaria: complementos.leyendaTributaria,
      lineas,
      porcentajeIva: f.porcentajeIva,
      subtotal: f.subtotal,
      iva: f.iva,
      total: f.montoTotal,
    },
  };
}

/**
 * PDFKit con las fuentes estándar solo dibuja WinAnsi. La descripción congelada («Servicio de transporte – ORIGEN →
 * DESTINO – 27/08/2026») se imprime como en la factura actual: «SERVICIO DE TRANSPORTE - ORIGEN A DESTINO - 27/08/2026».
 * Solo el guion «–» (U+2013) es separador: el «—» (U+2014) marca un origen o destino desconocido y se conserva.
 */
export const descripcionVisible = (s: string): string =>
  s.normalize("NFC").replace(/\s*→\s*/g, " A ").replace(/\s+–\s+/g, " - ").replace(/\s+/g, " ").trim().toLocaleUpperCase("es");

/** Texto libre (nombres, direcciones, observaciones): solo se normaliza; «→» no existe en WinAnsi. */
const textoPdf = (s: string): string => s.normalize("NFC").replace(/\s*→\s*/g, " -> ");

const NEGRO = "#111111";
const GRIS_TEXTO = "#4b5563";
const GRIS_BANDA = "#d9d9d9";
const LINEA = 0.7;

// ── Geometría (puntos; carta 612 × 792). Todas las páginas comparten el mismo marco. ──────────────────────────────────
const M = 28;
const ANCHO = 556;
const DER = M + ANCHO;
const Y_FRANJA = 10;
const Y_ENC = 32;
const X_DTE = 344;
const W_DTE = DER - X_DTE;
const Y_CUERPO = 182;
const Y_CLIENTE_FIN = Y_CUERPO + 84;
const Y_TABLA_ENC = Y_CLIENTE_FIN;
const H_TABLA_ENC = 17;
const Y_DETALLE = Y_TABLA_ENC + H_TABLA_ENC;
const Y_FIN_CUERPO = 664;
const H_BLOQUE_INF = 72;
const H_LETRAS = 22;
const Y_BLOQUE_INF = Y_FIN_CUERPO - H_BLOQUE_INF;
const Y_LETRAS = Y_BLOQUE_INF - H_LETRAS;
const Y_FIN_DETALLE = Y_LETRAS;
const Y_QR = 672;
const H_QR = 40;
const Y_PIE_FEL = 720;
const Y_PIE_DEMO = 772;
const X_COD = M + 8;
const W_COD = 112;
const X_DESC = M + 128;
const W_DESC = 330;
const X_TOT = X_DESC + W_DESC + 8;
const W_TOT = DER - 8 - X_TOT;

/** `logo` es OBLIGATORIO y ya viene validado (ver `cargarLogoEmpresa`); si PDFKit no pudiera dibujarlo, el render falla. */
export async function renderizarFacturaDemo(f: FacturaDemo, logo: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "portrait",
      // Sin márgenes: todo se coloca con coordenadas explícitas (un margen inferior haría saltar de página el pie).
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      info: { Title: `${LEYENDA_NO_FISCAL} — ${f.numero}`, Subject: "Representación de prueba. Sin validez fiscal." },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // `openImage` existe en PDFKit pero no en sus tipos; lanza si no reconoce el formato (PNG/JPEG).
    const dimsLogo = (doc as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(logo);
    const moneda = (v: number) => formatearMonto(v, f.moneda);
    const serif = (negrita = false, cursiva = false) => doc.font(negrita ? "Times-Bold" : cursiva ? "Times-Italic" : "Times-Roman");
    const trazo = () => doc.lineWidth(LINEA).strokeColor(NEGRO);
    const texto = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions = {}) =>
      doc.text(textoPdf(s), x, y, { lineBreak: false, ...o });
    const linea = (x1: number, y1: number, x2: number, y2: number) => { trazo().moveTo(x1, y1).lineTo(x2, y2).stroke(); };
    const banda = (x: number, y: number, w: number, h: number) => {
      doc.save();
      doc.rect(x, y, w, h).fillAndStroke(GRIS_BANDA, NEGRO);
      doc.restore();
    };

    // ── Paginación del detalle (se mide antes de dibujar para saber cuál es la última página) ───────────────────────
    const filas = f.lineas.map((l) => ({
      codigo: l.codigo,
      descripcion: descripcionVisible(l.descripcion),
      total: moneda(l.total),
    }));
    serif().fontSize(8.5);
    const MAX_LINEAS_FILA = 4;
    const altoLinea = doc.currentLineHeight(true);
    const medidas = filas.map((fila) => {
      const h = doc.heightOfString(textoPdf(fila.descripcion), { width: W_DESC });
      const lineas = Math.min(MAX_LINEAS_FILA, Math.max(1, Math.round(h / altoLinea)));
      return lineas * altoLinea + 5;
    });
    const capacidad = Y_FIN_DETALLE - Y_DETALLE - 6;
    const paginas: number[][] = [[]];
    let usado = 0;
    medidas.forEach((h, i) => {
      if (usado + h > capacidad && paginas[paginas.length - 1].length) {
        paginas.push([]);
        usado = 0;
      }
      paginas[paginas.length - 1].push(i);
      usado += h;
    });

    const totalPaginas = paginas.length;
    const anulada = f.estado === "Anulada";
    const [anio, mes, dia] = f.fecha.split("-");

    const dibujarPagina = (indice: number) => {
      const ultima = indice === totalPaginas - 1;

      // Franja NO FISCAL (arriba, fuera del marco del documento); roja y con «ANULADA» si la factura está anulada
      doc.save();
      doc.rect(M, Y_FRANJA, ANCHO, 15).fillAndStroke(anulada ? "#b91c1c" : "#fef3c7", anulada ? "#7f1d1d" : "#b45309");
      doc.restore();
      doc.font("Helvetica-Bold").fontSize(9).fillColor(anulada ? "#ffffff" : "#92400e");
      texto(anulada ? `${MARCA_ANULADA} — ${LEYENDA_NO_FISCAL}` : LEYENDA_NO_FISCAL, M, Y_FRANJA + 3.5, { width: ANCHO, align: "center" });

      // ── Encabezado izquierdo: razón social, LOGO (obligatorio), dirección, teléfono, NIT ─────────────────────────────
      const wIzq = 304;
      serif(true).fontSize(11.5).fillColor(NEGRO);
      doc.text(textoPdf(f.emisor.razonSocial), M, Y_ENC + 2, { width: wIzq, align: "center", height: 28, ellipsis: true });
      // El logo se escala con `fit` (proporcional, nunca se estira). Un logo apaisado (lockup horizontal) va a todo el
      // ancho del bloque con los datos debajo; uno cuadrado o vertical va a la izquierda con los datos a su derecha.
      const apaisado = dimsLogo.width / dimsLogo.height >= 2.2;
      let xDatos: number;
      let wDatos: number;
      let yDatos: number;
      if (apaisado) {
        doc.image(logo, M + 8, Y_ENC + 32, { fit: [wIzq - 16, 58], align: "center", valign: "center" });
        xDatos = M;
        wDatos = wIzq;
        yDatos = Y_ENC + 94;
      } else {
        doc.image(logo, M + 8, Y_ENC + 32, { fit: [132, 100], align: "center", valign: "center" });
        xDatos = M + 148;
        wDatos = wIzq - 148;
        yDatos = Y_ENC + 44;
      }
      serif().fontSize(8.5).fillColor(NEGRO);
      let yD = yDatos;
      const lineaDato = (s: string) => {
        doc.text(textoPdf(s), xDatos, yD, { width: wDatos, align: "center" });
        yD = doc.y + 1;
      };
      if (f.emisor.nombreComercial && f.emisor.nombreComercial !== f.emisor.razonSocial) lineaDato(`Nombre comercial: ${f.emisor.nombreComercial}`);
      lineaDato(f.emisor.direccion ?? `Dirección: ${TEXTO_PENDIENTE_DEFINIR.toLowerCase()}`);
      lineaDato(`Teléfono: ${f.emisor.telefono ?? TEXTO_PENDIENTE_DEFINIR.toLowerCase()}`);
      lineaDato(`NIT: ${f.emisor.nit ?? TEXTO_PENDIENTE_DEFINIR.toLowerCase()}`);

      // ── Encabezado derecho: documento tributario, serie, número, autorización (todo PENDIENTE FEL) ─────────────────
      const hDte = 16 + 15 + 16 + 16 + 16 + 20;
      let y = Y_ENC;
      banda(X_DTE, y + 16, W_DTE, 15);
      banda(X_DTE, y + 16 + 15 + 16 + 16, W_DTE, 16);
      trazo();
      doc.roundedRect(X_DTE, y, W_DTE, hDte, 6).stroke();
      serif().fontSize(8.5).fillColor(NEGRO);
      texto("DOCUMENTO TRIBUTARIO ELECTRÓNICO", X_DTE, y + 4, { width: W_DTE, align: "center" });
      y += 16;
      serif(true).fontSize(9);
      texto(anulada ? `FACTURA DEMO — ${MARCA_ANULADA}` : "FACTURA DEMO", X_DTE, y + 3.5, { width: W_DTE, align: "center" });
      y += 15;
      serif().fontSize(8.5);
      texto("SERIE:", X_DTE + 24, y + 4.5);
      serif(true);
      texto(TEXTO_PENDIENTE_FEL, X_DTE + 80, y + 4.5);
      y += 16;
      serif().fontSize(8.5);
      texto("NO.:", X_DTE + 38, y + 4.5);
      serif(true);
      texto(TEXTO_PENDIENTE_FEL, X_DTE + 80, y + 4.5);
      y += 16;
      serif(true).fontSize(10);
      texto("NÚMERO DE AUTORIZACIÓN", X_DTE, y + 3, { width: W_DTE, align: "center" });
      y += 16;
      texto(TEXTO_PENDIENTE_FEL, X_DTE, y + 5.5, { width: W_DTE, align: "center" });

      // ── Fecha DÍA / MES / AÑO ─────────────────────────────────────────────────────────────────────────────────────
      const yF = Y_ENC + hDte + 6;
      const wCol = W_DTE / 3;
      banda(X_DTE, yF, W_DTE, 14);
      trazo();
      doc.rect(X_DTE, yF + 14, W_DTE, 17).stroke();
      linea(X_DTE + wCol, yF, X_DTE + wCol, yF + 31);
      linea(X_DTE + 2 * wCol, yF, X_DTE + 2 * wCol, yF + 31);
      serif().fontSize(8.5).fillColor(NEGRO);
      ["DÍA", "MES", "AÑO"].forEach((t, i) => texto(t, X_DTE + i * wCol, yF + 3.5, { width: wCol, align: "center" }));
      [dia, mes, anio].forEach((t, i) => texto(t ?? "", X_DTE + i * wCol, yF + 14 + 4.5, { width: wCol, align: "center" }));
      serif(false, true).fontSize(7).fillColor(GRIS_TEXTO);
      texto(f.etiquetaFecha, X_DTE, yF + 33, { width: W_DTE, align: "right" });

      // ── Cuerpo: un solo marco redondeado (cliente + detalle + totales), como la factura actual ───────────────────────
      trazo();
      doc.roundedRect(M, Y_CUERPO, ANCHO, Y_FIN_CUERPO - Y_CUERPO, 7).stroke();
      const hNombre = 34;
      const hDireccion = 26;
      const hConds = Y_CLIENTE_FIN - Y_CUERPO - hNombre - hDireccion;
      const yDir = Y_CUERPO + hNombre;
      const yConds = yDir + hDireccion;
      linea(M, yDir, DER, yDir);
      linea(M, yConds, DER, yConds);
      const xNit = DER - 118;
      linea(xNit, yDir, xNit, yConds);
      const xInterno = M + 196;
      const xCodigo = M + 388;
      linea(xInterno, yConds, xInterno, Y_CLIENTE_FIN);
      linea(xCodigo, yConds, xCodigo, Y_CLIENTE_FIN);

      const campo = (etiqueta: string, valor: string, x: number, yTop: number, w: number, h: number, tam = 9) => {
        serif().fontSize(8).fillColor(NEGRO);
        const wEt = doc.widthOfString(etiqueta);
        doc.text(etiqueta, x + 6, yTop + 6, { lineBreak: false });
        serif().fontSize(tam).fillColor(NEGRO);
        doc.text(textoPdf(valor), x + 6 + wEt + 4, yTop + 5.5, { width: w - wEt - 16, height: h - 8, ellipsis: true });
      };
      campo("NOMBRE:", f.cliente.nombre, M, Y_CUERPO, ANCHO, hNombre, 9.5);
      campo("DIRECCIÓN:", f.cliente.direccion ?? "—", M, yDir, xNit - M, hDireccion, 8.5);
      campo("NIT:", f.cliente.nit ?? "—", xNit, yDir, DER - xNit, hDireccion);
      campo("CONDICIONES:", f.condiciones ?? TEXTO_PENDIENTE_DEFINIR, M, yConds, xInterno - M, hConds, 8.5);
      campo("No. INTERNO:", f.numero, xInterno, yConds, xCodigo - xInterno, hConds, 8);
      campo("CÓDIGO CLIENTE:", f.cliente.codigo ?? TEXTO_PENDIENTE_DEFINIR, xCodigo, yConds, DER - xCodigo, hConds, 8.5);

      // ── Encabezado de la tabla: CÓDIGO | DESCRIPCIÓN | TOTAL ──────────────────────────────────────────────────────
      banda(M, Y_TABLA_ENC, ANCHO, H_TABLA_ENC);
      serif().fontSize(8.5).fillColor(NEGRO);
      texto("CÓDIGO", X_COD, Y_TABLA_ENC + 4.5);
      texto("DESCRIPCIÓN", X_DESC, Y_TABLA_ENC + 4.5, { width: W_DESC, align: "center" });
      texto("TOTAL", X_TOT, Y_TABLA_ENC + 4.5, { width: W_TOT, align: "right" });

      // ── Detalle: una fila por viaje (código, descripción congelada, total de la línea) ──────────────────────────────
      let yFila = Y_DETALLE + 5;
      for (const i of paginas[indice]) {
        const fila = filas[i];
        const hFila = medidas[i];
        serif().fontSize(8.5).fillColor(NEGRO);
        doc.text(textoPdf(fila.codigo), X_COD, yFila, { width: W_COD, lineBreak: false, ellipsis: true });
        doc.text(textoPdf(fila.descripcion), X_DESC, yFila, { width: W_DESC, height: hFila - 5, ellipsis: true });
        doc.text(fila.total, X_TOT, yFila, { width: W_TOT, align: "right", lineBreak: false });
        yFila += hFila;
      }

      // ── Total en letras ───────────────────────────────────────────────────────────────────────────────────────────
      linea(M, Y_LETRAS, DER, Y_LETRAS);
      linea(M, Y_BLOQUE_INF, DER, Y_BLOQUE_INF);
      serif().fontSize(8.5).fillColor(NEGRO);
      texto("TOTAL EN LETRAS:", M + 6, Y_LETRAS + 7);
      if (ultima) {
        serif(true).fontSize(9);
        doc.text(totalEnLetras(f.total), M + 6 + 88, Y_LETRAS + 6.5, { width: ANCHO - 100, lineBreak: false, ellipsis: true });
      }

      // ── Leyenda tributaria, observaciones y TOTAL ─────────────────────────────────────────────────────────────────
      if (ultima) {
        serif(false, true).fontSize(8).fillColor(f.leyendaTributaria ? NEGRO : GRIS_TEXTO);
        texto(f.leyendaTributaria ?? `Leyenda tributaria: ${TEXTO_PENDIENTE_DEFINIR.toLowerCase()}`, M + 8, Y_BLOQUE_INF + 7, { width: ANCHO - 16 });
        serif().fontSize(8).fillColor(NEGRO);
        texto("OBSERVACIONES:", M + 8, Y_BLOQUE_INF + 28);
        serif().fontSize(8.5).fillColor(NEGRO);
        doc.text(textoPdf(f.observaciones ?? "—"), M + 8 + 78, Y_BLOQUE_INF + 27, { width: 262, height: 38, ellipsis: true });
        const xBox = DER - 188;
        banda(xBox, Y_BLOQUE_INF + 36, 88, 24);
        serif().fontSize(9).fillColor(NEGRO);
        texto(f.moneda === "GTQ" ? "TOTAL Q.:" : `TOTAL ${f.moneda}:`, xBox, Y_BLOQUE_INF + 44, { width: 88, align: "center" });
        serif(true).fontSize(10.5);
        texto(moneda(f.total), xBox + 92, Y_BLOQUE_INF + 43, { width: 88, align: "right" });
      } else {
        serif(false, true).fontSize(9).fillColor(GRIS_TEXTO);
        texto(`Continúa en la página ${indice + 2} de ${totalPaginas}`, M, Y_BLOQUE_INF + 30, { width: ANCHO, align: "center" });
      }

      // ── Recuadro reservado (en la factura real, el código QR) y datos de certificación: PENDIENTE FEL ──────────────
      trazo();
      doc.roundedRect(M, Y_QR, ANCHO, H_QR, 7).stroke();
      serif(false, true).fontSize(8.5).fillColor(GRIS_TEXTO);
      texto(`Espacio reservado para la certificación electrónica: ${TEXTO_PENDIENTE_FEL}`, M, Y_QR + 15, { width: ANCHO, align: "center" });

      const pie: [string, string][] = [
        ["NÚMERO DE AUTORIZACIÓN:", TEXTO_PENDIENTE_FEL],
        ["CERTIFICADOR:", TEXTO_PENDIENTE_FEL],
        ["NIT CERTIFICADOR:", TEXTO_PENDIENTE_FEL],
        ["CORRELATIVO INTERNO:", f.numero],
      ];
      pie.forEach(([etiqueta, valor], i) => {
        const yP = Y_PIE_FEL + i * 12.5;
        serif().fontSize(8.5).fillColor(NEGRO);
        texto(etiqueta, M, yP, { width: 150, align: "right" });
        serif(valor === TEXTO_PENDIENTE_FEL).fontSize(8.5);
        texto(valor, M + 158, yP, { width: 300 });
      });
    };

    for (let i = 0; i < totalPaginas; i++) {
      if (i > 0) doc.addPage();
      dibujarPagina(i);
    }

    // ── Marca de agua y pie NO FISCAL en TODAS las páginas ──────────────────────────────────────────────────────────
    const rango = doc.bufferedPageRange();
    const generado = formatearTimestampVisible(ahoraLocal());
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      const yCentro = (Y_DETALLE + Y_FIN_DETALLE) / 2;
      doc.save();
      doc.fillColor("#b91c1c").fillOpacity(0.07);
      doc.rotate(-35, { origin: [doc.page.width / 2, yCentro] });
      // Una anulada lleva «ANULADA» enorme en el centro y el aviso DEMO más pequeño debajo (ambos legibles).
      if (anulada) {
        doc.fillOpacity(0.2);
        doc.font("Helvetica-Bold").fontSize(112).text(MARCA_ANULADA, 0, yCentro - 70, { width: doc.page.width, align: "center", lineBreak: false });
        doc.fillOpacity(0.08);
        doc.font("Helvetica-Bold").fontSize(34).text("DEMO - NO FISCAL", 0, yCentro + 55, { width: doc.page.width, align: "center", lineBreak: false });
      } else {
        doc.font("Helvetica-Bold").fontSize(58).text("DEMO - NO FISCAL", 0, yCentro - 30, { width: doc.page.width, align: "center", lineBreak: false });
      }
      doc.restore();
      doc.font("Helvetica").fontSize(7.5).fillColor("#6b7280").text(
        `${anulada ? `${MARCA_ANULADA} · ` : ""}${LEYENDA_NO_FISCAL} · Página ${i + 1} de ${rango.count} · Generado el ${generado} (Guatemala)`,
        M, Y_PIE_DEMO, { width: ANCHO, align: "center", lineBreak: false },
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

const MAX_BYTES_LOGO = 5 * 1024 * 1024;

/** Dibuja la imagen en un documento descartable: confirma que PDFKit (PNG/JPEG) puede leerla y decodificarla. */
function pdfkitPuedeLeer(imagen: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({ size: [20, 20], margin: 0 });
      doc.on("data", () => undefined);
      doc.on("end", () => resolve(true));
      doc.on("error", () => resolve(false));
      doc.image(imagen, 0, 0, { fit: [10, 10] });
      doc.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Logo de la EMPRESA DEL GUARD (`empresas.logo_url`; nunca una ruta del cliente). Devuelve `null` si falta, la ruta es
 * inválida o apunta al directorio de OTRA empresa (`empresas/<otroId>/…`), el archivo no existe / no es un archivo / está
 * vacío o es demasiado grande, o PDFKit no puede leerlo. Quien llama debe responder 409: no hay respaldo a solo texto.
 */
export async function cargarLogoEmpresa(empresa: { id: number; logoUrl: string | null }): Promise<Buffer | null> {
  const ruta = typeof empresa.logoUrl === "string" ? empresa.logoUrl.trim() : "";
  if (!ruta || ruta.includes("\0")) return null;
  const normalizada = ruta.replaceAll("\\", "/").replace(/^\.?\/+/, "");
  const deOtraEmpresa = /^empresas\/(\d+)(\/|$)/i.exec(normalizada);
  if (deOtraEmpresa && Number(deOtraEmpresa[1]) !== empresa.id) return null;
  try {
    const abs = absPathFromRelative(ruta);
    if (!existsSync(abs)) return null;
    const info = statSync(abs);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES_LOGO) return null;
    const imagen = readFileSync(abs);
    return (await pdfkitPuedeLeer(imagen)) ? imagen : null;
  } catch {
    return null;
  }
}

/** Código del cliente (`clientes.codigo`), SIEMPRE filtrado por la empresa del guard. Es lectura viva (no hay snapshot). */
async function leerCodigoCliente(empresaId: number, clienteId: number): Promise<string | null> {
  const rows = await query<RowDataPacket[]>("SELECT codigo FROM clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [clienteId, empresaId]);
  return textoDe(rows[0]?.codigo);
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
    telefono: null, // la plataforma todavía no modela el teléfono del emisor
  };
  const complementos: ComplementosDemo = {
    clienteCodigo: detalle ? await leerCodigoCliente(empresa.id, detalle.factura.clienteId) : null,
    condiciones: null, // la factura no congela condiciones de pago todavía
    leyendaTributaria: null, // sin dato modelado
  };
  const modelo = prepararFacturaDemo(detalle, emisor, ahoraLocal().slice(0, 10), complementos);
  if (!modelo.ok) return modelo;
  // El logo es obligatorio. Se valida DESPUÉS de la factura (una factura ajena o inexistente sigue siendo 404 y no revela el
  // estado del logo) y siempre con el de la empresa del guard.
  const logo = await cargarLogoEmpresa(empresa);
  if (!logo) return { ok: false, status: 409, error: MENSAJE_SIN_LOGO };
  return { ok: true, buffer: await renderizarFacturaDemo(modelo.factura, logo), nombreArchivo: `factura-demo-${facturaId}.pdf` };
}
