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

// ============================================================================
// OPS-4.2a — criterio unificado de OCUPACIÓN REAL (infraestructura).
//
// NO USADO TODAVÍA por buscarConflictoPersonal / buscarConflictoUnidad /
// primerConflictoTraslape de arriba — esas siguen exactamente igual que
// antes (intervalo planificado vs. regreso_estimado, sin distinguir
// llegada técnica). Conectar este criterio a esas funciones es OPS-4.2b;
// aquí solo se agrega la pieza base reutilizable, ya diseñada para eso.
//
// Origen: hallazgo OPS-4.1 — el intervalo planificado
// (inicio, regreso_estimado) deja de proteger un recurso en cuanto
// regreso_estimado vence, aunque el viaje siga físicamente activo (sin
// llegada técnica registrada en Flota); y al revés, sigue "reservando"
// un recurso ya físicamente libre si la llegada se registró antes de
// regreso_estimado. Este módulo separa el intervalo PLANIFICADO (el que
// ya usa el traslape hoy) del intervalo de OCUPACIÓN REAL (el que
// reflejaría lo que de verdad está pasando con el recurso).
// ============================================================================

/**
 * "Llegada técnica" de un plan: EXACTAMENTE el mismo hecho que ya usa
 * `pendiente_cierre` (constante `SQL_PENDIENTE_CIERRE` en
 * src/app/api/empresas/[slug]/tms/planes/route.ts) — un `flota_viajes`
 * de este plan con `estado = 'cerrado'`. No se infiere por evidencias ni
 * por ningún otro dato.
 *
 * Se repite aquí (en vez de importarse desde route.ts) para no crear una
 * dependencia cruzada API -> lib en sentido inverso — mismo criterio que
 * ya documenta el comentario de `SQL_PENDIENTE_CIERRE`: si algún día
 * diverge, extraerla a un helper compartido sería lo correcto. Referencia
 * el alias `p` de `tms_planes_viaje` — quien la use debe incluir ese
 * alias en su FROM/JOIN.
 */
export const SQL_LLEGADA_TECNICA = `EXISTS (
  SELECT 1 FROM flota_viajes fv
  WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
)`;

/**
 * Estados que, SIN llegada técnica, ocupan el recurso indefinidamente
 * (más allá de `regreso_estimado`, si venció) — el viaje ya salió
 * físicamente y no hay registro de que haya vuelto. "Cargado" se trata
 * igual que "En ruta" para este criterio (ver OPS-4.1 punto 6: hoy ya
 * reserva recursos igual, sin que ningún flujo automático lo transicione
 * a "En ruta" — esa anomalía queda fuera de alcance aquí).
 */
export const ESTADOS_OCUPACION_INDEFINIDA_SIN_LLEGADA = ["En ruta", "Cargado"] as const;

/**
 * Intervalo de ocupación real de un plan.
 *
 * `fin: null` tiene un significado ESTRICTO y EXCLUSIVO: "viaje
 * físicamente activo, sin llegada técnica registrada, sin fin real
 * conocido" — es decir, únicamente En ruta/Cargado SIN llegada. NUNCA
 * representa "falta un dato" — un Programado sin `regreso_estimado`
 * (dato faltante/histórico) no es lo mismo que un viaje sin fin conocido
 * porque sigue en curso; ese caso se resuelve devolviendo `null` (no
 * ocupa) en vez de inventarle un `fin` a un plan que ni siquiera ha
 * salido. Mantener este significado único es lo que permite a
 * OPS-4.2b razonar `fin === null` como "activo físico" sin ambigüedad.
 *
 * `null` (el tipo completo) = no ocupa en absoluto.
 */
export type IntervaloOcupacion = { inicio: string; fin: string | null } | null;

/**
 * Deriva el intervalo de OCUPACIÓN REAL de un plan a partir de su estado,
 * su intervalo planificado y si ya tiene llegada técnica — puro, sin
 * acceso a base de datos (el caller resuelve `llegadaTecnica`, igual que
 * ya hace planes/route.ts para `pendiente_cierre`).
 *
 * - Programado CON `regresoEstimado`: ocupa por su intervalo PLANIFICADO
 *   tal cual siempre (`fin = regresoEstimado`) — un Programado vencido NO
 *   se vuelve "ocupado indefinido"; simplemente ya no bloquea (mismo
 *   comportamiento de hoy).
 * - Programado SIN `regresoEstimado` (dato faltante — plan histórico
 *   anterior a la regla que ya lo exige al asignar recursos, ver
 *   planes/route.ts): `null` (no ocupa). NUNCA `{ inicio, fin: null }` —
 *   ese `fin: null` está reservado exclusivamente para un viaje
 *   físicamente en curso (ver arriba); un Programado no ha salido, no
 *   hay base para tratarlo como "activo sin fin conocido".
 * - En ruta / Cargado SIN llegada técnica: ocupa desde `inicio` sin fin
 *   conocido (`fin = null`) — `regresoEstimado` vencido (o incluso
 *   ausente) no libera el recurso, el viaje sigue físicamente activo.
 * - En ruta / Cargado CON llegada técnica: deja de ocupar (`null`) — el
 *   recurso ya volvió físicamente, aunque TMS siga "En ruta" hasta el
 *   cierre administrativo del Jefe de Operaciones.
 * - Cerrado / Cancelado (o cualquier otro estado no contemplado aquí):
 *   nunca ocupa (`null`).
 */
export function intervaloOcupacionReal(plan: {
  estado: string;
  /** "YYYY-MM-DD HH:mm:ss" — mismo formato que produce inicioViaje(). */
  inicio: string;
  regresoEstimado: string | null;
  llegadaTecnica: boolean;
}): IntervaloOcupacion {
  if (plan.estado === "Programado") {
    // CORRECCIÓN PR #82: sin regresoEstimado no hay intervalo planificado
    // que devolver — nunca se usa `fin: null` aquí, ese significado queda
    // reservado exclusivamente para "viaje físicamente activo sin
    // llegada" (En ruta/Cargado). No inventar un fin que no existe.
    if (plan.regresoEstimado == null) return null;
    return { inicio: plan.inicio, fin: plan.regresoEstimado };
  }
  if (
    (ESTADOS_OCUPACION_INDEFINIDA_SIN_LLEGADA as readonly string[]).includes(plan.estado)
  ) {
    if (plan.llegadaTecnica) return null;
    return { inicio: plan.inicio, fin: null };
  }
  return null;
}

/**
 * ¿El intervalo de ocupación real se solapa con un intervalo de consulta
 * (p.ej. el del plan NUEVO que se quiere validar)? Mismo criterio de
 * solape que ya usa primerConflictoTraslape — sin "misma fecha": dos
 * intervalos que no se tocan en hora no chocan aunque sea el mismo día.
 * `fin: null` en la ocupación se trata como "sin límite superior" (nunca
 * termina, siempre se solapa si ya empezó antes de que acabe la consulta).
 */
export function seSolapaConOcupacionReal(
  ocupacion: IntervaloOcupacion,
  consulta: IntervaloViaje,
): boolean {
  if (!ocupacion) return false;
  const empiezaAntesDeQueTermineConsulta = ocupacion.inicio < consulta.fin;
  const terminaDespuesDeQueEmpieceConsulta =
    ocupacion.fin == null || ocupacion.fin > consulta.inicio;
  return empiezaAntesDeQueTermineConsulta && terminaDespuesDeQueEmpieceConsulta;
}
