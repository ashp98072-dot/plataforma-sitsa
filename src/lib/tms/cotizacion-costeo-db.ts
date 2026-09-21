import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  COTIZACION_COSTEO_MOTOR_VERSION,
  type ComponenteCosteo,
  type DepreciacionCosteo,
  type InputCosteoServicio,
  type ParametrosEconomicosCosteo,
  type PerfilCosteoUnidad,
  type ResultadoCosteoServicio,
} from "./cotizacion-costeo";

/**
 * COTIZACIONES-COSTEO (Fase 3) — acceso a datos del costeo. Las tablas ya
 * existen (ver sql/migrate-2026-09-cotizaciones-costeo.sql); este módulo
 * solo las lee/escribe. El motor (cotizacion-costeo.ts) sigue siendo puro:
 * nada de aquí entra en él.
 *
 * Aislamiento multiempresa: TODA consulta filtra por empresa_id; nunca se
 * confía en un id enviado por el cliente sin revalidarlo contra la empresa.
 * Los snapshots son INMUTABLES: solo INSERT, jamás UPDATE/DELETE.
 */

export class ErrorCosteoConfig extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorCosteoConfig";
  }
}

export const MENSAJE_COSTEO_YA_REGISTRADO = "Esta cotización ya tiene un costeo registrado.";
export class ErrorCosteoYaRegistrado extends Error {
  constructor() {
    super(MENSAJE_COSTEO_YA_REGISTRADO);
    this.name = "ErrorCosteoYaRegistrado";
  }
}

const num = (v: unknown): number => Number(v);
const numONull = (v: unknown): number | null => (v == null ? null : Number(v));

// ---------------------------------------------------------------------------
// Perfiles
// ---------------------------------------------------------------------------

export type PerfilCosteoConId = PerfilCosteoUnidad & { id: number };

/** Los tres campos NULL => sin equipo (null); si hay alguno, se exigen los tres (el motor valida que sean positivos). */
function mapDepreciacion(valorBase: unknown, anios: unknown, dias: unknown): DepreciacionCosteo | null {
  if (valorBase == null && anios == null && dias == null) return null;
  return { valorBase: num(valorBase), anios: num(anios), diasOperacionMes: num(dias) };
}

function mapPerfil(r: RowDataPacket): PerfilCosteoConId {
  return {
    id: num(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    costoAdquisicion: numONull(r.costo_adquisicion),
    diasOperacionMes: num(r.dias_operacion_mes),
    gpsMensual: num(r.gps_mensual),
    seguroVehiculoMensual: num(r.seguro_vehiculo_mensual),
    costoAceiteServicio: num(r.costo_aceite_servicio),
    vidaUtilAceiteKm: num(r.vida_util_aceite_km),
    costoJuegoLlantas: num(r.costo_juego_llantas),
    vidaUtilLlantasKm: num(r.vida_util_llantas_km),
    rendimientoKmGalon: num(r.rendimiento_km_galon),
    depreciacion: mapDepreciacion(r.deprec_valor_base, r.deprec_anios, r.deprec_dias_operacion_mes),
    costoRefrigeracion: mapDepreciacion(r.refrig_valor_base, r.refrig_anios, r.refrig_dias_operacion_mes),
  };
}

const SELECT_PERFIL = `
  SELECT id, codigo, nombre, costo_adquisicion, dias_operacion_mes, gps_mensual, seguro_vehiculo_mensual,
         costo_aceite_servicio, vida_util_aceite_km, costo_juego_llantas, vida_util_llantas_km, rendimiento_km_galon,
         deprec_valor_base, deprec_anios, deprec_dias_operacion_mes,
         refrig_valor_base, refrig_anios, refrig_dias_operacion_mes
  FROM tms_cotizacion_costeo_perfiles
`;

/** Solo perfiles activos de la empresa, por nombre. */
export async function listarPerfilesCosteo(empresaId: number): Promise<PerfilCosteoConId[]> {
  const rows = await query<RowDataPacket[]>(`${SELECT_PERFIL} WHERE empresa_id = ? AND activo = 1 ORDER BY nombre ASC`, [empresaId]);
  return rows.map(mapPerfil);
}

/** Tenant-safe: WHERE empresa_id = ? AND id = ?. `null` si no existe en esta empresa (o está inactivo). */
export async function obtenerPerfilCosteo(empresaId: number, perfilId: number): Promise<PerfilCosteoConId | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_PERFIL} WHERE empresa_id = ? AND id = ? AND activo = 1 LIMIT 1`, [empresaId, perfilId]);
  return rows[0] ? mapPerfil(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Parámetros vigentes
// ---------------------------------------------------------------------------

export const MENSAJE_SIN_PARAMETROS = "No hay parámetros de costeo vigentes para la fecha indicada.";
export type ParametrosCosteoVigentes = { vigenteDesde: string; parametros: ParametrosEconomicosCosteo };

/**
 * La fila con vigente_desde <= fecha, la más reciente (DESC, LIMIT 1).
 * Una fila con fecha FUTURA nunca aplica aunque sea la más nueva.
 */
export async function obtenerParametrosCosteoVigentes(empresaId: number, fecha: string): Promise<ParametrosCosteoVigentes> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorCosteoConfig("Fecha de emisión no válida para obtener los parámetros de costeo.");
  const rows = await query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(vigente_desde, '%Y-%m-%d') AS vigente_desde, precio_combustible_galon, iva_tasa, costo_piloto_dia,
            costo_auxiliar_dia, viatico_piloto_dia, viatico_auxiliar_dia, viatico_guia_dia, hotel_dia, margen_objetivo
     FROM tms_cotizacion_costeo_parametros
     WHERE empresa_id = ? AND vigente_desde <= ?
     ORDER BY vigente_desde DESC
     LIMIT 1`,
    [empresaId, fecha],
  );
  const r = rows[0];
  if (!r) throw new ErrorCosteoConfig(MENSAJE_SIN_PARAMETROS);
  const parametros: ParametrosEconomicosCosteo = {
    precioCombustibleGalon: num(r.precio_combustible_galon),
    ivaTasa: num(r.iva_tasa),
    costoPilotoDia: num(r.costo_piloto_dia),
    costoAuxiliarDia: num(r.costo_auxiliar_dia),
    viaticoPilotoDia: num(r.viatico_piloto_dia),
    viaticoAuxiliarDia: num(r.viatico_auxiliar_dia),
    viaticoGuiaDia: num(r.viatico_guia_dia),
  };
  if (r.hotel_dia != null) parametros.hotelDia = num(r.hotel_dia);
  if (r.margen_objetivo != null) parametros.margenObjetivo = num(r.margen_objetivo);
  return { vigenteDesde: String(r.vigente_desde), parametros };
}

// ---------------------------------------------------------------------------
// Snapshot (INMUTABLE)
// ---------------------------------------------------------------------------

/** Todo lo que consumió el motor + su resultado, ya resuelto en servidor. */
export type CosteoPreparado = {
  perfil: PerfilCosteoConId;
  input: InputCosteoServicio;
  resultado: ResultadoCosteoServicio;
};

/** input_snapshot: lo usado por el motor SIN repetir perfil/parámetros (que ya van en sus propias columnas). */
export type InputSnapshotCosteo = Omit<InputCosteoServicio, "perfil" | "parametros">;

export function inputParaSnapshot(input: InputCosteoServicio): InputSnapshotCosteo {
  const { perfil: _perfil, parametros: _parametros, ...resto } = input;
  void _perfil; void _parametros;
  return resto;
}

const TOLERANCIA_SUMA_COMPONENTES = 1e-4;

export function sumaComponentesCoincide(resultado: ResultadoCosteoServicio): boolean {
  const suma = resultado.componentes.reduce((s, c) => s + c.monto, 0);
  return Math.abs(suma - resultado.costoOperativo) <= TOLERANCIA_SUMA_COMPONENTES;
}

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}

/**
 * Inserta el snapshot + sus componentes DENTRO de la transacción del
 * llamador (crearCotizacion/actualizarCotizacion): si algo falla, el
 * llamador revierte también la cotización. Cardinalidad 1:1 e inmutable: si
 * ya existe un snapshot NO se reemplaza (sin UPDATE ni DELETE+INSERT).
 */
export async function guardarSnapshotCosteoTx(
  conn: PoolConnection,
  p: { empresaId: number; cotizacionId: number; cotizacionCodigo: string; usuario: string | null; costeo: CosteoPreparado },
): Promise<number> {
  const { perfil, input, resultado } = p.costeo;
  if (!sumaComponentesCoincide(resultado)) {
    throw new Error("Los componentes del costeo no coinciden con el costo operativo.");
  }
  const existente = await queryConn<RowDataPacket[]>(
    conn,
    "SELECT id FROM tms_cotizacion_costeos WHERE empresa_id = ? AND cotizacion_id = ? LIMIT 1 FOR UPDATE",
    [p.empresaId, p.cotizacionId],
  );
  if (existente[0]) throw new ErrorCosteoYaRegistrado();

  const { id: _perfilId, ...perfilSnapshot } = perfil;
  void _perfilId;
  let costeoId: number;
  try {
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO tms_cotizacion_costeos
        (empresa_id, cotizacion_id, perfil_id, perfil_codigo, perfil_nombre, perfil_snapshot, parametros_snapshot, input_snapshot,
         motor_version, costo_operativo, iva, costo_con_iva, margen_objetivo, precio_sugerido, precio_venta, utilidad_estimada,
         margen_real, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.empresaId, p.cotizacionId, perfil.id, perfil.codigo, perfil.nombre,
        JSON.stringify(perfilSnapshot), JSON.stringify(input.parametros), JSON.stringify(inputParaSnapshot(input)),
        COTIZACION_COSTEO_MOTOR_VERSION,
        resultado.costoOperativo, resultado.iva, resultado.costoConIva, resultado.margenObjetivoAplicado, resultado.precioSugerido,
        resultado.precioVenta, resultado.utilidadEstimada, resultado.margenReal, p.usuario,
      ],
    );
    costeoId = Number(res.insertId);
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new ErrorCosteoYaRegistrado();
    throw error;
  }

  // Todos los componentes devueltos por el motor, en orden estable 1..N (no se recalculan aquí).
  const componentes = resultado.componentes;
  if (componentes.length) {
    await conn.execute<ResultSetHeader>(
      `INSERT INTO tms_cotizacion_costeo_componentes (empresa_id, costeo_id, orden, clave, concepto, monto)
       VALUES ${componentes.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`,
      componentes.flatMap((c, i) => [p.empresaId, costeoId, i + 1, c.clave, c.concepto, c.monto]),
    );
  }

  // Sin montos ni parámetros en el texto: la auditoría es ampliamente visible.
  await registrarAuditoriaTx(conn, {
    empresaId: p.empresaId,
    usuario: p.usuario,
    accion: "crear_costeo",
    modulo: "tms_cotizaciones",
    detalle: `Costeo interno registrado para cotización ${p.cotizacionCodigo} con perfil ${perfil.codigo}.`,
  });
  return costeoId;
}

export type SnapshotCosteo = {
  id: number;
  cotizacionId: number;
  perfilId: number | null;
  perfilCodigo: string;
  perfilNombre: string;
  perfil: PerfilCosteoUnidad;
  parametros: ParametrosEconomicosCosteo;
  input: InputSnapshotCosteo;
  motorVersion: string;
  costoOperativo: number;
  iva: number;
  costoConIva: number;
  margenObjetivo: number;
  precioSugerido: number;
  precioVenta: number | null;
  utilidadEstimada: number | null;
  margenReal: number | null;
  creadoPor: string | null;
  creadoEn: string | null;
  componentes: ComponenteCosteo[];
};

function json<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

/** Tenant-safe: filtra por empresa_id en ambas tablas. `null` si la cotización no tiene costeo en esta empresa. */
export async function obtenerSnapshotCosteo(empresaId: number, cotizacionId: number): Promise<SnapshotCosteo | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, cotizacion_id, perfil_id, perfil_codigo, perfil_nombre, perfil_snapshot, parametros_snapshot, input_snapshot,
            motor_version, costo_operativo, iva, costo_con_iva, margen_objetivo, precio_sugerido, precio_venta,
            utilidad_estimada, margen_real, creado_por, creado_en
     FROM tms_cotizacion_costeos WHERE empresa_id = ? AND cotizacion_id = ? LIMIT 1`,
    [empresaId, cotizacionId],
  );
  const r = rows[0];
  if (!r) return null;
  const comps = await query<RowDataPacket[]>(
    "SELECT clave, concepto, monto FROM tms_cotizacion_costeo_componentes WHERE empresa_id = ? AND costeo_id = ? ORDER BY orden ASC",
    [empresaId, r.id],
  );
  return {
    id: num(r.id),
    cotizacionId: num(r.cotizacion_id),
    perfilId: numONull(r.perfil_id),
    perfilCodigo: String(r.perfil_codigo),
    perfilNombre: String(r.perfil_nombre),
    perfil: json<PerfilCosteoUnidad>(r.perfil_snapshot),
    parametros: json<ParametrosEconomicosCosteo>(r.parametros_snapshot),
    input: json<InputSnapshotCosteo>(r.input_snapshot),
    motorVersion: String(r.motor_version),
    costoOperativo: num(r.costo_operativo),
    iva: num(r.iva),
    costoConIva: num(r.costo_con_iva),
    margenObjetivo: num(r.margen_objetivo),
    precioSugerido: num(r.precio_sugerido),
    precioVenta: numONull(r.precio_venta),
    utilidadEstimada: numONull(r.utilidad_estimada),
    margenReal: numONull(r.margen_real),
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: r.creado_en != null ? String(r.creado_en) : null,
    componentes: comps.map((c) => ({ clave: String(c.clave), concepto: String(c.concepto), monto: num(c.monto) })),
  };
}
