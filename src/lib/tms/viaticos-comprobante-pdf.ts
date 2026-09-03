import { existsSync, readFileSync } from "fs";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { listarViaticosControl } from "@/lib/tms/viaticos";
import { listarFirmasViatico, type FirmaViaticoResumen } from "@/lib/firmas/firmas-lectura";

/**
 * VIATICOS-COMPROBANTE-PDF — comprobante en PDF, en lote, de todos los
 * viáticos actualmente AUTORIZADOS de una empresa: una tabla (no una
 * página por viático, ver dibujarTablaEnDoc) con los datos del
 * viaje/empleado/monto, y debajo UN bloque de firma por cada persona
 * distinta que autorizó (no uno por viático — si la misma persona
 * autorizó varios, aparece una sola vez) — en la MISMA página si cabe,
 * solo avanza a una página nueva cuando ya no hay espacio. Cada bloque
 * muestra el nombre real del firmante (nombreFirmante, nunca su usuario
 * de acceso), su rol, la fecha, y su imagen de firma más reciente del
 * lote si existe.
 *
 * Reutiliza TAL CUAL:
 * - listarViaticosControl() — misma consulta que ya usa el Control de
 *   Viáticos (VIAT-3), filtrada a estado AUTORIZADO — no es una segunda
 *   fuente de verdad del listado.
 * - listarFirmasViatico() — mismo historial de firmas que ya expone el
 *   modal "Ver firmas" (VIATICOS-HISTORIAL-FIRMA-1).
 * - dibujarTablaEnDoc() (src/lib/rrhh/export-files.ts) — el mismo
 *   dibujado de tabla ya usado en los reportes de RRHH, extraído de
 *   pdfTabla() para poder seguir agregando contenido propio (las
 *   imágenes de firma) en el mismo documento sin duplicar esa lógica.
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
 * `null` cuando no hay ningún viático AUTORIZADO — el caller (route.ts)
 * decide el mensaje/estado HTTP; esta función nunca genera un PDF vacío.
 */
export async function comprobanteAutorizacionesPdf(
  empresaId: number,
  empresaNombre: string,
): Promise<Buffer | null> {
  const { items } = await listarViaticosControl(empresaId, { estado: "AUTORIZADO" });
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

  const headers = [
    "Viaje",
    "Fecha",
    "Cliente",
    "Empleado",
    "Rol",
    "Monto",
    "Autorizado por",
    "Fecha autorización",
    "Código de firma",
  ];
  const rows = porViatico.map(({ viatico: v, firma }) => [
    v.planCodigo,
    v.fechaPlan,
    v.cliente ?? "—",
    v.personalNombre,
    v.rol,
    moneda(v.montoAsignado),
    firma?.nombreFirmante ?? "No disponible",
    firma?.fechaHoraServidor ?? "—",
    firma?.codigoFirma ?? "—",
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 36, bottom: 40, left: 32, right: 32 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;
    const pageBottom = () => doc.page.height - doc.page.margins.bottom - 12;

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text(tituloEmpresa(empresaNombre), { width: pageWidth });
    doc.moveDown(0.2).font("Helvetica").fontSize(9).fillColor("#475569")
      .text(`Comprobante de autorización de viáticos — TMS / Logística · ${items.length} viático(s) autorizado(s)`, { width: pageWidth });
    doc.moveDown(0.35);

    dibujarTablaEnDoc(doc, { headers, rows });

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
          doc.image(imagen.buffer, { fit: [160, 70] });
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
      // Nombre real del firmante (snapshot de payload_canonico al firmar)
      // — NUNCA el usuario de acceso (username/login).
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a")
        .text(`Autorizado por: ${firma.nombreFirmante ?? "No disponible"}${firma.rolFirmante ? ` (${firma.rolFirmante})` : ""}`, { width: pageWidth });
      doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
        .text(`Fecha: ${formatearTimestampVisible(firma.fechaHoraServidor)}`, { width: pageWidth });
      doc.moveDown(0.5);
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
        .text(
          `Página ${i + 1} de ${range.count} · Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`,
          marginL,
          doc.page.height - doc.page.margins.bottom + 6,
          { width: pageWidth, align: "center", lineBreak: false },
        );
    }

    doc.end();
  });
}
