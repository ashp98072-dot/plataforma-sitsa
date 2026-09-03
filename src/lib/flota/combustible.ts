import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { contentTypeFor, guardarUpload } from "@/lib/uploads";

/**
 * FLOTA-COMBUSTIBLE-1 — control de combustible (Fase 1: captura del
 * piloto). El piloto registra, desde su Portal y siempre ligado a un
 * viaje abierto/propio (flota_viajes), cuánto cargó de diesel/gasolina,
 * el monto pagado, el kilometraje y la foto del vale — igual patrón de
 * archivo que guardarEvidenciaViaje() (mismo guardarUpload(), mismo
 * subdir "flota"). Queda en estado PENDIENTE; la revisión/aprobación de
 * Operaciones es una fase aparte, todavía no construida.
 */

export type TipoCombustible = "diesel" | "gasolina";

export type CargaCombustible = {
  id: number;
  viajeId: number;
  tipoCombustible: TipoCombustible;
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  nombreArchivo: string;
  estado: "PENDIENTE" | "APROBADO" | "RECHAZADO";
  motivoRechazo: string | null;
  creadoPor: string;
  creadoEn: string;
};

type UploadLike = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function mapCarga(r: RowDataPacket): CargaCombustible {
  return {
    id: Number(r.id),
    viajeId: Number(r.viaje_id),
    tipoCombustible: String(r.tipo_combustible) === "gasolina" ? "gasolina" : "diesel",
    galones: Number(r.galones),
    monto: Number(r.monto),
    km: r.km != null ? Number(r.km) : null,
    gasolinera: r.gasolinera ? String(r.gasolinera) : null,
    nombreArchivo: String(r.nombre_original),
    estado: (["PENDIENTE", "APROBADO", "RECHAZADO"] as const).includes(r.estado)
      ? (r.estado as CargaCombustible["estado"])
      : "PENDIENTE",
    motivoRechazo: r.motivo_rechazo ? String(r.motivo_rechazo) : null,
    creadoPor: String(r.creado_por),
    creadoEn: String(r.creado_at),
  };
}

/**
 * `viajeId`/`vehiculoId`/`empleadoId` ya deben venir validados por el
 * caller (el route verifica con colaboradorParticipaEnViaje() que el
 * piloto participa en ESE viaje, igual que hace evidencias) — esta
 * función no vuelve a comprobar pertenencia, solo persiste.
 */
export async function registrarCargaCombustible(opts: {
  empresaId: number;
  vehiculoId: number;
  viajeId: number;
  empleadoId: number;
  pilotoNombre: string;
  tipoCombustible: TipoCombustible;
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  file: UploadLike;
  username: string;
}): Promise<number> {
  const saved = await guardarUpload(
    opts.empresaId,
    "flota",
    `combustible_${opts.viajeId}`,
    opts.file,
  );
  const ahora = ahoraLocal();
  const r = await execute(
    `INSERT INTO flota_combustible_cargas
      (empresa_id, vehiculo_id, viaje_id, empleado_id, piloto_nombre, tipo_combustible,
       galones, monto, km, gasolinera, ruta_relativa, nombre_original, mime, tamano,
       estado, creado_por, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)`,
    [
      opts.empresaId,
      opts.vehiculoId,
      opts.viajeId,
      opts.empleadoId,
      opts.pilotoNombre,
      opts.tipoCombustible,
      opts.galones,
      opts.monto,
      opts.km,
      opts.gasolinera,
      saved.relative,
      saved.original,
      contentTypeFor(saved.original),
      saved.size,
      opts.username,
      ahora,
    ],
  );
  return Number(r.insertId);
}

export async function listarCargasCombustibleViaje(
  empresaId: number,
  viajeId: number,
): Promise<CargaCombustible[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, viaje_id, tipo_combustible, galones, monto, km, gasolinera,
            nombre_original, estado, motivo_rechazo, creado_por, creado_at
     FROM flota_combustible_cargas
     WHERE empresa_id = ? AND viaje_id = ?
     ORDER BY id DESC`,
    [empresaId, viajeId],
  );
  return rows.map(mapCarga);
}

/** Solo lo necesario para servir la foto del vale (ruta/mime), acotado a empresa + viaje. */
export async function obtenerArchivoCargaCombustible(
  empresaId: number,
  viajeId: number,
  cargaId: number,
): Promise<{ rutaRelativa: string; nombreOriginal: string; mime: string | null } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime FROM flota_combustible_cargas
     WHERE id = ? AND viaje_id = ? AND empresa_id = ? LIMIT 1`,
    [cargaId, viajeId, empresaId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    rutaRelativa: String(row.ruta_relativa),
    nombreOriginal: String(row.nombre_original),
    mime: row.mime ? String(row.mime) : null,
  };
}
