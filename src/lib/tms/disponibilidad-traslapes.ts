import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, type SqlParams } from "@/lib/db";

/**
 * VIAT-2 — validación real de traslapes de piloto/auxiliar/unidad al
 * crear o editar un viaje en Programación. Única función reutilizable
 * (nada de tres validaciones duplicadas): recibe la lista de recursos a
 * comprobar (piloto, cada auxiliar, unidad) contra el intervalo real del
 * NUEVO viaje y devuelve el primer conflicto real que encuentra, con toda
 * la info necesaria para el mensaje de error.
 *
 * Intervalo real de un viaje:
 *   inicio = fecha_plan + hora_carga (COALESCE 00:00:00 si no hay hora)
 *   fin    = regreso_estimado (COALESCE fin de día si un plan histórico no
 *            lo tiene — nunca se inventa una duración; ver
 *            planes/route.ts, que ahora exige regreso_estimado para poder
 *            guardar cuando hay piloto/unidad/auxiliares asignados, así
 *            que este COALESCE solo protege contra planes ANTERIORES a
 *            esa regla).
 *
 * Hay conflicto si: inicio_existente < fin_nuevo AND fin_existente > inicio_nuevo
 * (no se bloquea por "misma fecha" — 08:00-12:00 y 13:00-18:00 el mismo
 * día NO chocan).
 *
 * Un mismo empleado (personal_id de tms_personal) no puede estar en dos
 * viajes traslapados sin importar si en cada uno es piloto o auxiliar —
 * es la misma persona físicamente, así que "piloto" y "auxiliar" comparten
 * la misma comprobación (piloto_id, auxiliar_id legado, o
 * tms_plan_auxiliares); solo cambia la etiqueta que se usa en el mensaje.
 *
 * Estados que reservan el recurso (bloquean): Programado, En ruta, Cargado.
 * Estados que YA NO reservan (se excluyen, igual que el propio plan que se
 * edita): Descargado, Cerrado, Cancelado — según el modelo actual, un
 * viaje en cualquiera de esos tres estados ya liberó piloto/auxiliares/
 * unidad (Descargado/Cerrado = viaje terminado; Cancelado = nunca se hizo).
 */
export const ESTADOS_QUE_RESERVAN_RECURSOS = ["Programado", "En ruta", "Cargado"] as const;

export type TipoRecurso = "piloto" | "auxiliar" | "unidad";

export type RecursoAValidar = {
  tipo: TipoRecurso;
  /** personal_id (tms_personal) para piloto/auxiliar; id de tms_unidades para unidad. */
  id: number;
};

export type IntervaloViaje = {
  /** "YYYY-MM-DD HH:mm:ss" — ya combinado, listo para SQL. */
  inicio: string;
  fin: string;
};

export type ConflictoTraslape = {
  tipo: TipoRecurso;
  id: number;
  /** Nombre del piloto/auxiliar o placa de la unidad, para el mensaje. */
  nombre: string;
  planIdConflicto: number;
  codigoConflicto: string;
  inicioConflicto: string;
  finConflicto: string;
};

async function runQuery<T extends RowDataPacket[]>(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  if (conn) {
    const [rows] = await conn.query<RowDataPacket[]>(sql, params);
    return rows as T;
  }
  return query<RowDataPacket[]>(sql, params) as Promise<T>;
}

const RESERVA_PLACEHOLDERS = ESTADOS_QUE_RESERVAN_RECURSOS.map(() => "?").join(",");

/** Combina fecha_plan (DATE) y hora_carga (opcional) en "YYYY-MM-DD HH:mm:ss". */
export function inicioViaje(fechaPlan: string, horaCarga: string | null | undefined): string {
  const hora = (horaCarga || "00:00:00").slice(0, 8);
  return `${fechaPlan} ${hora.length === 5 ? `${hora}:00` : hora}`;
}

/**
 * regreso_estimado ya viene como "YYYY-MM-DDTHH:mm" desde el formulario/zod
 * — mismo `.replace("T", " ")` que ya usa el resto de planes/route.ts al
 * guardar (MySQL acepta un DATETIME sin segundos).
 */
export function finViajeDesdeInput(regresoEstimado: string | null | undefined): string | null {
  if (!regresoEstimado) return null;
  return regresoEstimado.replace("T", " ");
}

async function buscarConflictoPersonal(
  conn: PoolConnection | undefined,
  empresaId: number,
  personalId: number,
  intervalo: IntervaloViaje,
  excluirPlanId: number | null,
): Promise<{ nombre: string; conflicto: RowDataPacket } | null> {
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT tp.nombre AS recurso_nombre, p.id AS plan_id, p.codigo,
            DATE_FORMAT(TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')), '%Y-%m-%d %H:%i') AS inicio,
            DATE_FORMAT(COALESCE(p.regreso_estimado, TIMESTAMP(p.fecha_plan, '23:59:59')), '%Y-%m-%d %H:%i') AS fin
     FROM tms_personal tp
     INNER JOIN tms_planes_viaje p
       ON p.empresa_id = tp.empresa_id
      AND (p.piloto_id = tp.id OR p.auxiliar_id = tp.id
           OR EXISTS (
             SELECT 1 FROM tms_plan_auxiliares pa
             WHERE pa.plan_id = p.id AND pa.personal_id = tp.id
           ))
     WHERE tp.id = ? AND tp.empresa_id = ?
       AND p.estado IN (${RESERVA_PLACEHOLDERS})
       ${excluirPlanId ? "AND p.id != ?" : ""}
       AND TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')) < ?
       AND COALESCE(p.regreso_estimado, TIMESTAMP(p.fecha_plan, '23:59:59')) > ?
     LIMIT 1`,
    [
      personalId,
      empresaId,
      ...ESTADOS_QUE_RESERVAN_RECURSOS,
      ...(excluirPlanId ? [excluirPlanId] : []),
      intervalo.fin,
      intervalo.inicio,
    ],
  );
  if (!rows[0]) return null;
  return { nombre: String(rows[0].recurso_nombre), conflicto: rows[0] };
}

async function buscarConflictoUnidad(
  conn: PoolConnection | undefined,
  empresaId: number,
  unidadId: number,
  intervalo: IntervaloViaje,
  excluirPlanId: number | null,
): Promise<{ nombre: string; conflicto: RowDataPacket } | null> {
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT u.placa AS recurso_nombre, p.id AS plan_id, p.codigo,
            DATE_FORMAT(TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')), '%Y-%m-%d %H:%i') AS inicio,
            DATE_FORMAT(COALESCE(p.regreso_estimado, TIMESTAMP(p.fecha_plan, '23:59:59')), '%Y-%m-%d %H:%i') AS fin
     FROM tms_unidades u
     INNER JOIN tms_planes_viaje p
       ON p.empresa_id = u.empresa_id AND p.unidad_id = u.id
     WHERE u.id = ? AND u.empresa_id = ?
       AND p.estado IN (${RESERVA_PLACEHOLDERS})
       ${excluirPlanId ? "AND p.id != ?" : ""}
       AND TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')) < ?
       AND COALESCE(p.regreso_estimado, TIMESTAMP(p.fecha_plan, '23:59:59')) > ?
     LIMIT 1`,
    [
      unidadId,
      empresaId,
      ...ESTADOS_QUE_RESERVAN_RECURSOS,
      ...(excluirPlanId ? [excluirPlanId] : []),
      intervalo.fin,
      intervalo.inicio,
    ],
  );
  if (!rows[0]) return null;
  return { nombre: String(rows[0].recurso_nombre), conflicto: rows[0] };
}

/**
 * Verifica los recursos dados (piloto/auxiliares/unidad) contra el
 * intervalo real del viaje que se está guardando. Devuelve el PRIMER
 * conflicto encontrado (falla rápido — el llamador decide si sigue
 * comprobando el resto o rechaza de una vez), o `null` si no hay ninguno.
 *
 * `conn` opcional: si viene (dentro de la transacción de PATCH en
 * planes/route.ts), la lectura usa esa misma conexión — junto con un
 * GET_LOCK por empresa que el propio route.ts adquiere alrededor de esta
 * verificación + el guardado, para no dejar una ventana
 * SELECT -> UI -> guardar donde dos solicitudes concurrentes pasen la
 * comprobación antes de que cualquiera escriba.
 */
export async function primerConflictoTraslape(
  empresaId: number,
  recursos: RecursoAValidar[],
  intervalo: IntervaloViaje,
  excluirPlanId: number | null,
  conn?: PoolConnection,
): Promise<ConflictoTraslape | null> {
  for (const recurso of recursos) {
    const resultado =
      recurso.tipo === "unidad"
        ? await buscarConflictoUnidad(conn, empresaId, recurso.id, intervalo, excluirPlanId)
        : await buscarConflictoPersonal(conn, empresaId, recurso.id, intervalo, excluirPlanId);
    if (resultado) {
      const c = resultado.conflicto;
      return {
        tipo: recurso.tipo,
        id: recurso.id,
        nombre: resultado.nombre,
        planIdConflicto: Number(c.plan_id),
        codigoConflicto: String(c.codigo),
        // Ya vienen formateados como "YYYY-MM-DD HH:mm" desde SQL
        // (DATE_FORMAT) — nunca se deja que mysql2 convierta esto a un
        // objeto Date de JS y se serialice con su toString() por defecto
        // (mismo tipo de bug ya corregido antes para fecha_plan en el GET).
        inicioConflicto: String(c.inicio),
        finConflicto: String(c.fin),
      };
    }
  }
  return null;
}

/** Mensaje de error legible a partir de un conflicto detectado. */
export function mensajeConflicto(c: ConflictoTraslape): string {
  const horaInicio = c.inicioConflicto.slice(11, 16) || "00:00";
  const horaFin = c.finConflicto.slice(11, 16) || "23:59";
  if (c.tipo === "unidad") {
    return `La unidad ${c.nombre} ya está asignada al viaje ${c.codigoConflicto} en ese horario (${horaInicio}–${horaFin}).`;
  }
  const etiqueta = c.tipo === "piloto" ? `El piloto ${c.nombre}` : `El auxiliar ${c.nombre}`;
  return `${etiqueta} ya está asignado al viaje ${c.codigoConflicto} de ${horaInicio} a ${horaFin}.`;
}
