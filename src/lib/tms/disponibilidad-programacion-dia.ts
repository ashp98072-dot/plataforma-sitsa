import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, type SqlParams } from "@/lib/db";
import type { TipoRecurso } from "./disponibilidad-traslapes";

/** Una asignación consume el recurso durante toda fecha_plan, incluso después del cierre. */
/**
 * LEGADO (A2.2): la política DIARIA ("un recurso no puede estar en dos planes el mismo día") fue sustituida por la
 * política por INTERVALOS (disponibilidad-programacion-intervalos.ts) en POST, PATCH, importación, Copiar/lote y
 * buscadores. `primerConflictoProgramacionDia` y `listarDisponibilidadProgramacionDia` ya NO tienen llamadores
 * productivos y se conservan solo por compatibilidad de pruebas; siguen en uso las constantes y tipos
 * (`ESTADOS_ASIGNACION_DIARIA`, `RecursoDia`, `mensajeConflictoProgramacionDia`), que reutiliza el motor por intervalos.
 */
export const ESTADOS_ASIGNACION_DIARIA = ["Programado", "Cargado", "En ruta", "Descargado", "Cerrado"] as const;
const estadosSql = ESTADOS_ASIGNACION_DIARIA.map(() => "?").join(",");

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — el TC es un cuarto recurso de la reserva
 * diaria, con su PROPIA columna (tms_planes_viaje.tc_vehiculo_id ->
 * flota_vehiculos.id): nunca comparte id con `unidad` (tms_unidades.id) ni
 * se guarda en unidad_id. El motor por intervalos (disponibilidad-
 * traslapes.ts) no lo conoce a propósito — solo esta política diaria.
 */
export type TipoRecursoDia = TipoRecurso | "tc";
export type RecursoDia = { tipo: TipoRecursoDia; id: number };

type Fila = RowDataPacket & { recurso_id: number; nombre: string; plan_id: number; codigo: string; fecha: string };
export type ConflictoDia = {
  tipo: TipoRecursoDia;
  id: number;
  nombre: string;
  planIdConflicto: number;
  codigoConflicto: string;
  fechaConflicto: string;
};
export type OcupacionDia = { planId: number; planCodigo: string; horaInicio: string; horaFin: null };

async function leer(conn: PoolConnection | undefined, sql: string, params: SqlParams): Promise<Fila[]> {
  if (conn) {
    // PATCH ya pudo abrir un snapshot REPEATABLE READ antes de GET_LOCK.
    // La lectura bloqueante es current read y ve el commit del escritor anterior.
    const [rows] = await conn.query<Fila[]>(`${sql} FOR UPDATE`, params);
    return rows;
  }
  return query<Fila[]>(sql, params);
}

/** Una consulta para TODOS los empleados, o para TODOS los personal_id seleccionados. */
async function personalDelDia(empresaId: number, fecha: string, excluirPlanId: number | null, ids?: number[], conn?: PoolConnection) {
  if (ids && !ids.length) return [];
  return leer(conn, `SELECT tp.id AS recurso_id, tp.id_empleado, tp.nombre, p.id AS plan_id, p.codigo,
      DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha
    FROM tms_personal tp
    INNER JOIN tms_personal eq ON eq.empresa_id = tp.empresa_id
      AND (eq.id = tp.id OR (tp.id_empleado IS NOT NULL AND eq.id_empleado = tp.id_empleado))
    INNER JOIN tms_planes_viaje p ON p.empresa_id = tp.empresa_id
      AND (p.piloto_id = eq.id OR p.auxiliar_id = eq.id OR EXISTS (
        SELECT 1 FROM tms_plan_auxiliares pa WHERE pa.plan_id = p.id AND pa.personal_id = eq.id))
    WHERE tp.empresa_id = ? AND p.fecha_plan = ? AND p.estado IN (${estadosSql})
      ${ids ? `AND tp.id IN (${ids.map(() => "?").join(",")})` : "AND tp.id_empleado IS NOT NULL"}
      ${excluirPlanId != null ? "AND p.id != ?" : ""}
    ORDER BY p.id ASC`,
  [empresaId, fecha, ...ESTADOS_ASIGNACION_DIARIA, ...(ids ?? []), ...(excluirPlanId != null ? [excluirPlanId] : [])]);
}

/** Una consulta para TODAS las unidades, o para TODOS los unidad_id seleccionados. */
async function unidadesDelDia(empresaId: number, fecha: string, excluirPlanId: number | null, ids?: number[], conn?: PoolConnection) {
  if (ids && !ids.length) return [];
  return leer(conn, `SELECT u.id AS recurso_id, u.placa AS nombre, p.id AS plan_id, p.codigo,
      DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha
    FROM tms_unidades u
    INNER JOIN tms_planes_viaje p ON p.empresa_id = u.empresa_id AND p.unidad_id = u.id
    WHERE u.empresa_id = ? AND p.fecha_plan = ? AND p.estado IN (${estadosSql})
      ${ids ? `AND u.id IN (${ids.map(() => "?").join(",")})` : ""}
      ${excluirPlanId != null ? "AND p.id != ?" : ""}
    ORDER BY p.id ASC`,
  [empresaId, fecha, ...ESTADOS_ASIGNACION_DIARIA, ...(ids ?? []), ...(excluirPlanId != null ? [excluirPlanId] : [])]);
}

/**
 * Una consulta para TODOS los TC, o para TODOS los tc_vehiculo_id
 * seleccionados. Acota por `p.empresa_id` (el plan), no por el dueño del
 * vehículo: un TC compartido (flota_vehiculo_acceso) pertenece a otra
 * empresa pero se reserva por los planes de ESTA.
 */
async function tcsDelDia(empresaId: number, fecha: string, excluirPlanId: number | null, ids?: number[], conn?: PoolConnection) {
  if (ids && !ids.length) return [];
  return leer(conn, `SELECT v.id AS recurso_id, v.placa AS nombre, p.id AS plan_id, p.codigo,
      DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha
    FROM flota_vehiculos v
    INNER JOIN tms_planes_viaje p ON p.tc_vehiculo_id = v.id
    WHERE p.empresa_id = ? AND p.fecha_plan = ? AND p.estado IN (${estadosSql})
      ${ids ? `AND v.id IN (${ids.map(() => "?").join(",")})` : ""}
      ${excluirPlanId != null ? "AND p.id != ?" : ""}
    ORDER BY p.id ASC`,
  [empresaId, fecha, ...ESTADOS_ASIGNACION_DIARIA, ...(ids ?? []), ...(excluirPlanId != null ? [excluirPlanId] : [])]);
}

const ocupacion = (r: Fila): OcupacionDia => ({ planId: Number(r.plan_id), planCodigo: String(r.codigo), horaInicio: "", horaFin: null });

/**
 * Dropdowns: tres consultas en lote, independientes del número de opciones.
 * La de TC es tolerante: si tc_vehiculo_id todavía no existe (migración sin
 * aplicar) devuelve vacío en vez de romper piloto/auxiliar/unidad.
 */
export async function listarDisponibilidadProgramacionDia(empresaId: number, fecha: string, excluirPlanId: number | null) {
  const [personas, unidades, tcFilas] = await Promise.all([
    personalDelDia(empresaId, fecha, excluirPlanId),
    unidadesDelDia(empresaId, fecha, excluirPlanId),
    tcsDelDia(empresaId, fecha, excluirPlanId).catch((): Fila[] => []),
  ]);
  const personal = new Map<number, OcupacionDia>();
  const placas = new Map<string, OcupacionDia>();
  const tcs = new Map<string, OcupacionDia>();
  for (const r of tcFilas) {
    const placa = String(r.nombre).toUpperCase();
    if (!tcs.has(placa)) tcs.set(placa, ocupacion(r));
  }
  for (const r of personas) {
    const id = Number(r.id_empleado);
    if (!personal.has(id)) personal.set(id, ocupacion(r));
  }
  for (const r of unidades) {
    const placa = String(r.nombre).toUpperCase();
    if (!placas.has(placa)) placas.set(placa, ocupacion(r));
  }
  return { personal, unidades: placas, tcs };
}

/** POST/PATCH/import: misma fecha, estados y consultas que los dropdowns; máximo dos queries. */
export async function primerConflictoProgramacionDia(
  empresaId: number, recursos: RecursoDia[], fecha: string, excluirPlanId: number | null, conn?: PoolConnection,
): Promise<ConflictoDia | null> {
  if (!recursos.length) return null;
  const idsPersonal = [...new Set(recursos.filter((r) => r.tipo !== "unidad" && r.tipo !== "tc").map((r) => r.id))];
  const idsUnidad = [...new Set(recursos.filter((r) => r.tipo === "unidad").map((r) => r.id))];
  const idsTc = [...new Set(recursos.filter((r) => r.tipo === "tc").map((r) => r.id))];
  const personas = idsPersonal.length ? await personalDelDia(empresaId, fecha, excluirPlanId, idsPersonal, conn) : [];
  const unidades = idsUnidad.length ? await unidadesDelDia(empresaId, fecha, excluirPlanId, idsUnidad, conn) : [];
  const tcs = idsTc.length ? await tcsDelDia(empresaId, fecha, excluirPlanId, idsTc, conn) : [];
  for (const recurso of recursos) {
    const fuente = recurso.tipo === "unidad" ? unidades : recurso.tipo === "tc" ? tcs : personas;
    const r = fuente.find((x) => Number(x.recurso_id) === recurso.id);
    if (r) return { tipo: recurso.tipo, id: recurso.id, nombre: String(r.nombre), planIdConflicto: Number(r.plan_id),
      codigoConflicto: String(r.codigo), fechaConflicto: String(r.fecha) };
  }
  return null;
}

export function mensajeConflictoProgramacionDia(c: ConflictoDia) {
  const [anio, mes, dia] = c.fechaConflicto.split("-");
  const etiqueta = c.tipo === "unidad" ? "La unidad" : c.tipo === "tc" ? "El TC" : c.tipo === "piloto" ? "El piloto" : "El auxiliar";
  return `${etiqueta} ${c.nombre} ya está asignad${c.tipo === "unidad" ? "a" : "o"} al ${c.codigoConflicto} para el ${dia}/${mes}/${anio}.`;
}
