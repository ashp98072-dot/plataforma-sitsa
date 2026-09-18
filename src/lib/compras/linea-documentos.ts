import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ETIQUETAS_TIPO_LINEA_DOCUMENTO, TIPOS_LINEA_DOCUMENTO, type TipoLineaDocumento } from "./linea-documentos-schema";

// Re-exportadas tal cual — fuente única en linea-documentos-schema.ts (sin
// mysql2/db/fs), así linea-documentos-client.tsx ("use client") puede
// importar el catálogo directamente desde ahí sin arrastrar este módulo
// server-only a su bundle. Ningún consumidor existente de este archivo
// (route.ts, linea-documentos-api.ts, tests) cambia su import.
export { ETIQUETAS_TIPO_LINEA_DOCUMENTO, TIPOS_LINEA_DOCUMENTO, type TipoLineaDocumento };

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — documentos adjuntos a una línea de un
 * Requerimiento de compra. Reutiliza la tabla existente
 * `compras_linea_documentos` (creada en migrate-2026-09-compras-base.sql,
 * ya en producción) — no crea tabla ni motor de almacenamiento propio; el
 * archivo físico se guarda con guardarUpload() (src/lib/uploads.ts, subdir
 * "compras"), mismo patrón ya usado en RRHH/Flota/Multas.
 *
 * Baja lógica: la tabla ya fue diseñada con retirado/retirado_por_usuario_id/
 * retirado_en/motivo_retiro (mismo patrón que ops_multa_documentos) —
 * retirarDocumentoLinea() nunca hace DELETE ni borra el archivo físico.
 *
 * AUDITORÍA DEL ESQUEMA EXISTENTE (antes de escribir este archivo):
 * la tabla YA tiene id/empresa_id/requerimiento_id/linea_id/tipo/
 * ruta_relativa/nombre_original/mime/tamano/sha256/subido_por_usuario_id/
 * subido_en/retirado*, cubriendo todos los campos pedidos por el ticket
 * (nombre original, mime/type, tamaño, ruta/storage key, tipo_documento,
 * usuario que subió, fecha de carga). NO requiere migración para el caso
 * base.
 *
 * ÚNICA BRECHA encontrada: `tipo VARCHAR(20)` tiene
 * `CHECK (tipo IN ('FACTURA', 'COMPROBANTE'))` — solo 2 valores. Los tipos
 * sugeridos por el ticket (Cotización, Orden de compra, Nota de crédito,
 * Otro) NO caben en ese CHECK todavía. Se preparó una migración/preflight
 * para ampliarlo (ver sql/migrate-2026-09-compras-documentos-linea-tipo.sql
 * y su preflight) — NO ejecutada. Hasta que se aplique, la BD solo acepta
 * FACTURA/COMPROBANTE; los otros 4 tipos quedan validados en la aplicación
 * (TIPOS_LINEA_DOCUMENTO, ver linea-documentos-schema.ts) pero el INSERT
 * fallará con un error de MySQL (constraint check) si se intentan antes de
 * migrar.
 */

export type DocumentoLineaCompra = {
  id: number;
  empresaId: number;
  requerimientoId: number;
  lineaId: number;
  tipo: TipoLineaDocumento;
  rutaRelativa: string;
  nombreOriginal: string;
  mime: string;
  tamano: number;
  subidoPorUsuarioId: number;
  subidoEn: string;
};

function mapDoc(r: RowDataPacket): DocumentoLineaCompra {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    requerimientoId: Number(r.requerimiento_id),
    lineaId: Number(r.linea_id),
    tipo: String(r.tipo) as TipoLineaDocumento,
    rutaRelativa: String(r.ruta_relativa),
    nombreOriginal: String(r.nombre_original),
    mime: String(r.mime),
    tamano: Number(r.tamano),
    subidoPorUsuarioId: Number(r.subido_por_usuario_id),
    subidoEn: String(r.subido_en),
  };
}

const SELECT =
  "SELECT id, empresa_id, requerimiento_id, linea_id, tipo, ruta_relativa, nombre_original, mime, tamano, subido_por_usuario_id, subido_en FROM compras_linea_documentos";

/**
 * Verifica que la línea pertenezca al requerimiento y a la empresa ANTES
 * de listar/subir — nunca confiar en ids enviados por el frontend. Usa el
 * mismo índice único (empresa_id, requerimiento_id, id) que ya protege
 * compras_requerimiento_lineas.
 */
export async function lineaPerteneceARequerimiento(
  empresaId: number,
  requerimientoId: number,
  lineaId: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id FROM compras_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? AND id = ? LIMIT 1",
    [empresaId, requerimientoId, lineaId],
  );
  return rows.length > 0;
}

/** Solo documentos activos (no retirados) de una línea. */
export async function listarDocumentosLinea(
  empresaId: number,
  requerimientoId: number,
  lineaId: number,
): Promise<DocumentoLineaCompra[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND requerimiento_id = ? AND linea_id = ? AND retirado = 0 ORDER BY subido_en DESC`,
    [empresaId, requerimientoId, lineaId],
  );
  return rows.map(mapDoc);
}

/** Un documento puntual — usado para servir el archivo (valida tenant antes de leer disco). */
export async function obtenerDocumentoLinea(
  empresaId: number,
  id: number,
): Promise<DocumentoLineaCompra | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE id = ? AND empresa_id = ? AND retirado = 0 LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapDoc(rows[0]) : null;
}

export async function registrarDocumentoLinea(input: {
  empresaId: number;
  requerimientoId: number;
  lineaId: number;
  tipo: TipoLineaDocumento;
  rutaRelativa: string;
  nombreOriginal: string;
  mime: string;
  tamano: number;
  subidoPorUsuarioId: number;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO compras_linea_documentos
      (empresa_id, requerimiento_id, linea_id, tipo, ruta_relativa, nombre_original, mime, tamano, subido_por_usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      input.requerimientoId,
      input.lineaId,
      input.tipo,
      input.rutaRelativa,
      input.nombreOriginal,
      input.mime,
      input.tamano,
      input.subidoPorUsuarioId,
    ],
  );
  return Number((result as ResultSetHeader).insertId);
}

export type RetirarDocumentoResultado =
  | { ok: true; mensaje: string }
  | { ok: false; status: 404 | 409; mensaje: string };

/**
 * Baja lógica — nunca DELETE, nunca borra el archivo físico. Regla elegida
 * (documentada explícitamente, ver PR): eliminar/retirar un documento SOLO
 * se permite mientras el requerimiento esté en estado 'Pendiente' — más
 * restrictivo que subir (que se permite en cualquier estado, ya que la
 * factura/comprobante suele llegar después de autorizar). El UPDATE valida
 * el estado con un JOIN atómico contra compras_requerimientos, evitando
 * una carrera entre leer el estado y escribir el retiro.
 */
export async function retirarDocumentoLinea(
  empresaId: number,
  id: number,
  usuarioId: number,
  motivo: string | null,
): Promise<RetirarDocumentoResultado> {
  const doc = await obtenerDocumentoLinea(empresaId, id);
  if (!doc) return { ok: false, status: 404, mensaje: "Documento no encontrado." };
  const result = await execute(
    `UPDATE compras_linea_documentos d
     INNER JOIN compras_requerimientos r ON r.empresa_id = d.empresa_id AND r.id = d.requerimiento_id
     SET d.retirado = 1, d.retirado_por_usuario_id = ?, d.retirado_en = NOW(), d.motivo_retiro = ?
     WHERE d.id = ? AND d.empresa_id = ? AND d.retirado = 0 AND r.estado = 'Pendiente'`,
    [usuarioId, motivo, id, empresaId],
  );
  if ((result as ResultSetHeader).affectedRows !== 1) {
    return {
      ok: false,
      status: 409,
      mensaje: "Solo se pueden eliminar documentos mientras el requerimiento esté Pendiente.",
    };
  }
  return { ok: true, mensaje: "Documento eliminado." };
}
