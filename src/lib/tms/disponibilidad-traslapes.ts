import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, type SqlParams } from "@/lib/db";

/**
 * VIAT-2 (OPS-4.2b) — validación real de traslapes de piloto/auxiliar/
 * unidad al crear o editar un viaje en Programación. Única función
 * reutilizable (nada de tres validaciones duplicadas): recibe la lista de
 * recursos a comprobar (piloto, cada auxiliar, unidad) contra el
 * intervalo real del NUEVO viaje y devuelve el primer conflicto real que
 * encuentra, con toda la info necesaria para el mensaje de error.
 *
 * Un candidato (plan existente que ya tiene asignado ese recurso) bloquea
 * si su OCUPACIÓN REAL se solapa con el intervalo del nuevo viaje —
 * `intervaloOcupacionReal()` + `seSolapaConOcupacionReal()` (bloque
 * OPS-4.2a más abajo), NO el intervalo puramente planificado
 * (fecha_plan+hora_carga → regreso_estimado) que se usaba antes de este
 * PR. Diferencia clave, por estado:
 *   - Programado: intervalo planificado tal cual (sin cambios).
 *   - En ruta / Cargado SIN llegada técnica (ver SQL_LLEGADA_TECNICA):
 *     ocupa indefinidamente desde que inicia — un regreso_estimado
 *     vencido YA NO libera el recurso (corrige la SUB-protección
 *     detectada en OPS-4.1).
 *   - En ruta / Cargado CON llegada técnica: deja de bloquear, aunque TMS
 *     siga "En ruta" hasta el cierre administrativo (corrige la
 *     SOBRE-protección detectada en OPS-4.1).
 *   - Cerrado / Cancelado: nunca bloquean (sin cambios).
 *
 * Hay conflicto si: inicio_existente < fin_nuevo AND (fin_existente ==
 * null O fin_existente > inicio_nuevo) — no se bloquea por "misma fecha"
 * (08:00-12:00 y 13:00-18:00 el mismo día NO chocan).
 *
 * Un mismo empleado (personal_id de tms_personal) no puede estar en dos
 * viajes traslapados sin importar si en cada uno es piloto o auxiliar —
 * es la misma persona físicamente, así que "piloto" y "auxiliar" comparten
 * la misma comprobación (piloto_id, auxiliar_id legado, o
 * tms_plan_auxiliares); solo cambia la etiqueta que se usa en el mensaje.
 *
 * Estados candidatos a bloquear (filtro SQL, antes de aplicar ocupación
 * real): Programado, En ruta, Cargado. Estados que YA NO reservan (se
 * excluyen, igual que el propio plan que se edita): Descargado, Cerrado,
 * Cancelado — sin cambios respecto a antes de este PR.
 *
 * REGRESO ESTIMADO OPCIONAL — `regreso_estimado` dejó de ser obligatorio.
 * Un viaje SIN regreso estimado no tiene un intervalo planificado, así que
 * ocupa a sus recursos desde `fecha_plan + hora_carga` hasta una
 * terminación REAL, nunca inventada:
 *   1. `flota_viajes.hora_llegada` (llegada física registrada por Flota/Piloto);
 *   2. si no hay llegada pero el plan ya está Cerrado: `cerrado_en`, usado
 *      SOLO como final administrativo para disponibilidad (no es una
 *      llegada física y nunca se copia a `regreso_estimado`);
 *   3. si no hay ninguna: el viaje sigue abierto (`fin = null`, sin límite).
 * El NUEVO viaje que se valida sin regreso estimado se trata igual: su
 * intervalo es [inicio, sin límite). Un viaje CON regreso estimado conserva
 * exactamente la validación por intervalo de siempre.
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

/**
 * Intervalo del viaje que SE VALIDA. `fin: null` = el viaje no tiene regreso
 * estimado: está abierto hasta que exista una terminación real (ver el
 * encabezado de este módulo). `IntervaloViaje` (fin obligatorio) es
 * asignable a este tipo.
 */
export type IntervaloConsulta = {
  inicio: string;
  fin: string | null;
};

export type ConflictoTraslape = {
  tipo: TipoRecurso;
  id: number;
  /** Nombre del piloto/auxiliar o placa de la unidad, para el mensaje. */
  nombre: string;
  planIdConflicto: number;
  codigoConflicto: string;
  inicioConflicto: string;
  /**
   * OPS-4.2b: `null` cuando el conflicto es un viaje físicamente activo
   * SIN llegada técnica (En ruta/Cargado) — no hay una hora de fin real
   * conocida (ver IntervaloOcupacion en el bloque de más abajo). NUNCA se
   * inventa un fin en ese caso; mensajeConflicto() debe manejarlo aparte.
   */
  finConflicto: string | null;
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

/**
 * Estados que la consulta SQL trae como candidatos. "Cerrado" entra SOLO para
 * los planes sin regreso estimado (su ocupación termina en la llegada real o,
 * si no la hubo, en el cierre administrativo) — el prefiltro de abajo descarta
 * cualquier Cerrado que tenga regreso estimado, que nunca bloquea (sin cambios).
 * `ESTADOS_QUE_RESERVAN_RECURSOS` (arriba) NO cambia: sigue siendo el criterio
 * de si el plan que se está guardando reserva recursos.
 */
const ESTADOS_CANDIDATOS_TRASLAPE = [...ESTADOS_QUE_RESERVAN_RECURSOS, "Cerrado"] as const;
const CANDIDATOS_PLACEHOLDERS = ESTADOS_CANDIDATOS_TRASLAPE.map(() => "?").join(",");

/** Combina fecha_plan (DATE) y hora_carga (opcional) en "YYYY-MM-DD HH:mm:ss". */
export function inicioViaje(fechaPlan: string, horaCarga: string | null | undefined): string {
  const hora = (horaCarga || "00:00:00").slice(0, 8);
  return `${fechaPlan} ${hora.length === 5 ? `${hora}:00` : hora}`;
}

/**
 * regreso_estimado ya viene como "YYYY-MM-DDTHH:mm" desde el formulario/zod
 * — mismo `.replace("T", " ")` que ya usa el resto de planes/route.ts al
 * guardar (MySQL acepta un DATETIME sin segundos, así que esto no cambia
 * ningún valor real guardado).
 *
 * OPS-4.2b: se agregan segundos explícitos ("YYYY-MM-DD HH:mm:ss") cuando
 * faltan — necesario para que las comparaciones lexicográficas de string
 * en seSolapaConOcupacionReal() sean seguras (mismo largo/formato que
 * inicioViaje() y que los DATE_FORMAT con segundos que ahora usan
 * buscarConflictoPersonal/buscarConflictoUnidad). Antes esto solo se usaba
 * como parámetro de una comparación SQL (`TIMESTAMP(...) > ?`), donde
 * MySQL ya hacía el cast sin importar el formato de texto — ahí no había
 * ningún efecto observable.
 */
export function finViajeDesdeInput(regresoEstimado: string | null | undefined): string | null {
  if (!regresoEstimado) return null;
  const normalizado = regresoEstimado.replace("T", " ");
  return normalizado.length === 16 ? `${normalizado}:00` : normalizado;
}

/**
 * OPS-4.2b: de una lista de planes candidatos (ya filtrados por SQL a
 * ESTADOS_QUE_RESERVAN_RECURSOS y por recurso), decide el PRIMERO cuya
 * OCUPACIÓN REAL (no su intervalo planificado) se solapa con el intervalo
 * de consulta — usando la infraestructura de OPS-4.2a
 * (intervaloOcupacionReal + seSolapaConOcupacionReal), no una query SQL
 * de rango. Cada fila ya trae su `llegada_tecnica` resuelta por la MISMA
 * query (vía SQL_LLEGADA_TECNICA) — sin N+1, una sola consulta por
 * recurso a validar, igual que antes.
 */
function primerCandidatoQueOcupa(
  filas: RowDataPacket[],
  nombreCampo: string,
  intervaloConsulta: IntervaloConsulta,
): { nombre: string; planId: number; codigo: string; inicioConflicto: string; finConflicto: string | null } | null {
  for (const r of filas) {
    const ocupacion = intervaloOcupacionReal({
      estado: String(r.estado),
      inicio: String(r.inicio),
      regresoEstimado: r.regreso_estimado != null ? String(r.regreso_estimado) : null,
      llegadaTecnica: Number(r.llegada_tecnica) === 1,
      horaLlegada: r.hora_llegada != null ? String(r.hora_llegada) : null,
      cerradoEn: r.cerrado_en != null ? String(r.cerrado_en) : null,
    });
    if (seSolapaConOcupacionReal(ocupacion, intervaloConsulta)) {
      // ocupacion no puede ser null aquí: seSolapaConOcupacionReal(null, ..)
      // siempre retorna false, así que si llegamos a este punto ocupacion
      // es { inicio, fin }.
      return {
        nombre: String(r[nombreCampo]),
        planId: Number(r.plan_id),
        codigo: String(r.codigo),
        inicioConflicto: ocupacion!.inicio,
        finConflicto: ocupacion!.fin,
      };
    }
  }
  return null;
}

async function buscarConflictoPersonal(
  conn: PoolConnection | undefined,
  empresaId: number,
  personalId: number,
  intervalo: IntervaloConsulta,
  excluirPlanId: number | null,
): Promise<{ nombre: string; planId: number; codigo: string; inicioConflicto: string; finConflicto: string | null } | null> {
  const prefiltro = prefiltroOcupacion(intervalo);
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT tp.nombre AS recurso_nombre, p.id AS plan_id, p.codigo, p.estado,
            DATE_FORMAT(TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')), '%Y-%m-%d %H:%i:%s') AS inicio,
            DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado,
            ${SQL_LLEGADA_TECNICA} AS llegada_tecnica,
            DATE_FORMAT(${SQL_HORA_LLEGADA_REAL}, '%Y-%m-%d %H:%i:%s') AS hora_llegada,
            DATE_FORMAT(p.cerrado_en, '%Y-%m-%d %H:%i:%s') AS cerrado_en
     FROM tms_personal tp
     INNER JOIN tms_planes_viaje p
       ON p.empresa_id = tp.empresa_id
      AND (p.piloto_id = tp.id OR p.auxiliar_id = tp.id
           OR EXISTS (
             SELECT 1 FROM tms_plan_auxiliares pa
             WHERE pa.plan_id = p.id AND pa.personal_id = tp.id
           ))
     WHERE tp.id = ? AND tp.empresa_id = ?
       AND p.estado IN (${CANDIDATOS_PLACEHOLDERS})
       ${excluirPlanId ? "AND p.id != ?" : ""}
       ${prefiltro.sql}`,
    [
      personalId,
      empresaId,
      ...ESTADOS_CANDIDATOS_TRASLAPE,
      ...(excluirPlanId ? [excluirPlanId] : []),
      ...prefiltro.params,
    ],
  );
  return primerCandidatoQueOcupa(rows, "recurso_nombre", intervalo);
}

async function buscarConflictoUnidad(
  conn: PoolConnection | undefined,
  empresaId: number,
  unidadId: number,
  intervalo: IntervaloConsulta,
  excluirPlanId: number | null,
): Promise<{ nombre: string; planId: number; codigo: string; inicioConflicto: string; finConflicto: string | null } | null> {
  const prefiltro = prefiltroOcupacion(intervalo);
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT u.placa AS recurso_nombre, p.id AS plan_id, p.codigo, p.estado,
            DATE_FORMAT(TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')), '%Y-%m-%d %H:%i:%s') AS inicio,
            DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado,
            ${SQL_LLEGADA_TECNICA} AS llegada_tecnica,
            DATE_FORMAT(${SQL_HORA_LLEGADA_REAL}, '%Y-%m-%d %H:%i:%s') AS hora_llegada,
            DATE_FORMAT(p.cerrado_en, '%Y-%m-%d %H:%i:%s') AS cerrado_en
     FROM tms_unidades u
     INNER JOIN tms_planes_viaje p
       ON p.empresa_id = u.empresa_id AND p.unidad_id = u.id
     WHERE u.id = ? AND u.empresa_id = ?
       AND p.estado IN (${CANDIDATOS_PLACEHOLDERS})
       ${excluirPlanId ? "AND p.id != ?" : ""}
       ${prefiltro.sql}`,
    [
      unidadId,
      empresaId,
      ...ESTADOS_CANDIDATOS_TRASLAPE,
      ...(excluirPlanId ? [excluirPlanId] : []),
      ...prefiltro.params,
    ],
  );
  return primerCandidatoQueOcupa(rows, "recurso_nombre", intervalo);
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
  intervalo: IntervaloConsulta,
  excluirPlanId: number | null,
  conn?: PoolConnection,
): Promise<ConflictoTraslape | null> {
  for (const recurso of recursos) {
    const resultado =
      recurso.tipo === "unidad"
        ? await buscarConflictoUnidad(conn, empresaId, recurso.id, intervalo, excluirPlanId)
        : await buscarConflictoPersonal(conn, empresaId, recurso.id, intervalo, excluirPlanId);
    if (resultado) {
      return {
        tipo: recurso.tipo,
        id: recurso.id,
        nombre: resultado.nombre,
        planIdConflicto: resultado.planId,
        codigoConflicto: resultado.codigo,
        // Ya vienen formateados como "YYYY-MM-DD HH:mm:ss" (inicioViaje /
        // DATE_FORMAT con segundos) o son directamente `null` (ocupación
        // sin fin real conocido) — nunca se deja que mysql2 convierta un
        // DATETIME a un objeto Date de JS y se serialice con su toString()
        // por defecto (mismo tipo de bug ya corregido antes para
        // fecha_plan en el GET).
        inicioConflicto: resultado.inicioConflicto,
        finConflicto: resultado.finConflicto,
      };
    }
  }
  return null;
}

/**
 * Mensaje de error legible a partir de un conflicto detectado.
 *
 * OPS-4.2b: `finConflicto: null` significa "viaje físicamente activo sin
 * llegada técnica" (En ruta/Cargado) — no hay una hora de fin real que
 * mostrar, así que NO se inventa (nunca se imprime un regreso_estimado
 * vencido como si fuera el fin real de la ocupación). Se usa un mensaje
 * distinto, sin rango horario.
 */
export function mensajeConflicto(c: ConflictoTraslape): string {
  if (c.finConflicto == null) {
    const etiqueta =
      c.tipo === "unidad"
        ? `La unidad ${c.nombre}`
        : c.tipo === "piloto"
          ? `El piloto ${c.nombre}`
          : `El auxiliar ${c.nombre}`;
    return `${etiqueta} sigue asignado al viaje ${c.codigoConflicto}, que aún no registra llegada.`;
  }
  const horaInicio = c.inicioConflicto.slice(11, 16) || "00:00";
  const horaFin = c.finConflicto.slice(11, 16) || "23:59";
  if (c.tipo === "unidad") {
    return `La unidad ${c.nombre} ya está asignada al viaje ${c.codigoConflicto} en ese horario (${horaInicio}–${horaFin}).`;
  }
  const etiqueta = c.tipo === "piloto" ? `El piloto ${c.nombre}` : `El auxiliar ${c.nombre}`;
  return `${etiqueta} ya está asignado al viaje ${c.codigoConflicto} de ${horaInicio} a ${horaFin}.`;
}

// ============================================================================
// OPS-4.2a/b — criterio unificado de OCUPACIÓN REAL.
//
// USADO por buscarConflictoPersonal / buscarConflictoUnidad /
// primerConflictoTraslape de arriba (OPS-4.2b conectó este criterio ahí —
// antes de ese PR, esas funciones seguían el intervalo puramente
// planificado, sin distinguir llegada técnica; OPS-4.2a solo había
// agregado esta pieza base sin usarla todavía).
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

/** Inicio del plan (fecha_plan + hora_carga) como DATETIME, para el prefiltro SQL de candidatos (CORRECCIÓN PR #83, ver prefiltroOcupacion). */
const SQL_INICIO_PLAN = "TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00'))";

/**
 * Hora de llegada FÍSICA registrada del plan: `flota_viajes.hora_llegada` de
 * un viaje cerrado (la última, si hubiera varios). Es la ÚNICA fuente del
 * "regreso real" — no se duplica en `tms_planes_viaje`. Un cierre manual sin
 * llegada física deja `hora_llegada` en NULL, así que aquí devuelve NULL.
 * Referencia el alias `p` de `tms_planes_viaje`.
 */
export const SQL_HORA_LLEGADA_REAL = `(
  SELECT MAX(fv.hora_llegada) FROM flota_viajes fv
  WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado' AND fv.hora_llegada IS NOT NULL
)`;

/**
 * Prefiltro SQL de candidatos (CORRECCIÓN PR #83): sin él la query solo acotaba
 * por `estado IN (...)`, sin límite temporal, y podía leer todo el historial
 * "activo" del recurso. Reduce lo que se trae a JS sin cambiar la decisión, que sigue siendo de
 * intervaloOcupacionReal() + seSolapaConOcupacionReal(). Cada rama es
 * equivalente o más amplia que esa lógica — nunca más estrecha.
 *
 * - Programado CON regreso estimado: intervalo planificado de siempre.
 * - En ruta / Cargado CON regreso estimado: nunca se filtra por
 *   regreso_estimado (OPS-4.2b); solo que haya iniciado antes de que termine
 *   la consulta y que NO tenga llegada técnica.
 * - Programado / En ruta / Cargado SIN regreso estimado: candidatos por haber
 *   iniciado antes del fin de la consulta; la terminación real (llegada o
 *   abierto) la resuelve el helper de JS.
 * - Cerrado SIN regreso estimado: solo si su terminación real (hora de
 *   llegada o, en su defecto, cerrado_en) es posterior al inicio de la
 *   consulta.
 *
 * `intervalo.fin === null` (consulta sin regreso estimado) elimina la
 * condición "inicia antes de que termine la consulta": no tiene fin.
 * Los parámetros se devuelven en el mismo orden que sus `?`.
 */
function prefiltroOcupacion(intervalo: IntervaloConsulta): { sql: string; params: string[] } {
  const params: string[] = [];
  const iniciaAntesDeFinConsulta = () => {
    if (intervalo.fin == null) return "1 = 1";
    params.push(intervalo.fin);
    return `${SQL_INICIO_PLAN} < ?`;
  };
  const programadoConRegreso = `(
    p.estado = 'Programado'
    AND p.regreso_estimado IS NOT NULL
    AND ${iniciaAntesDeFinConsulta()}
    AND p.regreso_estimado > ?
  )`;
  params.push(intervalo.inicio);
  const activoConRegreso = `(
    p.estado IN ('En ruta', 'Cargado')
    AND p.regreso_estimado IS NOT NULL
    AND ${iniciaAntesDeFinConsulta()}
    AND NOT (${SQL_LLEGADA_TECNICA})
  )`;
  const sinRegreso = `(
    p.estado IN ('Programado', 'En ruta', 'Cargado')
    AND p.regreso_estimado IS NULL
    AND ${iniciaAntesDeFinConsulta()}
  )`;
  const cerradoSinRegreso = `(
    p.estado = 'Cerrado'
    AND p.regreso_estimado IS NULL
    AND ${iniciaAntesDeFinConsulta()}
    AND COALESCE(${SQL_HORA_LLEGADA_REAL}, p.cerrado_en) > ?
  )`;
  params.push(intervalo.inicio);
  return { sql: `AND (${programadoConRegreso} OR ${activoConRegreso} OR ${sinRegreso} OR ${cerradoSinRegreso})`, params };
}

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
  /** Llegada FÍSICA (flota_viajes.hora_llegada), "YYYY-MM-DD HH:mm:ss"; solo se usa si el plan no tiene regreso estimado. */
  horaLlegada?: string | null;
  /** Cierre administrativo (tms_planes_viaje.cerrado_en); solo cuenta como final de un plan Cerrado sin regreso estimado ni llegada. */
  cerradoEn?: string | null;
}): IntervaloOcupacion {
  // Sin regreso estimado no hay intervalo planificado: la ocupación termina
  // en una terminación REAL (ver intervaloSinRegresoEstimado). Con regreso
  // estimado, TODO lo de abajo es exactamente el criterio de siempre.
  if (plan.regresoEstimado == null) return intervaloSinRegresoEstimado(plan);
  if (plan.estado === "Programado") {
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
 * Ocupación de un plan SIN regreso estimado (dato opcional de planificación).
 * Nunca se inventa un fin (+N horas, fin de día, etc.) ni se copia una hora
 * real a `regreso_estimado`:
 *   - Programado / En ruta / Cargado sin llegada: abierto (`fin: null`) desde
 *     `inicio` hasta que exista una terminación real.
 *   - Programado / En ruta / Cargado CON llegada técnica: hasta la hora de
 *     llegada física; si el viaje cerrado en Flota no guardó hora de llegada
 *     (cierre manual), no hay ventana que reservar (`null`, como antes).
 *   - Cerrado: hasta la hora de llegada física o, si no la hubo, hasta el
 *     cierre administrativo (`cerrado_en`), usado SOLO para disponibilidad.
 *     Sin ninguna de las dos marcas, no reserva nada.
 *   - Cualquier otro estado (Descargado, Cancelado…): no ocupa.
 * Una terminación anterior o igual al inicio (p. ej. un viaje futuro cerrado
 * manualmente antes de salir) no genera ventana: no ocupa.
 */
function intervaloSinRegresoEstimado(plan: {
  estado: string;
  inicio: string;
  llegadaTecnica: boolean;
  horaLlegada?: string | null;
  cerradoEn?: string | null;
}): IntervaloOcupacion {
  let fin: string | null;
  if (plan.estado === "Cerrado") {
    fin = plan.horaLlegada ?? plan.cerradoEn ?? null;
    if (fin == null) return null;
  } else if ((ESTADOS_QUE_RESERVAN_RECURSOS as readonly string[]).includes(plan.estado)) {
    if (plan.llegadaTecnica) {
      if (plan.horaLlegada == null) return null;
      fin = plan.horaLlegada;
    } else {
      fin = null;
    }
  } else {
    return null;
  }
  if (fin !== null && fin <= plan.inicio) return null;
  return { inicio: plan.inicio, fin };
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
  consulta: IntervaloConsulta,
): boolean {
  if (!ocupacion) return false;
  // Consulta sin fin (viaje sin regreso estimado): sin límite superior.
  const empiezaAntesDeQueTermineConsulta = consulta.fin == null || ocupacion.inicio < consulta.fin;
  const terminaDespuesDeQueEmpieceConsulta =
    ocupacion.fin == null || ocupacion.fin > consulta.inicio;
  return empiezaAntesDeQueTermineConsulta && terminaDespuesDeQueEmpieceConsulta;
}
