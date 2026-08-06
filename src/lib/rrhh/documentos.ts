import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { borrarUpload } from "@/lib/uploads";

export const TIPOS_DOCUMENTO = [
  "DPI",
  "Foto",
  "Contrato",
  "Licencia",
  "Antecedentes penales",
  "Antecedentes policíacos",
  "Tarjeta de pulmones",
  "Tarjeta de salud",
  "Manipulación de alimentos",
  "IGSS",
  "Boleta permiso",
  "Otro",
] as const;

export type DocumentoEmpleado = {
  id: number;
  empresaId: number;
  idEmpleado: number;
  tipoDocumento: string;
  rutaArchivo: string;
  nombreOriginal: string | null;
  subidoEn: string;
  subidoPor: string | null;
};

function mapDoc(r: RowDataPacket): DocumentoEmpleado {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    idEmpleado: Number(r.id_empleado),
    tipoDocumento: String(r.tipo_documento ?? "Otro"),
    rutaArchivo: String(r.ruta_archivo),
    nombreOriginal: r.nombre_original ? String(r.nombre_original) : null,
    subidoEn: String(r.subido_en),
    subidoPor: r.subido_por ? String(r.subido_por) : null,
  };
}

export async function listarDocumentos(
  empresaId: number,
  idEmpleado: number,
): Promise<DocumentoEmpleado[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, id_empleado, tipo_documento, ruta_archivo,
            nombre_original, subido_en, subido_por
     FROM documentos_empleados
     WHERE empresa_id = ? AND id_empleado = ?
     ORDER BY subido_en DESC`,
    [empresaId, idEmpleado],
  );
  return rows.map(mapDoc);
}

export async function obtenerDocumento(
  empresaId: number,
  id: number,
): Promise<DocumentoEmpleado | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, id_empleado, tipo_documento, ruta_archivo,
            nombre_original, subido_en, subido_por
     FROM documentos_empleados
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapDoc(rows[0]) : null;
}

export async function contarDocumentosPorEmpleado(
  empresaId: number,
  ids: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  const ph = ids.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT id_empleado, COUNT(*) AS total
     FROM documentos_empleados
     WHERE empresa_id = ? AND id_empleado IN (${ph})
     GROUP BY id_empleado`,
    [empresaId, ...ids],
  );
  for (const r of rows) {
    map.set(Number(r.id_empleado), Number(r.total));
  }
  return map;
}

export async function registrarDocumento(input: {
  empresaId: number;
  idEmpleado: number;
  tipoDocumento: string;
  rutaArchivo: string;
  nombreOriginal: string;
  subidoPor: string;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO documentos_empleados
      (empresa_id, id_empleado, tipo_documento, ruta_archivo, nombre_original, subido_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      input.idEmpleado,
      input.tipoDocumento,
      input.rutaArchivo,
      input.nombreOriginal,
      input.subidoPor,
    ],
  );
  return Number((result as ResultSetHeader).insertId);
}

export async function eliminarDocumento(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const doc = await obtenerDocumento(empresaId, id);
  if (!doc) return { ok: false, mensaje: "Documento no encontrado." };
  await execute(
    "DELETE FROM documentos_empleados WHERE id = ? AND empresa_id = ?",
    [id, empresaId],
  );
  borrarUpload(doc.rutaArchivo);
  return { ok: true, mensaje: "Documento eliminado." };
}
