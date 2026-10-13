import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { ETIQUETA_AREA } from "@/lib/entregas/catalogo";
import { listarEntregasDocumento, type Entrega } from "@/lib/entregas/entregas";
import { formatearTimestampVisible } from "@/lib/rrhh/dates";
import type { PdfDoc } from "@/lib/tms/fondos-solicitud-pdf";

/**
 * CONTROL DE ENTREGA en el PDF de Solicitudes de fondo (PR 2).
 *
 * Reglas aprobadas: el PDF formal muestra las entregas RECIBIDAS y la EMITIDA pendiente (si existe). Las RECHAZADAS y ANULADAS
 * NO se muestran como filas: solo una nota que remite al historial del sistema. Sin imágenes de firma en esta versión: se
 * imprimen nombre, fecha/hora y el CÓDIGO de la firma (verificable contra `firmas_electronicas`); incluir la imagen
 * ampliaría el alcance (lectura de archivos por entrega) y queda como mejora aparte.
 *
 * Solo lectura. La empresa viene del guard del endpoint; todas las consultas filtran por `empresa_id`.
 */

export const NOTA_MOVIMIENTOS_CERRADOS = "Existen movimientos rechazados o anulados. Consulte el historial en el sistema.";

export type EntregaPdf = {
  estado: "RECIBIDA" | "EMITIDA";
  origen: string;
  destino: string;
  presencial: boolean;
  emitidoPor: string;
  emitidoEn: string;
  codigoFirmaEmision: string | null;
  recibidoPor: string | null;
  recibidoEn: string | null;
  /** Presencial: usuario del sistema que operó el dispositivo. */
  registradoPor: string | null;
  codigoFirmaRecepcion: string | null;
};

export type ControlEntregaPdf = { filas: EntregaPdf[]; hayCerradasSinRecepcion: boolean };

export const CONTROL_ENTREGA_VACIO: ControlEntregaPdf = { filas: [], hayCerradasSinRecepcion: false };

/** RECIBIDAS (en orden cronológico) + la EMITIDA pendiente; RECHAZADA/ANULADA solo activan la nota. Pura. */
export function seleccionarEntregasParaPdf(entregas: Entrega[]): { mostrar: Entrega[]; hayCerradasSinRecepcion: boolean } {
  const ordenadas = [...entregas].sort((a, b) => a.id - b.id);
  return {
    mostrar: ordenadas.filter((e) => e.estado === "RECIBIDA" || e.estado === "EMITIDA"),
    hayCerradasSinRecepcion: ordenadas.some((e) => e.estado === "RECHAZADA" || e.estado === "ANULADA"),
  };
}

async function codigosDeFirma(empresaId: number, ids: number[]): Promise<Map<number, string>> {
  const unicos = [...new Set(ids)];
  const mapa = new Map<number, string>();
  if (!unicos.length) return mapa;
  const filas = await query<RowDataPacket[]>(
    `SELECT id, codigo_firma FROM firmas_electronicas WHERE empresa_id = ? AND id IN (${unicos.map(() => "?").join(", ")})`,
    [empresaId, ...unicos],
  );
  for (const f of filas ?? []) mapa.set(Number(f.id), String(f.codigo_firma));
  return mapa;
}

/**
 * Carga el control de entrega de una solicitud para el PDF. Es una sección ACCESORIA: ante cualquier error de lectura (p. ej. la
 * tabla aún no existe en un ambiente) el documento se genera igual, sin esta sección, y el error queda registrado.
 */
export async function cargarControlEntregaPdf(empresaId: number, solicitudId: number): Promise<ControlEntregaPdf> {
  try {
    const entregas = await listarEntregasDocumento(empresaId, "FONDOS", solicitudId);
    const { mostrar, hayCerradasSinRecepcion } = seleccionarEntregasParaPdf(entregas);
    if (!mostrar.length) return { filas: [], hayCerradasSinRecepcion };
    const codigos = await codigosDeFirma(
      empresaId,
      mostrar.flatMap((e) => [e.firmaEmisionId, ...(e.firmaRecepcionId != null ? [e.firmaRecepcionId] : [])]),
    );
    return {
      hayCerradasSinRecepcion,
      filas: mostrar.map((e) => ({
        estado: e.estado === "RECIBIDA" ? "RECIBIDA" : "EMITIDA",
        origen: ETIQUETA_AREA[e.etapaOrigen],
        destino: ETIQUETA_AREA[e.etapaDestino],
        presencial: e.modo === "PRESENCIAL",
        emitidoPor: e.emitidoPorNombre,
        emitidoEn: formatearTimestampVisible(e.emitidoEn),
        codigoFirmaEmision: codigos.get(e.firmaEmisionId) ?? null,
        recibidoPor: e.recibidoPorNombre,
        recibidoEn: e.recibidoEn ? formatearTimestampVisible(e.recibidoEn) : null,
        registradoPor: e.recepcionOperadaPorNombre,
        codigoFirmaRecepcion: e.firmaRecepcionId != null ? (codigos.get(e.firmaRecepcionId) ?? null) : null,
      })),
    };
  } catch (error) {
    console.error("PDF fondos: no se pudo cargar el control de entrega", error);
    return CONTROL_ENTREGA_VACIO;
  }
}

/**
 * Líneas de texto del bloque (puras, sin pdfkit). `compacto` = una sola línea por entrega (PDF mensual consolidado).
 * Sin filas y sin movimientos cerrados => sin líneas (el bloque se omite y el PDF queda igual que antes).
 */
export function construirLineasControlEntrega(control: ControlEntregaPdf, compacto = false): string[] {
  const lineas: string[] = [];
  const firma = (c: string | null) => (c ? ` · Firma ${c}` : "");
  for (const f of control.filas) {
    if (f.estado === "EMITIDA") {
      if (compacto) {
        lineas.push(`${f.origen} → ${f.destino}: emitida por ${f.emitidoPor} el ${f.emitidoEn} · Pendiente de recepción`);
      } else {
        lineas.push(`Emitido por: ${f.emitidoPor} · Área origen: ${f.origen} · ${f.emitidoEn}${firma(f.codigoFirmaEmision)}`);
        lineas.push(`Destino: ${f.destino}${f.presencial ? " (recepción presencial)" : ""} · Estado: Pendiente de recepción`);
      }
      continue;
    }
    const recibido = `${f.recibidoPor ?? "—"}${f.registradoPor ? ` (presencial; registrado por ${f.registradoPor})` : ""}`;
    if (compacto) {
      lineas.push(`${f.origen} → ${f.destino}: emitida por ${f.emitidoPor} el ${f.emitidoEn}; recibida por ${recibido} el ${f.recibidoEn ?? "—"}`);
    } else {
      lineas.push(`Emitido por: ${f.emitidoPor} · Área origen: ${f.origen} · ${f.emitidoEn}${firma(f.codigoFirmaEmision)}`);
      lineas.push(`Recibido por: ${recibido} · Área destino: ${f.destino} · ${f.recibidoEn ?? "—"}${firma(f.codigoFirmaRecepcion)} · Estado: Recibida`);
    }
  }
  if (control.hayCerradasSinRecepcion) lineas.push(NOTA_MOVIMIENTOS_CERRADOS);
  return lineas;
}

/** Dibuja el bloque «CONTROL DE ENTREGA» (texto, sin imágenes). No dibuja nada si no hay qué mostrar. */
export function dibujarControlEntregaPdf(
  doc: PdfDoc,
  control: ControlEntregaPdf,
  pageWidth: number,
  marginL: number,
  pageBottom: () => number,
  opciones: { compacto?: boolean } = {},
): void {
  const lineas = construirLineasControlEntrega(control, opciones.compacto);
  if (!lineas.length) return;
  const altura = 26 + lineas.length * 11;
  if (doc.y + altura > pageBottom()) doc.addPage();
  doc.x = marginL;
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("CONTROL DE ENTREGA", { width: pageWidth });
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(8).fillColor("#334155");
  for (const linea of lineas) doc.text(linea, { width: pageWidth });
  doc.x = marginL;
}
