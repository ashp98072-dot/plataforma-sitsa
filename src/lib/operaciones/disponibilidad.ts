import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * Disponibilidad de flota para Operaciones / TMS.
 * Módulo aditivo: no modifica Flota; TMS podrá consumir estos tipos después.
 */

export type EstadoDisponibilidad =
  | "disponible"
  | "en_taller"
  | "en_ruta"
  | "inactivo";

export type ViajeAbiertoResumen = {
  id: number;
  pilotoNombre: string;
  horaSalida: string | null;
  destino: string | null;
};

export type VehiculoDisponibilidad = {
  id: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  descripcion: string | null;
  activo: boolean;
  enTaller: boolean;
  compartido: boolean;
  /** True si la empresa actual es dueña de la unidad. */
  esPropio: boolean;
  empresaDuenaNombre: string | null;
  empresaDuenaCodigo: string | null;
  kmActual: number;
  estadoDisponibilidad: EstadoDisponibilidad;
  /** Listo para plan / ruta (activo, no taller, no viaje abierto). */
  puedeEnviar: boolean;
  viajeAbierto: ViajeAbiertoResumen | null;
  motivoNoDisponible: string | null;
};

export type ResumenDisponibilidad = {
  total: number;
  disponibles: number;
  enTaller: number;
  enRuta: number;
  inactivos: number;
  propios: number;
  compartidos: number;
};

export type DisponibilidadPayload = {
  vehiculos: VehiculoDisponibilidad[];
  resumen: ResumenDisponibilidad;
  empresaId: number;
};

function clasificar(opts: {
  activo: boolean;
  enTaller: boolean;
  viaje: ViajeAbiertoResumen | null;
}): {
  estado: EstadoDisponibilidad;
  puedeEnviar: boolean;
  motivo: string | null;
} {
  if (!opts.activo) {
    return {
      estado: "inactivo",
      puedeEnviar: false,
      motivo: "Unidad inactiva",
    };
  }
  if (opts.enTaller) {
    return {
      estado: "en_taller",
      puedeEnviar: false,
      motivo: "En taller / servicio",
    };
  }
  if (opts.viaje) {
    return {
      estado: "en_ruta",
      puedeEnviar: false,
      motivo: `En ruta con ${opts.viaje.pilotoNombre}`,
    };
  }
  return { estado: "disponible", puedeEnviar: true, motivo: null };
}

/** Placas listas para planes TMS (extensible). */
export function placasDisponiblesParaPlan(
  list: VehiculoDisponibilidad[],
): string[] {
  return list.filter((v) => v.puedeEnviar).map((v) => v.placa);
}

/**
 * Lectura liviana: unidades accesibles + viajes abiertos por vehiculo_id
 * (incluye compartidas entre empresas del grupo).
 */
export async function listarDisponibilidadVehiculos(
  empresaId: number,
): Promise<DisponibilidadPayload> {
  let rows: RowDataPacket[] = [];
  try {
    rows = await query<RowDataPacket[]>(
      `SELECT v.id, v.placa, v.marca, v.modelo, v.descripcion,
              v.activo, v.en_taller, v.estado, v.km_actual, v.empresa_id,
              e.codigo AS empresa_duena_codigo, e.nombre AS empresa_duena_nombre,
              CASE WHEN v.empresa_id = ? THEN 0 ELSE 1 END AS compartido
       FROM flota_vehiculos v
       LEFT JOIN empresas e ON e.id = v.empresa_id
       WHERE v.empresa_id = ?
          OR EXISTS (
            SELECT 1 FROM flota_vehiculo_acceso a
            WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
          )
       ORDER BY v.activo DESC, v.en_taller ASC, v.placa`,
      [empresaId, empresaId, empresaId],
    );
  } catch {
    rows = await query<RowDataPacket[]>(
      `SELECT id, placa, marca, modelo, descripcion, activo, en_taller, estado,
              km_actual, empresa_id, 0 AS compartido,
              NULL AS empresa_duena_codigo, NULL AS empresa_duena_nombre
       FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
      [empresaId],
    );
  }

  const ids = rows.map((r) => Number(r.id)).filter((id) => id > 0);
  const viajesMap = new Map<number, ViajeAbiertoResumen>();
  if (ids.length) {
    try {
      const viajes = await query<RowDataPacket[]>(
        `SELECT id, vehiculo_id, piloto_nombre, hora_salida, destino
         FROM flota_viajes
         WHERE estado = 'abierto'
           AND vehiculo_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
      for (const j of viajes) {
        const vid = Number(j.vehiculo_id);
        if (!viajesMap.has(vid)) {
          viajesMap.set(vid, {
            id: Number(j.id),
            pilotoNombre: String(j.piloto_nombre ?? "—"),
            horaSalida: j.hora_salida != null ? String(j.hora_salida) : null,
            destino: j.destino != null ? String(j.destino) : null,
          });
        }
      }
    } catch {
      /* tabla ausente */
    }
  }

  const vehiculos: VehiculoDisponibilidad[] = rows.map((r) => {
    const activo = Number(r.activo ?? 1) !== 0;
    const enTaller =
      Number(r.en_taller ?? 0) === 1 ||
      String(r.estado ?? "")
        .toLowerCase()
        .includes("taller");
    const viaje = viajesMap.get(Number(r.id)) ?? null;
    const cls = clasificar({ activo, enTaller, viaje });
    const compartido = Number(r.compartido ?? 0) === 1;
    return {
      id: Number(r.id),
      placa: String(r.placa ?? ""),
      marca: r.marca != null ? String(r.marca) : null,
      modelo: r.modelo != null ? String(r.modelo) : null,
      descripcion: r.descripcion != null ? String(r.descripcion) : null,
      activo,
      enTaller,
      compartido,
      esPropio: !compartido,
      empresaDuenaNombre:
        r.empresa_duena_nombre != null
          ? String(r.empresa_duena_nombre)
          : null,
      empresaDuenaCodigo:
        r.empresa_duena_codigo != null
          ? String(r.empresa_duena_codigo)
          : null,
      kmActual: Number(r.km_actual ?? 0),
      estadoDisponibilidad: cls.estado,
      puedeEnviar: cls.puedeEnviar,
      viajeAbierto: viaje,
      motivoNoDisponible: cls.motivo,
    };
  });

  const resumen: ResumenDisponibilidad = {
    total: vehiculos.length,
    disponibles: vehiculos.filter((v) => v.estadoDisponibilidad === "disponible")
      .length,
    enTaller: vehiculos.filter((v) => v.estadoDisponibilidad === "en_taller")
      .length,
    enRuta: vehiculos.filter((v) => v.estadoDisponibilidad === "en_ruta").length,
    inactivos: vehiculos.filter((v) => v.estadoDisponibilidad === "inactivo")
      .length,
    propios: vehiculos.filter((v) => v.esPropio).length,
    compartidos: vehiculos.filter((v) => v.compartido).length,
  };

  return { vehiculos, resumen, empresaId };
}
