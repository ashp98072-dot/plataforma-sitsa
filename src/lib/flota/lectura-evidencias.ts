import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal, fmtTs } from "@/lib/rrhh/dates";
import { contentTypeFor, guardarUpload } from "@/lib/uploads";

export type TipoEvidenciaLectura = "tablero" | "evidencia";

type UploadLike = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export async function guardarEvidenciaLectura(opts: {
  empresaId: number;
  lecturaId: number;
  tipo: TipoEvidenciaLectura;
  file: UploadLike;
  latitud?: number | null;
  longitud?: number | null;
  capturadoEn?: string | null;
  username: string;
}): Promise<number> {
  const saved = await guardarUpload(
    opts.empresaId,
    "flota",
    `lectura_${opts.lecturaId}_${opts.tipo}`,
    opts.file,
  );
  const ahora = ahoraLocal();
  const capturado = fmtTs(opts.capturadoEn) || ahora;
  const r = await execute(
    `INSERT INTO flota_lectura_evidencias
      (empresa_id, lectura_id, tipo, ruta_relativa, nombre_original, mime, tamano,
       latitud, longitud, capturado_en, subido_por, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.empresaId,
      opts.lecturaId,
      opts.tipo,
      saved.relative,
      saved.original,
      contentTypeFor(saved.original),
      saved.size,
      opts.latitud ?? null,
      opts.longitud ?? null,
      capturado,
      opts.username,
      ahora,
    ],
  );
  return Number(r.insertId);
}

export async function listarEvidenciasLectura(
  empresaId: number,
  lecturaId: number,
): Promise<RowDataPacket[]> {
  return query<RowDataPacket[]>(
    `SELECT id, lectura_id, tipo, ruta_relativa, nombre_original, mime, tamano,
            latitud, longitud, capturado_en, subido_por, creado_at
     FROM flota_lectura_evidencias
     WHERE empresa_id = ? AND lectura_id = ?
     ORDER BY id ASC`,
    [empresaId, lecturaId],
  );
}
