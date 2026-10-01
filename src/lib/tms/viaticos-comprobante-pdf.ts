import { existsSync, readFileSync } from "fs";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, fmtTs, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { reforzarFirmaParaPdf } from "@/lib/firmas/reforzar-firma-pdf";
import { listarViaticosAutorizadosPorPeriodo } from "@/lib/tms/viaticos";
import { listarFirmasViatico, type FirmaViaticoResumen } from "@/lib/firmas/firmas-lectura";
import type { PeriodoComprobante } from "@/lib/tms/viaticos-comprobante-periodo";
import { filasComprobante, totalGeneralComprobante } from "@/lib/tms/viaticos-comprobante-filas";

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 — comprobante en PDF, en lote, HISTÓRICO por período (Día/Semana/Mes) de todos
 * los viáticos AUTORIZADOS de una empresa DURANTE ese período (criterio: `autorizado_en`, no el estado actual
 * — ver VIATICOS-COMPROBANTE-PERIODO en viaticos-comprobante-periodo.ts y listarViaticosAutorizadosPorPeriodo()
 * en viaticos.ts). Formato administrativo (v3), A4 vertical, reemplaza el formato técnico anterior — mismos
 * datos/criterio histórico, solo cambia la presentación: título "REQUERIMIENTO DE VIÁTICOS", cabecera con
 * Empresa requiriente + Período en cajas simples, tabla compacta (Viaje/Fecha viaje/Nombre/Cargo/Placa/
 * Cliente/Cantidad/Lugar de descarga/Total), TOTAL GENERAL y UN bloque de firma por cada persona distinta que
 * autorizó (no uno por viático) — en la MISMA página si cabe, solo avanza a una página nueva cuando ya no hay
 * espacio.
 *
 * NO incluye "Código de petición", "Persona que requiere" ni su firma, "Fecha de solicitud", "No. Cuenta" ni
 * "Banco" — discovery confirmó que tms_viaticos (fuente de este comprobante) y tms_viatico_requerimientos/
 * tms_viatico_requerimiento_lineas (requerimientos manuales, la referencia visual de este formato) son dos
 * flujos SIN relación entre sí: no existe una entidad "requerimiento" real detrás de un lote histórico por
 * período, ni una acción de firma "requirente" a nivel de tms_viaticos (solo AUTORIZAR_VIATICO/
 * LIQUIDAR_VIATICO). Mostrar cualquiera de esos campos sería inventar un dato que no existe. Ver
 * viaticos-comprobante-filas.ts para el detalle completo de esta decisión.
 *
 * Reutiliza TAL CUAL:
 * - listarViaticosAutorizadosPorPeriodo() — mismos JOINs/columnas que Control de Viáticos (VIAT-3), pero
 *   filtrada por `autorizado_en` en el rango del período — nunca por estado actual, así un viático autorizado
 *   dentro del período que después pasó a ENTREGADO/LIQUIDADO sigue apareciendo.
 * - listarFirmasViatico() — mismo historial de firmas que ya expone el
 *   modal "Ver firmas" (VIATICOS-HISTORIAL-FIRMA-1).
 * - filasComprobante() (viaticos-comprobante-filas.ts) — mismo DTO de filas que consume el Excel
 *   (viaticos-comprobante-excel.ts), un solo mapeo para ambos formatos.
 *
 * VIATICOS-COMPROBANTE-ADMIN-1 (corrección pre-merge) — la tabla ya NO usa dibujarTablaEnDoc()
 * (src/lib/rrhh/export-files.ts): ese helper es COMPARTIDO por otros reportes de RRHH y dibuja encabezado con
 * fondo navy (#1e3a5f) + zebra striping, un estilo "reporte técnico" que NO corresponde al formato
 * administrativo v3 aprobado (fondo blanco, sin relleno fuerte, bordes finos) — y no debía modificarse para
 * no afectar a esos otros reportes. En su lugar, dibujarTablaAdministrativaViaticos() (más abajo) es un
 * renderer LOCAL y privado de este módulo, exclusivo para este comprobante.
 *
 * listarFirmasViatico() deliberadamente nunca expone imagen_ruta
 * (contrato documentado en firmas-lectura.ts). Para incrustar la imagen
 * en el PDF, este módulo hace su PROPIA consulta interna, acotada a
 * empresa_id + modulo='VIATICOS' + entidad_tipo='VIATICO' (mismo
 * criterio de aislamiento que ya usa
 * .../viaticos/firmas/[firmaId]/imagen/route.ts) — sin tocar
 * firmas-lectura.ts ni ese route existente.
 */

function moneda(v: number): string {
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * "Kuiqtrans / Logiservicios Mónaco" -> "Logiservicios Mónaco". Nombres
 * de empresa sin "/" (la mayoría de tenants) se devuelven sin cambios —
 * es una reducción genérica del nombre visible SOLO en este comprobante
 * (nunca toca empresas.nombre en la base de datos), aplicable por igual
 * a cualquier empresa cuyo nombre venga compuesto por varios segmentos.
 * Exportada (función pura) para poder probarla directamente con vitest
 * sin inspeccionar el PDF comprimido — mismo criterio que
 * historial-firmas-ui.ts.
 */
export function tituloEmpresa(nombre: string): string {
  const partes = nombre.split("/").map((p) => p.trim()).filter(Boolean);
  return partes.length > 1 ? partes[partes.length - 1] : nombre;
}

/**
 * VIATICOS-COMPROBANTE-PDF (ajuste de formato) — fecha en español,
 * locale es-GT: "3 de septiembre de 2026, 18:47". No se reutiliza
 * formatearTimestampVisible (DD/MM/YYYY, usado en todo el resto de la
 * app) para no cambiar su salida en ningún otro lugar — este formato es
 * exclusivo del bloque de autorización de este comprobante.
 *
 * Reutiliza fmtTs() (src/lib/rrhh/dates.ts) para normalizar el valor
 * crudo de MySQL (mismo criterio de zona horaria que el resto de la
 * app) antes de formatear — nunca reinterpreta la hora con una zona
 * distinta.
 */
export function fechaLargaEsGt(value: string | Date | null | undefined): string {
  // fmtTs() reconoce "YYYY-MM-DD HH:MM:SS" y variantes ISO, pero
  // mapFirmaViatico() guarda fechaHoraServidor como `String(Date)` cuando
  // mysql2 devuelve un objeto Date (formato nativo de JS, tipo "Thu Sep 03
  // 2026 18:47:26 GMT+0000 (...)") — fmtTs no lo reconoce como tal y lo
  // trataría como texto plano. Se re-parsea a un Date real primero (mismo
  // string que generó `String(date)`, JS lo reconstruye igual) para que
  // fmtTs use su rama de Date, que sí extrae la hora de pared correcta.
  let normalizado: string | Date | null | undefined = value;
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) normalizado = parsed;
  }
  const s = fmtTs(normalizado);
  if (!s) return "—";
  const [fecha, hora] = s.split(" ");
  const [anio, mes, dia] = (fecha ?? "").split("-").map(Number);
  if (!anio || !mes || !dia) return s;
  const fechaFmt = new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(anio, mes - 1, dia),
  );
  if (!hora) return fechaFmt;
  const [hh, mm] = hora.split(":");
  const horaNum = Number(hh);
  if (Number.isNaN(horaNum) || !mm) return fechaFmt;
  return `${fechaFmt}, ${horaNum}:${mm}`;
}

async function imagenFirma(
  empresaId: number,
  firmaId: number,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT imagen_ruta, imagen_mime FROM firmas_electronicas
     WHERE id = ? AND empresa_id = ? AND modulo = 'VIATICOS' AND entidad_tipo = 'VIATICO'
     LIMIT 1`,
    [firmaId, empresaId],
  );
  const row = rows[0];
  if (!row || !row.imagen_ruta) return null;
  try {
    const abs = absPathFromRelative(String(row.imagen_ruta));
    if (!existsSync(abs)) return null;
    return {
      buffer: readFileSync(abs),
      mime: row.imagen_mime ? String(row.imagen_mime) : "image/png",
    };
  } catch {
    // Ruta inválida o archivo ilegible: el comprobante sigue generándose
    // sin la imagen (nunca se rompe el PDF completo por una firma).
    return null;
  }
}

type FirmaConImagen = { firma: FirmaViaticoResumen; imagen: { buffer: Buffer; mime: string } | null };

/**
 * Reduce la lista de firmas de autorización (una por viático) a UNA
 * entrada por firmante distinto — pedido explícito del usuario: "no por
 * cada uno sino una firma en general". Se agrupa por usuarioId (o por
 * nombreFirmante si la firma no tiene usuarioId) y, dentro de cada
 * grupo, se queda con la firma MÁS RECIENTE (por fechaHoraServidor) —
 * tanto para el nombre/rol/fecha mostrados como para la imagen. El orden
 * de salida es el de primera aparición en `porViatico` (mismo orden que
 * la tabla), no alfabético ni por fecha, para que sea predecible.
 * Exportada (función pura) para poder probarla directamente con vitest —
 * mismo criterio que tituloEmpresa().
 */
export function agruparPorFirmante(
  porViatico: { firma: FirmaViaticoResumen | null; imagen: { buffer: Buffer; mime: string } | null }[],
): FirmaConImagen[] {
  const orden: string[] = [];
  const porClave = new Map<string, FirmaConImagen>();
  for (const { firma, imagen } of porViatico) {
    if (!firma) continue;
    const clave = firma.usuarioId != null ? `u:${firma.usuarioId}` : `n:${firma.nombreFirmante ?? firma.id}`;
    const actual = porClave.get(clave);
    const esMasReciente =
      !actual || new Date(firma.fechaHoraServidor).getTime() > new Date(actual.firma.fechaHoraServidor).getTime();
    if (esMasReciente) porClave.set(clave, { firma, imagen });
    if (!orden.includes(clave)) orden.push(clave);
  }
  return orden.map((clave) => porClave.get(clave)!);
}

/** Anchos (pt) de las 9 columnas del formato administrativo, A4 vertical — suma 513pt (ancho útil ≈523pt). */
const ANCHOS_TABLA_VIATICOS = [62, 52, 72, 48, 42, 62, 46, 74, 55];
const ALTO_FILA_TABLA = 16;
const ALTO_ENCABEZADO_TABLA = 20;
const FUENTE_TABLA = 7.5;

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 (corrección pre-merge) — renderer LOCAL y privado de este módulo (no exportado,
 * no reutilizado por ningún otro reporte). Reemplaza dibujarTablaEnDoc() SOLO para este comprobante porque ese
 * helper compartido (src/lib/rrhh/export-files.ts) dibuja encabezado con fondo navy + filas zebra — un estilo
 * "reporte técnico" que el formato v3 aprobado explícitamente no usa (fondo blanco, SIN relleno fuerte, bordes
 * finos, texto negro). No se modifica dibujarTablaEnDoc() en absoluto: lo siguen consumiendo otros reportes de
 * RRHH tal cual estaba.
 *
 * `footerReserve` es la altura (pt) que debe quedar libre DESPUÉS de la ÚLTIMA fila — reservada para TOTAL
 * GENERAL + el/los bloque(s) de autorización + el pie de página — calculada por el caller a partir del número
 * real de firmantes distintos (ver comprobanteAutorizacionesPdf). Solo la ÚLTIMA fila respeta ese límite
 * reducido; todas las filas anteriores usan el alto completo de la página — así, si hace falta mover contenido
 * a una página nueva, se mueve ÚNICAMENTE lo necesario (la propia última fila, nunca de más), y lo que viene
 * después (total + firmas + pie) siempre queda junto en esa misma página final.
 */
function dibujarTablaAdministrativaViaticos(
  doc: InstanceType<typeof PDFDocument>,
  opts: {
    headers: string[];
    rows: string[][];
    widths: number[];
    align?: Partial<Record<number, "left" | "right" | "center">>;
    footerReserve: number;
  },
): void {
  const marginL = doc.page.margins.left;
  const marginT = doc.page.margins.top;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 12;

  const dibujarEncabezado = (y: number): number => {
    let x = marginL;
    doc.font("Helvetica-Bold").fontSize(FUENTE_TABLA).fillColor("#0f172a");
    opts.headers.forEach((h, i) => {
      const w = opts.widths[i];
      doc.rect(x, y, w, ALTO_ENCABEZADO_TABLA).strokeColor("#334155").lineWidth(0.8).stroke();
      doc.text(h, x + 3, y + 5, { width: w - 6, height: ALTO_ENCABEZADO_TABLA - 6, align: opts.align?.[i] ?? "left", lineBreak: false, ellipsis: true });
      x += w;
    });
    return y + ALTO_ENCABEZADO_TABLA;
  };

  let y = dibujarEncabezado(doc.y);

  opts.rows.forEach((cells, idx) => {
    const ultima = idx === opts.rows.length - 1;
    const limite = pageBottom() - (ultima ? opts.footerReserve : 0);
    if (y + ALTO_FILA_TABLA > limite) {
      doc.addPage();
      y = dibujarEncabezado(marginT);
    }
    let x = marginL;
    doc.font("Helvetica").fontSize(FUENTE_TABLA).fillColor("#0f172a");
    cells.forEach((cell, i) => {
      const w = opts.widths[i];
      doc.rect(x, y, w, ALTO_FILA_TABLA).strokeColor("#94a3b8").lineWidth(0.5).stroke();
      doc.text(cell, x + 3, y + 4, { width: w - 6, height: ALTO_FILA_TABLA - 4, align: opts.align?.[i] ?? "left", lineBreak: false, ellipsis: true });
      x += w;
    });
    y += ALTO_FILA_TABLA;
  });

  doc.x = marginL;
  doc.y = y;
}

/**
 * `null` cuando no hay ningún viático autorizado EN EL PERÍODO — el caller (route.ts) decide el mensaje/estado
 * HTTP; esta función nunca genera un PDF vacío.
 */
export async function comprobanteAutorizacionesPdf(
  empresaId: number,
  empresaNombre: string,
  periodo: PeriodoComprobante,
): Promise<Buffer | null> {
  const items = await listarViaticosAutorizadosPorPeriodo(empresaId, periodo.inicio, periodo.finExclusivo);
  if (!items.length) return null;

  // Firma de autorización de cada viático (y su imagen, si tiene) — antes
  // de abrir el documento, para no dejar streams de pdfkit a medio
  // escribir si algo falla resolviendo datos.
  const porViatico = await Promise.all(
    items.map(async (v) => {
      const firmas = await listarFirmasViatico(empresaId, v.id);
      const firma = firmas.find((f) => f.accion === "AUTORIZAR_VIATICO") ?? null;
      const imagen = firma?.tieneImagen ? await imagenFirma(empresaId, firma.id) : null;
      return { viatico: v, firma, imagen };
    }),
  );

  const headers = ["Viaje", "Fecha viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga", "Total"];
  const filas = filasComprobante(items);
  const rows = filas.map((f) => [f.viaje, f.fechaViaje, f.nombre, f.cargo, f.placa, f.cliente, String(f.cantidad), f.lugarDescarga, moneda(f.total)]);
  const total = totalGeneralComprobante(filas);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margins: { top: 40, bottom: 40, left: 36, right: 36 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;
    const pageBottom = () => doc.page.height - doc.page.margins.bottom - 12;

    // VIATICOS-COMPROBANTE-ADMIN-1 — título del formato administrativo
    // aprobado (reemplaza "Comprobante de autorización de viáticos — TMS
    // / Logística"). Sin subtítulo.
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text("REQUERIMIENTO DE VIÁTICOS", { align: "center", width: pageWidth });
    doc.moveDown(0.8);

    // Cabecera: campo con etiqueta a la izquierda + caja con el valor
    // centrado — mismo estilo "formulario administrativo" aprobado (sin
    // tarjetas, sin fondo navy). Solo Empresa requiriente y Período:
    // "Código de petición" y "Persona que requiere" NO se incluyen (ver
    // docblock del módulo — no existe una fuente real para este
    // comprobante histórico por período).
    const campoCaja = (etiqueta: string, valor: string, y: number) => {
      const labelW = 140;
      const boxX = marginL + labelW + 8;
      const boxW = pageWidth - labelW - 8;
      doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(etiqueta, marginL, y + 4, { width: labelW, align: "right" });
      doc.rect(boxX, y, boxW, 18).strokeColor("#334155").lineWidth(0.7).stroke();
      doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(valor, boxX, y + 5, { width: boxW, align: "center", lineBreak: false });
    };
    let yCampo = doc.y;
    campoCaja("EMPRESA REQUIRIENTE", tituloEmpresa(empresaNombre), yCampo);
    yCampo += 26;
    campoCaja("PERÍODO", periodo.etiqueta, yCampo);
    yCampo += 26;
    doc.font("Helvetica").fontSize(9).fillColor("#475569")
      .text(`${items.length} viático${items.length === 1 ? "" : "s"} autorizado${items.length === 1 ? "" : "s"}`, marginL, yCampo, { width: pageWidth });
    doc.y = yCampo + 18;

    // VIATICOS-COMPROBANTE-ADMIN-1 (corrección pre-merge) — calculado ANTES de dibujar la tabla, para poder
    // reservarle espacio real a TOTAL GENERAL + el/los bloque(s) de autorización en la ÚLTIMA fila (ver
    // dibujarTablaAdministrativaViaticos): sin esto, la tabla podía consumir toda la página y dejar las firmas
    // solas en una página nueva casi vacía.
    const firmantes = agruparPorFirmante(porViatico);
    const ALTO_TOTAL_GENERAL = 30;
    const ALTO_TITULO_AUTORIZACION = 26;
    const ALTO_BLOQUE_FIRMA = (tieneImagen: boolean) => 40 + (tieneImagen ? 76 : 0);
    const alturaUtil = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    const footerReserveCalculado =
      ALTO_TOTAL_GENERAL +
      ALTO_TITULO_AUTORIZACION +
      firmantes.reduce((acc, f) => acc + ALTO_BLOQUE_FIRMA(Boolean(f.imagen)), 0);
    // Tope de seguridad: con muchos firmantes distintos, reservar la altura COMPLETA en la última fila dejaría
    // sin espacio a filas que si caben perfectamente — el bloque de firmas YA tiene su propio control de salto
    // de página (más abajo), así que basta reservar lo suficiente para arrancar el bloque sin quedar solo.
    const footerReserve = Math.min(footerReserveCalculado, alturaUtil * 0.6);

    // "Cantidad" (índice 6) y "Total" (índice 8) alineados a la derecha —
    // mismo criterio que el resto de reportes administrativos del repo
    // (viaticos-requerimientos-export.ts).
    dibujarTablaAdministrativaViaticos(doc, {
      headers,
      rows,
      widths: ANCHOS_TABLA_VIATICOS,
      align: { 6: "right", 8: "right" },
      footerReserve,
    });

    // TOTAL GENERAL — suma exacta de las filas exportadas (mismo valor
    // que totalGeneralComprobante() ya usa el Excel, un solo cálculo).
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(`TOTAL GENERAL: ${moneda(total)}`, marginL, doc.y, { width: pageWidth, align: "right" });

    // Bloque de autorización — UNA firma por persona distinta (no una
    // por viático: el detalle por viático ya está en la tabla de
    // arriba). Sigue en la MISMA página si cabe (doc.y ya quedó
    // posicionado justo después de la tabla); el footerReserve de arriba
    // ya garantizó espacio suficiente, este chequeo por bloque queda
    // como red de seguridad (p. ej. un nombre de firmante inusualmente
    // largo) y es el que sigue manejando el caso de MUCHOS firmantes
    // que legítimamente necesitan más de una página.
    let tituloDibujado = false;
    firmantes.forEach(({ firma, imagen }) => {
      const alturaEstimada = 40 + (imagen ? 76 : 0) + (tituloDibujado ? 0 : 22);
      if (doc.y + alturaEstimada > pageBottom()) {
        doc.addPage();
      }
      if (!tituloDibujado) {
        doc.moveDown(0.6);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Autorización", { width: pageWidth });
        doc.moveDown(0.3);
        tituloDibujado = true;
      }
      if (imagen) {
        try {
          // FIRMAS-PDF-TINTA-1 — mismo refuerzo visual que en los PDFs de
          // Solicitud de fondo: trazo más oscuro y levemente engrosado
          // SOLO al incrustar; el archivo histórico no se toca.
          doc.image(reforzarFirmaParaPdf(imagen.buffer), { fit: [160, 70] });
          doc.moveDown(0.1);
        } catch {
          // Imagen corrupta/formato no soportado por pdfkit: el
          // comprobante sigue siendo válido sin la imagen — nombre, rol
          // y fecha del firmante quedan igual como constancia.
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#94a3b8")
            .text("(No fue posible incrustar la imagen de la firma.)");
          doc.moveDown(0.1);
        }
      }
      doc.moveTo(doc.x, doc.y).lineTo(doc.x + 180, doc.y).strokeColor("#334155").lineWidth(0.7).stroke();
      doc.moveDown(0.15);
      // VIATICOS-PDF-PRESENTACION-1: ÚNICAMENTE el nombre real del
      // firmante (snapshot de payload_canonico al firmar) — nunca su
      // username/login, ni "(admin)"/"(usuario)", ni su rol o tipo de
      // usuario entre paréntesis. Ajuste anterior mostraba el rol
      // ("Administrador General (Admin)") y luego el username
      // ("Heber Sitan (hsitan)") — ambos formatos quedan retirados por
      // pedido explícito: "Autorizado por: Heber Sitan", sin nada más.
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a")
        .text(`Autorizado por: ${firma.nombreFirmante ?? "No disponible"}`, { width: pageWidth });
      doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
        .text(`Fecha: ${fechaLargaEsGt(firma.fechaHoraServidor)}`, { width: pageWidth });
      doc.moveDown(0.5);
    });

    // VIATICOS-PDF-PRESENTACION-1: causa de la página en blanco extra —
    // el pie se dibujaba en `margins.bottom + 6`, es decir 6pt POR DEBAJO
    // del límite inferior de contenido (`page.height - margins.bottom`).
    // pdfkit trata esa posición como fuera del área imprimible y, al
    // llamar `.text()` ahí, agrega automáticamente una página nueva ANTES
    // de dibujar — el pie terminaba en esa página nueva (casi vacía) en
    // vez de en la que le correspondía. Mismo patrón ya usado (y
    // correcto) en piePaginas() — src/lib/rrhh/export-files.ts, el pie de
    // tablaAPdf(): `margins.bottom - 12`, DENTRO del área imprimible,
    // nunca dispara una página nueva.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
        .text(
          `Página ${i + 1} de ${range.count} · Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`,
          marginL,
          doc.page.height - doc.page.margins.bottom - 12,
          { width: pageWidth, align: "center", lineBreak: false },
        );
    }

    doc.end();
  });
}
