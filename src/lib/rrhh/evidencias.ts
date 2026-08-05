import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { borrarUpload } from "@/lib/uploads";

export type Evidencia = {
  id: number;
  empresaId: number;
  incidenciaId: number;
  rutaArchivo: string;
  nombreOriginal: string | null;
  subidoEn: string;
  subidoPor: string | null;
};

function mapEv(r: RowDataPacket): Evidencia {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    incidenciaId: Number(r.incidencia_id),
    rutaArchivo: String(r.ruta_archivo),
    nombreOriginal: r.nombre_original ? String(r.nombre_original) : null,
    subidoEn: String(r.subido_en),
    subidoPor: r.subido_por ? String(r.subido_por) : null,
  };
}

export async function listarEvidencias(
  empresaId: number,
  incidenciaId: number,
): Promise<Evidencia[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, incidencia_id, ruta_archivo, nombre_original,
            subido_en, subido_por
     FROM evidencias_incidencias
     WHERE empresa_id = ? AND incidencia_id = ?
     ORDER BY subido_en DESC`,
    [empresaId, incidenciaId],
  );
  return rows.map(mapEv);
}

export async function obtenerEvidencia(
  empresaId: number,
  id: number,
): Promise<Evidencia | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, incidencia_id, ruta_archivo, nombre_original,
            subido_en, subido_por
     FROM evidencias_incidencias
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapEv(rows[0]) : null;
}

export async function contarEvidenciasPorIncidencia(
  empresaId: number,
  ids: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  const ph = ids.map(() => "?").join(",");
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT incidencia_id, COUNT(*) AS total
       FROM evidencias_incidencias
       WHERE empresa_id = ? AND incidencia_id IN (${ph})
       GROUP BY incidencia_id`,
      [empresaId, ...ids],
    );
    for (const r of rows) {
      map.set(Number(r.incidencia_id), Number(r.total));
    }
  } catch {
    // tabla aún no migrada
  }
  return map;
}

export async function registrarEvidencia(input: {
  empresaId: number;
  incidenciaId: number;
  rutaArchivo: string;
  nombreOriginal: string;
  subidoPor: string;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO evidencias_incidencias
      (empresa_id, incidencia_id, ruta_archivo, nombre_original, subido_por)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.empresaId,
      input.incidenciaId,
      input.rutaArchivo,
      input.nombreOriginal,
      input.subidoPor,
    ],
  );
  return Number((result as ResultSetHeader).insertId);
}

export async function eliminarEvidencia(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const ev = await obtenerEvidencia(empresaId, id);
  if (!ev) return { ok: false, mensaje: "Evidencia no encontrada." };
  await execute(
    "DELETE FROM evidencias_incidencias WHERE id = ? AND empresa_id = ?",
    [id, empresaId],
  );
  borrarUpload(ev.rutaArchivo);
  return { ok: true, mensaje: "Evidencia eliminada." };
}
