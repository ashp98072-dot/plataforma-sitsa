import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { toIsoDate } from "@/lib/rrhh/dates";

import type { DiferenciaCampo } from "./combustible-conciliacion";

/**
 * FLOTA-COMBUSTIBLE-4 — capa de LECTURA/HISTORIAL de conciliaciones ya
 * persistidas (flota_combustible_conciliaciones +
 * flota_combustible_conciliacion_filas).
 *
 * Deliberadamente separada de:
 * - combustible-conciliacion.ts (matching puro, conciliarPorVale());
 * - combustible-conciliacion-persistencia.ts (escritura transaccional).
 *
 * Este módulo NUNCA vuelve a ejecutar conciliarPorVale() ni escribe en
 * ninguna tabla — el snapshot ya persistido es la verdad histórica, solo
 * se lee. Es de solo consulta: no aprueba/rechaza cargas, no modifica
 * flota_combustible_cargas, no marca conciliaciones como pagadas y no
 * elimina nada.
 */

export type EstadoFilaConciliacion =
  | "COINCIDE"
  | "DIFERENCIA"
  | "SOLO_GASOLINERA"
  | "SOLO_SISTEMA"
  | "AMBIGUO"
  | "DESCARTADA";

export type EstadoSistemaHistorico =
  | "PENDIENTE"
  | "APROBADO"
  | "RECHAZADO"
  | null;

export type ResumenConciliacionCombustible = {
  id: number;
  nombreOriginal: string;
  hoja: string;
  subidoPor: string;
  creadoEn: string;
  /** Derivado de fecha_gasolinera/fecha_sistema de las filas — NUNCA de creado_at. */
  periodoDesde: string | null;
  periodoHasta: string | null;
  totalFilas: number;
  descartadas: number;
  coincide: number;
  diferencia: number;
  soloGasolinera: number;
  soloSistema: number;
  ambiguo: number;
};

export type SnapshotConciliacion = {
  numeroVale: string | null;
  fechaConsumo: string | null;
  placa: string | null;
  pilotoNombre: string | null;
  producto: string | null;
  galones: number | null;
  precioGalon: number | null;
  monto: number | null;
};

export type FilaConciliacionDetalle = {
  id: number;
  filaExcel: number | null;
  estado: EstadoFilaConciliacion;
  motivo: string | null;
  cargaCombustibleId: number | null;
  /** Estado operativo (PENDIENTE/APROBADO/RECHAZADO) de la carga del sistema AL MOMENTO de conciliar. Metadata histórica pura. */
  estadoSistema: EstadoSistemaHistorico;
  /** `null` cuando la fila no tiene snapshot de gasolinera (SOLO_SISTEMA, DESCARTADA). */
  gasolinera: SnapshotConciliacion | null;
  /** `null` cuando la fila no tiene snapshot del sistema (SOLO_GASOLINERA, DESCARTADA). */
  sistema: SnapshotConciliacion | null;
  diferencias: DiferenciaCampo[];
};

export type ConciliacionCombustibleDetalle = {
  id: number;
  nombreOriginal: string;
  hoja: string;
  subidoPor: string;
  creadoEn: string;
  periodoDesde: string | null;
  periodoHasta: string | null;
  filas: FilaConciliacionDetalle[];
};

export type ArchivoConciliacionCombustible = {
  rutaRelativa: string;
  nombreOriginal: string;
  mime: string | null;
};

/**
 * Límite de seguridad del historial: 100 conciliaciones más recientes.
 * Esta pantalla es de consulta/auditoría, no un reporte exhaustivo — un
 * valor explícito y razonable evita escanear un histórico ilimitado en
 * una sola respuesta. Si en el futuro se necesita paginación real, este
 * es el punto a ajustar.
 */
const LIMITE_HISTORIAL = 100;

const ESTADOS_FILA = new Set<string>([
  "COINCIDE",
  "DIFERENCIA",
  "SOLO_GASOLINERA",
  "SOLO_SISTEMA",
  "AMBIGUO",
  "DESCARTADA",
]);

const ESTADOS_SISTEMA = new Set<string>([
  "PENDIENTE",
  "APROBADO",
  "RECHAZADO",
]);

function normalizarEstadoFila(valor: unknown): EstadoFilaConciliacion {
  const s = String(valor);
  return (ESTADOS_FILA.has(s) ? s : "DESCARTADA") as EstadoFilaConciliacion;
}

function normalizarEstadoSistema(valor: unknown): EstadoSistemaHistorico {
  if (valor == null) return null;
  const s = String(valor);
  return (
    ESTADOS_SISTEMA.has(s) ? (s as EstadoSistemaHistorico) : null
  );
}

/**
 * "diferencias" se persiste como JSON TEXT (ver combustible-conciliacion-
 * persistencia.ts, jsonDiferencias()). Se parsea de forma defensiva: NULL
 * o cualquier dato histórico que no pueda interpretarse como el arreglo
 * esperado nunca rompe el endpoint — simplemente devuelve [].
 */
function parseDiferenciasSeguro(json: string | null): DiferenciaCampo[] {
  if (!json) return [];

  try {
    const parsed: unknown = JSON.parse(json);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is DiferenciaCampo => {
      if (!item || typeof item !== "object") return false;
      const campo = (item as Record<string, unknown>).campo;
      const sistema = (item as Record<string, unknown>).sistema;
      const gasolinera = (item as Record<string, unknown>).gasolinera;
      return (
        typeof campo === "string" &&
        typeof sistema === "string" &&
        typeof gasolinera === "string"
      );
    });
  } catch {
    return [];
  }
}

function fechaMinima(
  a: string | null,
  b: string | null,
): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a < b ? a : b;
}

function fechaMaxima(
  a: string | null,
  b: string | null,
): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

function validarIds(empresaId: number, conciliacionId?: number): void {
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new Error("empresaId inválido.");
  }

  if (
    conciliacionId !== undefined &&
    (!Number.isInteger(conciliacionId) || conciliacionId <= 0)
  ) {
    throw new Error("conciliacionId inválido.");
  }
}

/**
 * Historial de conciliaciones de la empresa, más reciente primero.
 *
 * Los conteos por estado y el total de filas se calculan con UNA sola
 * agregación SQL (GROUP BY conciliacion_id + empresa_id) — nunca con una
 * consulta adicional por conciliación (N+1).
 *
 * El período (periodoDesde/periodoHasta) se deriva de las fechas
 * snapshot de las filas (fecha_gasolinera / fecha_sistema), nunca de
 * creado_at.
 */
export async function listarConciliacionesCombustible(
  empresaId: number,
): Promise<ResumenConciliacionCombustible[]> {
  validarIds(empresaId);

  const rows = await query<RowDataPacket[]>(
    `SELECT
       c.id,
       c.nombre_original,
       c.hoja,
       c.subido_por,
       c.creado_at,
       MIN(f.fecha_gasolinera) AS min_gas,
       MAX(f.fecha_gasolinera) AS max_gas,
       MIN(f.fecha_sistema) AS min_sis,
       MAX(f.fecha_sistema) AS max_sis,
       COUNT(f.id) AS total_filas,
       SUM(f.estado = 'DESCARTADA') AS descartadas,
       SUM(f.estado = 'COINCIDE') AS coincide,
       SUM(f.estado = 'DIFERENCIA') AS diferencia,
       SUM(f.estado = 'SOLO_GASOLINERA') AS solo_gasolinera,
       SUM(f.estado = 'SOLO_SISTEMA') AS solo_sistema,
       SUM(f.estado = 'AMBIGUO') AS ambiguo
     FROM flota_combustible_conciliaciones c
     LEFT JOIN flota_combustible_conciliacion_filas f
       ON f.conciliacion_id = c.id AND f.empresa_id = c.empresa_id
     WHERE c.empresa_id = ?
     GROUP BY c.id, c.nombre_original, c.hoja, c.subido_por, c.creado_at
     ORDER BY c.creado_at DESC, c.id DESC
     LIMIT ${LIMITE_HISTORIAL}`,
    [empresaId],
  );

  return rows.map((r) => {
    const minGas = toIsoDate(r.min_gas as string | Date | null);
    const maxGas = toIsoDate(r.max_gas as string | Date | null);
    const minSis = toIsoDate(r.min_sis as string | Date | null);
    const maxSis = toIsoDate(r.max_sis as string | Date | null);

    return {
      id: Number(r.id),
      nombreOriginal: String(r.nombre_original),
      hoja: String(r.hoja),
      subidoPor: String(r.subido_por),
      creadoEn: String(r.creado_at),
      periodoDesde: fechaMinima(minGas, minSis),
      periodoHasta: fechaMaxima(maxGas, maxSis),
      totalFilas: Number(r.total_filas),
      descartadas: Number(r.descartadas),
      coincide: Number(r.coincide),
      diferencia: Number(r.diferencia),
      soloGasolinera: Number(r.solo_gasolinera),
      soloSistema: Number(r.solo_sistema),
      ambiguo: Number(r.ambiguo),
    };
  });
}

function mapSnapshotGasolinera(
  r: RowDataPacket,
): SnapshotConciliacion | null {
  if (r.vale_gasolinera == null) return null;

  return {
    numeroVale: String(r.vale_gasolinera),
    fechaConsumo: toIsoDate(
      r.fecha_gasolinera as string | Date | null,
    ),
    placa:
      r.placa_gasolinera != null ? String(r.placa_gasolinera) : null,
    pilotoNombre:
      r.piloto_gasolinera != null
        ? String(r.piloto_gasolinera)
        : null,
    producto:
      r.producto_gasolinera != null
        ? String(r.producto_gasolinera)
        : null,
    galones:
      r.galones_gasolinera != null
        ? Number(r.galones_gasolinera)
        : null,
    precioGalon:
      r.precio_gasolinera != null
        ? Number(r.precio_gasolinera)
        : null,
    monto:
      r.monto_gasolinera != null ? Number(r.monto_gasolinera) : null,
  };
}

function mapSnapshotSistema(
  r: RowDataPacket,
): SnapshotConciliacion | null {
  if (r.carga_combustible_id == null) return null;

  return {
    numeroVale: r.vale_sistema != null ? String(r.vale_sistema) : null,
    fechaConsumo: toIsoDate(
      r.fecha_sistema as string | Date | null,
    ),
    placa: r.placa_sistema != null ? String(r.placa_sistema) : null,
    pilotoNombre:
      r.piloto_sistema != null ? String(r.piloto_sistema) : null,
    producto:
      r.producto_sistema != null ? String(r.producto_sistema) : null,
    galones:
      r.galones_sistema != null ? Number(r.galones_sistema) : null,
    precioGalon:
      r.precio_sistema != null ? Number(r.precio_sistema) : null,
    monto: r.monto_sistema != null ? Number(r.monto_sistema) : null,
  };
}

function mapFilaDetalle(r: RowDataPacket): FilaConciliacionDetalle {
  return {
    id: Number(r.id),
    filaExcel: r.fila_excel != null ? Number(r.fila_excel) : null,
    estado: normalizarEstadoFila(r.estado),
    motivo: r.motivo != null ? String(r.motivo) : null,
    cargaCombustibleId:
      r.carga_combustible_id != null
        ? Number(r.carga_combustible_id)
        : null,
    estadoSistema: normalizarEstadoSistema(r.estado_sistema),
    gasolinera: mapSnapshotGasolinera(r),
    sistema: mapSnapshotSistema(r),
    diferencias: parseDiferenciasSeguro(
      r.diferencias != null ? String(r.diferencias) : null,
    ),
  };
}

/**
 * Detalle vale por vale de una conciliación ya persistida.
 *
 * NUNCA vuelve a ejecutar conciliarPorVale() — lee exclusivamente el
 * snapshot guardado en flota_combustible_conciliacion_filas, que es la
 * verdad histórica.
 *
 * Devuelve `null` si la conciliación no existe O no pertenece a
 * `empresaId` (mismo resultado en ambos casos — el caller decide 404).
 */
export async function obtenerConciliacionCombustible(
  empresaId: number,
  conciliacionId: number,
): Promise<ConciliacionCombustibleDetalle | null> {
  validarIds(empresaId, conciliacionId);

  const cabeceraRows = await query<RowDataPacket[]>(
    `SELECT id, nombre_original, hoja, subido_por, creado_at
     FROM flota_combustible_conciliaciones
     WHERE id = ? AND empresa_id = ?
     LIMIT 1`,
    [conciliacionId, empresaId],
  );

  const cabecera = cabeceraRows[0];

  if (!cabecera) return null;

  const filasRows = await query<RowDataPacket[]>(
    `SELECT
       id, fila_excel, estado, motivo, carga_combustible_id, estado_sistema,
       vale_gasolinera, fecha_gasolinera, placa_gasolinera, piloto_gasolinera,
       producto_gasolinera, galones_gasolinera, precio_gasolinera, monto_gasolinera,
       vale_sistema, fecha_sistema, placa_sistema, piloto_sistema,
       producto_sistema, galones_sistema, precio_sistema, monto_sistema,
       diferencias
     FROM flota_combustible_conciliacion_filas
     WHERE conciliacion_id = ? AND empresa_id = ?
     ORDER BY id ASC`,
    [conciliacionId, empresaId],
  );

  const filas = filasRows.map(mapFilaDetalle);

  let periodoDesde: string | null = null;
  let periodoHasta: string | null = null;

  for (const fila of filas) {
    periodoDesde = fechaMinima(
      periodoDesde,
      fila.gasolinera?.fechaConsumo ?? null,
    );
    periodoDesde = fechaMinima(
      periodoDesde,
      fila.sistema?.fechaConsumo ?? null,
    );
    periodoHasta = fechaMaxima(
      periodoHasta,
      fila.gasolinera?.fechaConsumo ?? null,
    );
    periodoHasta = fechaMaxima(
      periodoHasta,
      fila.sistema?.fechaConsumo ?? null,
    );
  }

  return {
    id: Number(cabecera.id),
    nombreOriginal: String(cabecera.nombre_original),
    hoja: String(cabecera.hoja),
    subidoPor: String(cabecera.subido_por),
    creadoEn: String(cabecera.creado_at),
    periodoDesde,
    periodoHasta,
    filas,
  };
}

/**
 * Solo lo necesario para servir el Excel original (ruta/mime), acotado a
 * empresa + id — la ruta relativa NUNCA sale de aquí hacia el cliente,
 * solo se usa server-side para resolver el archivo físico (mismo patrón
 * que obtenerArchivoCargaCombustiblePorEmpresa() en combustible.ts).
 */
export async function obtenerArchivoConciliacionCombustible(
  empresaId: number,
  conciliacionId: number,
): Promise<ArchivoConciliacionCombustible | null> {
  validarIds(empresaId, conciliacionId);

  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime
     FROM flota_combustible_conciliaciones
     WHERE id = ? AND empresa_id = ?
     LIMIT 1`,
    [conciliacionId, empresaId],
  );

  const row = rows[0];

  if (!row) return null;

  return {
    rutaRelativa: String(row.ruta_relativa),
    nombreOriginal: String(row.nombre_original),
    mime: row.mime != null ? String(row.mime) : null,
  };
}
