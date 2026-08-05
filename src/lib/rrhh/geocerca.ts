import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { obtenerParametros } from "@/lib/rrhh/config";
import { hoyLocal } from "@/lib/rrhh/dates";

/** Distancia en metros (Haversine). */
export function distanciaMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeocercaConfig = {
  activa: boolean;
  lat: number | null;
  lng: number | null;
  radioM: number;
};

export async function obtenerGeocerca(
  empresaId: number,
): Promise<GeocercaConfig> {
  const p = await obtenerParametros(empresaId);
  const lat = Number.parseFloat(p.geocerca_lat ?? "");
  const lng = Number.parseFloat(p.geocerca_lng ?? "");
  const radio = Number.parseInt(p.geocerca_radio_m ?? "150", 10);
  return {
    activa: String(p.geocerca_activa ?? "0") === "1",
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    radioM: Number.isFinite(radio) && radio > 0 ? radio : 150,
  };
}

async function empleadoEnRutaHoy(
  empresaId: number,
  empleadoId: number,
): Promise<boolean> {
  const hoy = hoyLocal();
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id FROM marcajes_en_ruta
       WHERE empresa_id = ? AND id_empleado = ?
         AND fecha_inicio <= ? AND fecha_fin >= ?
       LIMIT 1`,
      [empresaId, empleadoId, hoy, hoy],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Valida geocerca para kiosko.
 * - Si no está activa o mal configurada → permite.
 * - Empleado "en ruta" hoy → permite (viaja).
 * - Sin GPS del dispositivo → bloquea si geocerca activa.
 * - Fuera del radio → bloquea.
 */
export async function validarGeocercaKiosko(
  empresaId: number,
  empleadoId: number,
  coords: { lat?: number | null; lng?: number | null } | null | undefined,
): Promise<{ ok: true; metros?: number } | { ok: false; error: string; code: string }> {
  const geo = await obtenerGeocerca(empresaId);
  if (!geo.activa || geo.lat == null || geo.lng == null) {
    return { ok: true };
  }

  if (await empleadoEnRutaHoy(empresaId, empleadoId)) {
    return { ok: true };
  }

  const lat = coords?.lat != null ? Number(coords.lat) : NaN;
  const lng = coords?.lng != null ? Number(coords.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      ok: false,
      code: "GPS_REQUERIDO",
      error:
        "Esta empresa exige marcar dentro del predio. Activa la ubicación (GPS) del teléfono/navegador e intenta de nuevo.",
    };
  }

  const metros = distanciaMetros(geo.lat, geo.lng, lat, lng);
  if (metros > geo.radioM) {
    return {
      ok: false,
      code: "FUERA_GEOCERCA",
      error: `Estás fuera del área permitida (~${Math.round(metros)} m). Debes marcar a menos de ${geo.radioM} m del predio.`,
    };
  }
  return { ok: true, metros: Math.round(metros) };
}
