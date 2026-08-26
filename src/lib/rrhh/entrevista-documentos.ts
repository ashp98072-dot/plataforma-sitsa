import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query } from "@/lib/db";
import { borrarUpload } from "@/lib/uploads";

export const TIPOS_DOCUMENTO_CANDIDATO = [
  "Currículum",
  "DPI",
  "Licencia",
  "Antecedentes penales",
  "Antecedentes policíacos",
  "Constancia laboral",
  "Título o diploma",
  "Otro",
] as const;

export type DocumentoEntrevista = {
  id: number;
  tipoDocumento: string;
  rutaArchivo: string;
  nombreOriginal: string | null;
  subidoEn: string;
};

function mapDoc(r: RowDataPacket): DocumentoEntrevista {
  return {
    id: Number(r.id),
    tipoDocumento: String(r.tipo_documento ?? "Otro"),
    rutaArchivo: String(r.ruta_archivo),
    nombreOriginal: r.nombre_original ? String(r.nombre_original) : null,
    subidoEn: String(r.subido_en),
  };
}

export async function listarDocumentosEntrevista(empresaId: number, entrevistaId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, tipo_documento, ruta_archivo, nombre_original, subido_en
     FROM entrevista_documentos
     WHERE empresa_id = ? AND entrevista_id = ? ORDER BY subido_en DESC`,
    [empresaId, entrevistaId],
  );
  return rows.map(mapDoc);
}

export async function registrarDocumentoEntrevista(input: {
  empresaId: number; entrevistaId: number; tipoDocumento: string;
  rutaArchivo: string; nombreOriginal: string; subidoPor: string;
}) {
  const result = await execute(
    `INSERT INTO entrevista_documentos
      (empresa_id, entrevista_id, tipo_documento, ruta_archivo, nombre_original, subido_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.empresaId, input.entrevistaId, input.tipoDocumento, input.rutaArchivo,
      input.nombreOriginal, input.subidoPor],
  );
  return Number((result as ResultSetHeader).insertId);
}

export async function obtenerDocumentoEntrevista(empresaId: number, id: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, tipo_documento, ruta_archivo, nombre_original, subido_en
     FROM entrevista_documentos WHERE empresa_id = ? AND id = ? LIMIT 1`,
    [empresaId, id],
  );
  return rows[0] ? mapDoc(rows[0]) : null;
}

export async function eliminarDocumentoEntrevista(empresaId: number, id: number) {
  const doc = await obtenerDocumentoEntrevista(empresaId, id);
  if (!doc) return false;
  await execute("DELETE FROM entrevista_documentos WHERE empresa_id = ? AND id = ?", [empresaId, id]);
  borrarUpload(doc.rutaArchivo);
  return true;
}

/** Mueve la propiedad lógica al expediente laboral sin copiar el archivo físico. */
export async function transferirDocumentosAEmpleado(
  conn: PoolConnection, empresaId: number, entrevistaId: number, empleadoId: number,
) {
  const [entrevistas] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM entrevistas
     WHERE id = ? AND empresa_id = ? AND resultado = 'Aprobado' LIMIT 1 FOR UPDATE`,
    [entrevistaId, empresaId],
  );
  if (!entrevistas[0]) throw new Error("La entrevista aprobada no pertenece a esta empresa.");
  await conn.execute(
    `INSERT INTO documentos_empleados
      (empresa_id, id_empleado, tipo_documento, ruta_archivo, nombre_original, subido_en, subido_por)
     SELECT empresa_id, ?, tipo_documento, ruta_archivo, nombre_original, subido_en, subido_por
     FROM entrevista_documentos WHERE empresa_id = ? AND entrevista_id = ?`,
    [empleadoId, empresaId, entrevistaId],
  );
  await conn.execute(
    "DELETE FROM entrevista_documentos WHERE empresa_id = ? AND entrevista_id = ?",
    [empresaId, entrevistaId],
  );
}
