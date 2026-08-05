import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { contentTypeFor, guardarUpload } from "@/lib/uploads";

export type TipoEvidenciaViaje =
  | "tablero_salida"
  | "salida"
  | "tablero_llegada"
  | "llegada";

type UploadLike = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export async function guardarEvidenciaViaje(opts: {
  empresaId: number;
  viajeId: number;
  tipo: TipoEvidenciaViaje;
  file: UploadLike;
  latitud?: number | null;
  longitud?: number | null;
  capturadoEn?: string | null;
  username: string;
  planId?: number | null;
  syncTmsTipo?: "Carga" | "Descarga" | null;
}): Promise<number> {
  const saved = await guardarUpload(
    opts.empresaId,
    "flota",
    `viaje_${opts.viajeId}_${opts.tipo}`,
    opts.file,
  );
  const ahora = ahoraLocal();
  const r = await execute(
    `INSERT INTO flota_viaje_evidencias
      (empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, mime, tamano,
       latitud, longitud, capturado_en, subido_por, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.empresaId,
      opts.viajeId,
      opts.tipo,
      saved.relative,
      saved.original,
      contentTypeFor(saved.original),
      saved.size,
      opts.latitud ?? null,
      opts.longitud ?? null,
      opts.capturadoEn || ahora,
      opts.username,
      ahora,
    ],
  );

  if (opts.planId && opts.syncTmsTipo) {
    await execute(
      `INSERT INTO tms_evidencias
        (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud, subido_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.empresaId,
        opts.planId,
        opts.syncTmsTipo,
        saved.relative,
        saved.original,
        opts.latitud ?? null,
        opts.longitud ?? null,
        opts.username,
      ],
    ).catch(() => undefined);
  }

  return Number(r.insertId);
}

export async function listarEvidenciasViaje(
  empresaId: number,
  viajeId: number,
): Promise<RowDataPacket[]> {
  return query<RowDataPacket[]>(
    `SELECT id, viaje_id, tipo, ruta_relativa, nombre_original, mime, tamano,
            latitud, longitud, capturado_en, subido_por, creado_at
     FROM flota_viaje_evidencias
     WHERE empresa_id = ? AND viaje_id = ?
     ORDER BY id ASC`,
    [empresaId, viajeId],
  );
}
