import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import type { EstadoCargaCombustible } from "@/lib/flota/combustible";

/**
 * ADMIN-LIMPIAR-COMBUSTIBLE-PREVIEW — SOLO LECTURA (SELECT). Nunca
 * modifica `flota_combustible_cargas` ni
 * `flota_combustible_conciliacion_filas`, nunca borra archivos, nunca
 * ejecuta DELETE/UPDATE. Existe para que un administrador pueda revisar
 * MANUALMENTE, antes de decidir nada, las cargas de combustible que hoy
 * bloquean `pruebas_reinicio_completo` — ver
 * docs/LIMPIEZA-TMS-OPERACIONES-REINICIO-3-BLOQUEO-COMBUSTIBLE-DISCOVERY.md.
 *
 * Aislamiento: TODO parte de los `flota_viajes` de la empresa indicada —
 * mismo patrón `planWhere` que ya usa `limpiarViajesConjuntos()` en
 * limpiar-operaciones.ts. Nunca consulta ni expone cargas de otra empresa.
 */

/** Sin alias de tabla — anteponer "c." (o el alias que corresponda) al usarlo con JOIN. */
const VIAJE_WHERE_EMPRESA = `viaje_id IN (
    SELECT v.id FROM flota_viajes v
    INNER JOIN tms_planes_viaje p ON p.id = v.plan_id
    WHERE p.empresa_id = ?
  )`;

/**
 * Nombre de clave de conteo por estado CONOCIDO hoy en el código
 * (EstadoCargaCombustible en src/lib/flota/combustible.ts). Cualquier
 * estado que exista en la BD pero no esté en este mapa NUNCA se descarta
 * — se reporta igual, bajo una clave derivada (`cargas_combustible_estado_<x>`),
 * para que un estado futuro no quede invisible en el preview.
 */
const CLAVE_POR_ESTADO: Record<string, string> = {
  PENDIENTE: "cargas_combustible_pendientes",
  APROBADO: "cargas_combustible_aprobadas",
  RECHAZADO: "cargas_combustible_rechazadas",
};

async function tablaExiste(conn: PoolConnection, tabla: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [tabla],
  );
  return rows.length > 0;
}

/**
 * Conteos para el preview de `pruebas_reinicio_completo`. Siempre
 * devuelve las 4 claves pedidas (en 0 si no hay datos o si la tabla aún
 * no existe en este entorno) más cualquier estado adicional que exista
 * realmente en la BD.
 */
export async function contarCargasCombustibleBloqueantes(
  conn: PoolConnection,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {
    cargas_combustible_vinculadas: 0,
    cargas_combustible_pendientes: 0,
    cargas_combustible_aprobadas: 0,
    cargas_combustible_rechazadas: 0,
    conciliaciones_combustible_vinculadas: 0,
  };
  if (!(await tablaExiste(conn, "flota_combustible_cargas"))) return out;

  const [porEstado] = await conn.query<RowDataPacket[]>(
    `SELECT estado, COUNT(*) AS n FROM flota_combustible_cargas WHERE ${VIAJE_WHERE_EMPRESA} GROUP BY estado`,
    [empresaId],
  );
  for (const fila of porEstado) {
    const estado = String(fila.estado ?? "").toUpperCase() || "DESCONOCIDO";
    const n = Number(fila.n ?? 0);
    out.cargas_combustible_vinculadas += n;
    const clave = CLAVE_POR_ESTADO[estado] ?? `cargas_combustible_estado_${estado.toLowerCase()}`;
    out[clave] = (out[clave] ?? 0) + n;
  }

  if (await tablaExiste(conn, "flota_combustible_conciliacion_filas")) {
    const [conc] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM flota_combustible_conciliacion_filas
       WHERE carga_combustible_id IN (SELECT id FROM flota_combustible_cargas WHERE ${VIAJE_WHERE_EMPRESA})`,
      [empresaId],
    );
    out.conciliaciones_combustible_vinculadas = Number(conc[0]?.n ?? 0);
  }
  return out;
}

export type CargaCombustibleBloqueante = {
  id: number;
  viajeId: number;
  /** fecha_consumo si existe (dato real de la carga); si no, la fecha de registro. */
  fecha: string | null;
  estado: EstadoCargaCombustible;
  monto: number;
  vehiculoId: number;
  vehiculoPlaca: string | null;
  empleadoId: number;
  pilotoNombre: string;
  /** Nunca se expone la ruta física ni el binario — solo si existe comprobante. */
  tieneComprobante: boolean;
  conciliada: boolean;
  conciliacionId: number | null;
  conciliacionArchivo: string | null;
  conciliacionFecha: string | null;
};

/**
 * Detalle SOLO LECTURA de las cargas que bloquean el reinicio de una
 * empresa, para revisión manual. Nunca modifica ninguna fila ni toca el
 * filesystem (no importa `fs`, `@/lib/uploads` ni
 * `@/lib/admin/limpiar-archivos`).
 */
export async function listarCargasCombustibleBloqueantes(
  empresaId: number,
): Promise<CargaCombustibleBloqueante[]> {
  const conn = await getPool().getConnection();
  try {
    if (!(await tablaExiste(conn, "flota_combustible_cargas"))) return [];

    const [filas] = await conn.query<RowDataPacket[]>(
      `SELECT
         c.id, c.viaje_id, c.fecha_consumo, c.creado_at, c.estado, c.monto,
         c.vehiculo_id, v.placa AS vehiculo_placa,
         c.empleado_id, c.piloto_nombre, c.ruta_relativa,
         (SELECT f.conciliacion_id FROM flota_combustible_conciliacion_filas f
            WHERE f.carga_combustible_id = c.id ORDER BY f.id DESC LIMIT 1) AS conciliacion_id
       FROM flota_combustible_cargas c
       LEFT JOIN flota_vehiculos v ON v.id = c.vehiculo_id
       WHERE c.${VIAJE_WHERE_EMPRESA}
       ORDER BY c.id`,
      [empresaId],
    );

    const conciliacionIds = [...new Set(
      filas.map((f) => (f.conciliacion_id != null ? Number(f.conciliacion_id) : null))
        .filter((v): v is number => v != null),
    )];
    const conciliaciones = new Map<number, { nombreOriginal: string; creadoAt: string }>();
    if (conciliacionIds.length) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, nombre_original, creado_at FROM flota_combustible_conciliaciones WHERE id IN (?)`,
        [conciliacionIds],
      );
      for (const r of rows) {
        conciliaciones.set(Number(r.id), {
          nombreOriginal: String(r.nombre_original),
          creadoAt: String(r.creado_at),
        });
      }
    }

    return filas.map((f) => {
      const conciliacionId = f.conciliacion_id != null ? Number(f.conciliacion_id) : null;
      const conciliacion = conciliacionId != null ? conciliaciones.get(conciliacionId) : undefined;
      return {
        id: Number(f.id),
        viajeId: Number(f.viaje_id),
        fecha: f.fecha_consumo ? String(f.fecha_consumo) : f.creado_at ? String(f.creado_at) : null,
        estado: String(f.estado) as EstadoCargaCombustible,
        monto: Number(f.monto),
        vehiculoId: Number(f.vehiculo_id),
        vehiculoPlaca: f.vehiculo_placa != null ? String(f.vehiculo_placa) : null,
        empleadoId: Number(f.empleado_id),
        pilotoNombre: String(f.piloto_nombre),
        tieneComprobante: f.ruta_relativa != null && String(f.ruta_relativa).trim() !== "",
        conciliada: conciliacionId != null,
        conciliacionId,
        conciliacionArchivo: conciliacion?.nombreOriginal ?? null,
        conciliacionFecha: conciliacion?.creadoAt ?? null,
      };
    });
  } finally {
    conn.release();
  }
}
