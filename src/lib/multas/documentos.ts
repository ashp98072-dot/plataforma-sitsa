import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

/**
 * MULTAS-5 — documentos del expediente de una multa. Reutiliza
 * ops_multa_documentos (creada en MULTAS-2, migrate-2026-08-operaciones-
 * multas.sql) — no crea tabla ni motor de almacenamiento propio; el
 * archivo físico se guarda con guardarUpload() (src/lib/uploads.ts,
 * subdir "multas"), mismo patrón que RRHH/Flota.
 *
 * Baja lógica (sección 9 del ticket): ops_multa_documentos YA fue
 * diseñada en MULTAS-2 con eliminado_en/eliminado_por_usuario_id/
 * motivo_eliminacion para esto — "el futuro CRUD usará eliminación
 * lógica de documentos, no DELETE" (comentario original de esa
 * migración). Este módulo cumple esa promesa: eliminarDocumentoMulta()
 * nunca hace DELETE ni borra el archivo físico.
 */

export const TIPOS_DOCUMENTO_MULTA = [
  "MULTA",
  "COMPROBANTE_PAGO",
  "FACTURA",
  "OTRO",
] as const;
export type TipoDocumentoMulta = (typeof TIPOS_DOCUMENTO_MULTA)[number];

export type DocumentoMulta = {
  id: number;
  empresaId: number;
  multaId: number;
  rutaRelativa: string;
  nombreOriginal: string;
  mimeType: string;
  tamano: number;
  tipoDocumento: TipoDocumentoMulta;
  subidoPorUsuarioId: number;
  subidoEn: string;
};

function mapDoc(r: RowDataPacket): DocumentoMulta {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    multaId: Number(r.multa_id),
    rutaRelativa: String(r.ruta_relativa),
    nombreOriginal: String(r.nombre_original),
    mimeType: String(r.mime_type),
    tamano: Number(r.tamano),
    tipoDocumento: String(r.tipo_documento) as TipoDocumentoMulta,
    subidoPorUsuarioId: Number(r.subido_por_usuario_id),
    subidoEn: String(r.subido_en),
  };
}

const SELECT =
  "SELECT id, empresa_id, multa_id, ruta_relativa, nombre_original, mime_type, tamano, tipo_documento, subido_por_usuario_id, subido_en FROM ops_multa_documentos";

/** Solo documentos activos (no eliminados lógicamente) de una multa. */
export async function listarDocumentosMulta(
  empresaId: number,
  multaId: number,
): Promise<DocumentoMulta[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND multa_id = ? AND eliminado_en IS NULL ORDER BY subido_en DESC`,
    [empresaId, multaId],
  );
  return rows.map(mapDoc);
}

/** Un documento puntual — usado para servir el archivo (valida tenant antes de leer disco). */
export async function obtenerDocumentoMulta(
  empresaId: number,
  id: number,
): Promise<DocumentoMulta | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE id = ? AND empresa_id = ? AND eliminado_en IS NULL LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapDoc(rows[0]) : null;
}

export async function registrarDocumentoMulta(input: {
  empresaId: number;
  multaId: number;
  tipoDocumento: TipoDocumentoMulta;
  rutaRelativa: string;
  nombreOriginal: string;
  mimeType: string;
  tamano: number;
  subidoPorUsuarioId: number;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO ops_multa_documentos
      (empresa_id, multa_id, ruta_relativa, nombre_original, mime_type, tamano, tipo_documento, subido_por_usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      input.multaId,
      input.rutaRelativa,
      input.nombreOriginal,
      input.mimeType,
      input.tamano,
      input.tipoDocumento,
      input.subidoPorUsuarioId,
    ],
  );
  return Number((result as ResultSetHeader).insertId);
}

/** Baja lógica — nunca DELETE, nunca borra el archivo físico. */
export async function eliminarDocumentoMulta(
  empresaId: number,
  id: number,
  usuarioId: number,
  motivo: string,
): Promise<{ ok: boolean; mensaje: string }> {
  const doc = await obtenerDocumentoMulta(empresaId, id);
  if (!doc) return { ok: false, mensaje: "Documento no encontrado." };
  const r = await execute(
    `UPDATE ops_multa_documentos
     SET eliminado_en = NOW(), eliminado_por_usuario_id = ?, motivo_eliminacion = ?
     WHERE id = ? AND empresa_id = ? AND eliminado_en IS NULL`,
    [usuarioId, motivo, id, empresaId],
  );
  if ((r as ResultSetHeader).affectedRows !== 1) {
    return { ok: false, mensaje: "El documento ya estaba eliminado." };
  }
  return { ok: true, mensaje: "Documento dado de baja." };
}
