import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { obtenerParametros } from "@/lib/rrhh/config";
import { hoyLocal } from "@/lib/rrhh/dates";

/** Distancia en metros entre dos coordenadas usando Haversine. */
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
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Configuración antigua de geocerca.
 *
 * Se conserva temporalmente por compatibilidad con módulos que todavía
 * puedan consultar geocerca_lat/geocerca_lng/geocerca_radio_m.
 */
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

type UbicacionMarcajeRow = RowDataPacket & {
  id: number;
  empresa_id: number;
  nombre: string;
  lat: string | number;
  lng: string | number;
  radio_m: number;
};

export type UbicacionMarcaje = {
  id: number;
  empresaId: number;
  nombre: string;
  lat: number;
  lng: number;
  radioM: number;
};

/**
 * Obtiene TODAS las ubicaciones de marcaje activas del grupo.
 *
 * Importante:
 * empresa_id identifica la empresa administradora/propietaria de la ubicación,
 * pero NO restringe qué empleados pueden marcar ahí.
 *
 * Cualquier empleado de cualquiera de las empresas del grupo puede marcar
 * dentro de cualquiera de estas ubicaciones activas.
 */
export async function obtenerUbicacionesMarcajeActivas(): Promise<
  UbicacionMarcaje[]
> {
  const rows = await query<UbicacionMarcajeRow[]>(
    `SELECT
       id,
       empresa_id,
       nombre,
       lat,
       lng,
       radio_m
     FROM ubicaciones_marcaje
     WHERE activa = 1
     ORDER BY nombre ASC, id ASC`,
  );

  return rows
    .map((row) => ({
      id: Number(row.id),
      empresaId: Number(row.empresa_id),
      nombre: String(row.nombre),
      lat: Number(row.lat),
      lng: Number(row.lng),
      radioM: Number(row.radio_m),
    }))
    .filter(
      (ubicacion) =>
        Number.isFinite(ubicacion.lat) &&
        Number.isFinite(ubicacion.lng) &&
        Number.isFinite(ubicacion.radioM) &&
        ubicacion.radioM > 0,
    );
}

async function empleadoEnRutaHoy(
  empresaId: number,
  empleadoId: number,
): Promise<boolean> {
  const hoy = hoyLocal();

  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id
       FROM marcajes_en_ruta
       WHERE empresa_id = ?
         AND id_empleado = ?
         AND fecha_inicio <= ?
         AND fecha_fin >= ?
       LIMIT 1`,
      [empresaId, empleadoId, hoy, hoy],
    );

    return rows.length > 0;
  } catch {
    return false;
  }
}

export type ResultadoGeocercaKiosko =
  | {
      ok: true;
      metros?: number;
      ubicacionId?: number;
      ubicacionNombre?: string;
    }
  | {
      ok: false;
      error: string;
      code: string;
    };

/**
 * Valida geocerca para kiosko usando TODAS las ubicaciones activas
 * autorizadas del grupo.
 *
 * Reglas:
 * - Si la geocerca está desactivada para la empresa del empleado → permite.
 * - Empleado "en ruta" hoy → permite.
 * - Si no existen ubicaciones activas → permite temporalmente por compatibilidad.
 * - Sin GPS del dispositivo → bloquea.
 * - Calcula distancia contra todas las ubicaciones activas.
 * - Si está dentro del radio de cualquiera → permite.
 * - Si está dentro de varias → usa la más cercana.
 * - Si está fuera de todas → bloquea e informa la ubicación más cercana.
 */
export async function validarGeocercaKiosko(
  empresaId: number,
  empleadoId: number,
  coords: { lat?: number | null; lng?: number | null } | null | undefined,
): Promise<ResultadoGeocercaKiosko> {
  /*
   * Durante la transición conservamos geocerca_activa como interruptor
   * general para la empresa a la que pertenece el empleado.
   */
  const geo = await obtenerGeocerca(empresaId);

  if (!geo.activa) {
    return { ok: true };
  }

  if (await empleadoEnRutaHoy(empresaId, empleadoId)) {
    return { ok: true };
  }

  const ubicaciones = await obtenerUbicacionesMarcajeActivas();

  /*
   * Compatibilidad temporal:
   * si aún no existen ubicaciones activas en la nueva tabla,
   * no bloqueamos todos los marcajes del grupo.
   *
   * Más adelante debe cambiarse a fail-closed cuando la migración
   * de todas las ubicaciones esté confirmada.
   */
  if (ubicaciones.length === 0) {
    return { ok: true };
  }

  const lat = coords?.lat != null ? Number(coords.lat) : NaN;
  const lng = coords?.lng != null ? Number(coords.lng) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      ok: false,
      code: "GPS_REQUERIDO",
      error:
        "Debes activar la ubicación (GPS) del teléfono o navegador para registrar el marcaje.",
    };
  }

  const distancias = ubicaciones.map((ubicacion) => {
    const metros = distanciaMetros(
      ubicacion.lat,
      ubicacion.lng,
      lat,
      lng,
    );

    return {
      ubicacion,
      metros,
    };
  });

  const dentro = distancias
    .filter(({ ubicacion, metros }) => metros <= ubicacion.radioM)
    .sort((a, b) => a.metros - b.metros)[0];

  if (dentro) {
    return {
      ok: true,
      ubicacionId: dentro.ubicacion.id,
      ubicacionNombre: dentro.ubicacion.nombre,
      metros: Math.round(dentro.metros),
    };
  }

  const masCercana = [...distancias].sort(
    (a, b) => a.metros - b.metros,
  )[0];

  return {
    ok: false,
    code: "FUERA_GEOCERCA",
    error:
      `Estás fuera de las ubicaciones autorizadas. La más cercana es ` +
      `"${masCercana.ubicacion.nombre}" (~${Math.round(
        masCercana.metros,
      )} m). Su radio permitido es ${masCercana.ubicacion.radioM} m.`,
  };
}