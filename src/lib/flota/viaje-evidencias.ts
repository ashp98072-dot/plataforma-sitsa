import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { borrarUpload, contentTypeFor, guardarUpload } from "@/lib/uploads";

export type TipoEvidenciaViaje =
  | "tablero_salida"
  | "salida"
  | "tablero_llegada"
  | "llegada"
  | "producto";

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
  paradaId?: number | null;
  syncTmsTipo?: "Carga" | "Descarga" | "Producto" | null;
}): Promise<number> {
  const saved = await guardarUpload(
    opts.empresaId,
    "flota",
    `viaje_${opts.viajeId}_${opts.tipo}`,
    opts.file,
  );
  const ahora = ahoraLocal();
  let r;
  try {
    r = await execute(
      `INSERT INTO flota_viaje_evidencias
        (empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, mime, tamano,
         latitud, longitud, capturado_en, subido_por, creado_at, parada_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        opts.paradaId ?? null,
      ],
    );
  } catch {
    r = await execute(
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
  }

  const planIdSync = opts.planId ?? null;
  const tmsTipo = opts.syncTmsTipo ?? null;
  if (planIdSync && tmsTipo) {
    const paradaSync = opts.paradaId ?? null;
    await execute(
      `INSERT INTO tms_evidencias
        (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud,
         subido_por, parada_id, capturado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.empresaId,
        planIdSync,
        tmsTipo,
        saved.relative,
        saved.original,
        opts.latitud ?? null,
        opts.longitud ?? null,
        opts.username,
        paradaSync,
        opts.capturadoEn || ahora,
      ],
    ).catch(async () => {
      await execute(
        `INSERT INTO tms_evidencias
          (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          opts.empresaId,
          planIdSync,
          tmsTipo,
          saved.relative,
          saved.original,
          opts.latitud ?? null,
          opts.longitud ?? null,
          opts.username,
        ],
      ).catch(() => undefined);
    });
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

/** Elimina evidencia de viaje (archivo + fila; limpia copia TMS si comparte ruta). */
export async function eliminarEvidenciaViaje(
  empresaId: number,
  viajeId: number,
  evidenciaId: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, ruta_relativa FROM flota_viaje_evidencias
     WHERE id = ? AND viaje_id = ? AND empresa_id = ? LIMIT 1`,
    [evidenciaId, viajeId, empresaId],
  );
  if (!rows[0]) {
    return { ok: false, mensaje: "Evidencia no encontrada." };
  }
  const ruta = String(rows[0].ruta_relativa ?? "");
  await execute(
    `DELETE FROM flota_viaje_evidencias
     WHERE id = ? AND viaje_id = ? AND empresa_id = ?`,
    [evidenciaId, viajeId, empresaId],
  );
  if (ruta) {
    await execute(
      `DELETE FROM tms_evidencias WHERE empresa_id = ? AND ruta_archivo = ?`,
      [empresaId, ruta],
    ).catch(() => undefined);
    borrarUpload(ruta);
  }
  return { ok: true, mensaje: "Evidencia eliminada." };
}

export async function eliminarEvidenciaTms(
  empresaId: number,
  evidenciaId: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, ruta_archivo FROM tms_evidencias
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [evidenciaId, empresaId],
  );
  if (!rows[0]) {
    return { ok: false, mensaje: "Evidencia no encontrada." };
  }
  const ruta = String(rows[0].ruta_archivo ?? "");
  await execute(
    `DELETE FROM tms_evidencias WHERE id = ? AND empresa_id = ?`,
    [evidenciaId, empresaId],
  );
  if (ruta) {
    // Si también está en flota (misma ruta), quitarla
    await execute(
      `DELETE FROM flota_viaje_evidencias WHERE empresa_id = ? AND ruta_relativa = ?`,
      [empresaId, ruta],
    ).catch(() => undefined);
    borrarUpload(ruta);
  }
  return { ok: true, mensaje: "Evidencia eliminada." };
}
