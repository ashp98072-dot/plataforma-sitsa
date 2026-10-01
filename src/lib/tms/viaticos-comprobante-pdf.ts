import { existsSync, readFileSync } from "fs";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, fmtTs, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
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
 * - dibujarTablaEnDoc() (src/lib/rrhh/export-files.ts) — el mismo
 *   dibujado de tabla ya usado en los reportes de RRHH, extraído de
 *   pdfTabla() para poder seguir agregando contenido propio (las
 *   imágenes de firma) en el mismo documento sin duplicar esa lógica.
 * - filasComprobante() (viaticos-comprobante-filas.ts) — mismo DTO de filas que consume el Excel
 *   (viaticos-comprobante-excel.ts), un solo mapeo para ambos formatos.
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

    // "Cantidad" (índice 6) y "Total" (índice 8) alineados a la derecha —
    // mismo criterio que el resto de reportes administrativos del repo
    // (viaticos-requerimientos-export.ts). `minWeight` evita que "Total"
    // se trunque con montos en miles ("Q1,250.00"), mismo bug ya
    // documentado para "Monto" en el formato anterior.
    dibujarTablaEnDoc(doc, { headers, rows, align: { 6: "right", 8: "right" }, minWeight: { 8: 11 } });

    // TOTAL GENERAL — suma exacta de las filas exportadas (mismo valor
    // que totalGeneralComprobante() ya usa el Excel, un solo cálculo).
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(`TOTAL GENERAL: ${moneda(total)}`, marginL, doc.y, { width: pageWidth, align: "right" });

    // Bloque de autorización — UNA firma por persona distinta (no una
    // por viático: el detalle por viático ya está en la tabla de
    // arriba). Sigue en la MISMA página si cabe (doc.y ya quedó
    // posicionado justo después de la tabla por dibujarTablaEnDoc); solo
    // se agrega una página nueva cuando el siguiente bloque ya no cabe.
    const firmantes = agruparPorFirmante(porViatico);
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
      doc.moveTo(doc.x, doc.y).lineTo(doc.x + 180, doc.y).strokeColor("#94a3b8").lineWidth(0.6).stroke();
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
