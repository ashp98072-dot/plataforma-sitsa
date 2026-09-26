import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, type SqlParams } from "@/lib/db";
import { ESTADOS_ASIGNACION_DIARIA, mensajeConflictoProgramacionDia, type RecursoDia } from "./disponibilidad-programacion-dia";
import { inicioViaje, seSolapaConOcupacionReal, type IntervaloConsulta } from "./disponibilidad-traslapes";

/**
 * Motor de planificación por intervalos (A1). Todavía no sustituye la política
 * diaria de POST/PATCH/importación/copia: esos flujos deben migrarse juntos en
 * A2, conservando su revalidación bajo tms_traslape_<empresa>.
 * PR-0 edición rápida: admite excluir VARIOS planes (`excluirPlanIds`).
 *
 * Un plan completo ocupa [fecha_plan + hora_carga, regreso_estimado). Si falta
 * cualquiera de los extremos, ocupa [inicio del día, inicio del día siguiente).
 * Es una reserva de calendario, no la ocupación física de Flota: no se usa
 * hora_llegada ni cerrado_en para reconstruir la planificación histórica.
 */
export type VentanaProgramacion = {
  fechaPlan: string;
  horaCarga: string | null;
  regresoEstimado: string | null;
};

export type ConflictoProgramacionIntervalo = {
  tipo: RecursoDia["tipo"];
  id: number;
  nombre: string;
  planIdConflicto: number;
  codigoConflicto: string;
  inicioConflicto: string;
  finConflicto: string;
};

type Candidato = RowDataPacket & {
  recurso_id: number;
  nombre: string;
  plan_id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  regreso_estimado: string | null;
};

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const REGRESO_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;

function fechaValida(fecha: string): boolean {
  const partes = FECHA_RE.exec(fecha);
  if (!partes) return false;
  const instante = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  return instante.getUTCFullYear() === Number(partes[1])
    && instante.getUTCMonth() + 1 === Number(partes[2])
    && instante.getUTCDate() === Number(partes[3]);
}

function horaValida(hora: string): boolean {
  const partes = HORA_RE.exec(hora);
  return partes != null && Number(partes[1]) < 24 && Number(partes[2]) < 60
    && (partes[3] == null || Number(partes[3]) < 60);
}

function siguienteDia(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia + 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function diaCompleto(fecha: string): IntervaloConsulta & { fin: string } {
  return { inicio: `${fecha} 00:00:00`, fin: `${siguienteDia(fecha)} 00:00:00` };
}

/** Nunca infiere duración. Una ventana completa inválida se rechaza. */
export function intervaloProgramacion(ventana: VentanaProgramacion): IntervaloConsulta & { fin: string } {
  const { fechaPlan, horaCarga, regresoEstimado } = ventana;
  if (!fechaValida(fechaPlan)) throw new Error("Fecha de programación inválida.");
  if (horaCarga != null && !horaValida(horaCarga)) throw new Error("Hora de carga inválida.");
  if (regresoEstimado != null) {
    const partes = REGRESO_RE.exec(regresoEstimado);
    if (!partes || !fechaValida(partes[1]) || !horaValida(`${partes[2]}${partes[3] == null ? "" : `:${partes[3]}`}`)) {
      throw new Error("Regreso estimado inválido.");
    }
  }
  if (horaCarga == null || regresoEstimado == null) return diaCompleto(fechaPlan);
  const inicio = inicioViaje(fechaPlan, horaCarga);
  const fin = regresoEstimado.replace("T", " ").padEnd(19, ":00");
  if (fin <= inicio) throw new Error("El regreso estimado debe ser posterior a la hora de carga.");
  return { inicio, fin };
}

/**
 * A2.1 — ventana utilizable por POST/PATCH/importación aunque el dato venga incompleto o incoherente (hora con
 * formato inválido, regreso <= carga, regreso sin hora…): nunca lanza por hora/regreso; sin ventana completa válida
 * conserva la reserva conservadora de TODO `fecha_plan`. Solo lanza si la fecha misma es inválida (los llamadores ya
 * la validan). No inventa duración.
 */
export function ventanaProgramacionSegura(ventana: VentanaProgramacion): VentanaProgramacion {
  const limpia: VentanaProgramacion = {
    fechaPlan: ventana.fechaPlan,
    horaCarga: ventana.horaCarga || null,
    regresoEstimado: ventana.regresoEstimado || null,
  };
  try {
    intervaloProgramacion(limpia);
    return limpia;
  } catch {
    if (!fechaValida(limpia.fechaPlan)) throw new Error("Fecha de programación inválida.");
    return { fechaPlan: limpia.fechaPlan, horaCarga: null, regresoEstimado: null };
  }
}

/** Dos ventanas de planificación (ya seguras) se solapan como intervalos semiabiertos [inicio, fin). */
export function ventanasProgramacionSeSolapan(a: VentanaProgramacion, b: VentanaProgramacion): boolean {
  return seSolapaConOcupacionReal(
    intervaloProgramacion(ventanaProgramacionSegura(a)),
    intervaloProgramacion(ventanaProgramacionSegura(b)),
  );
}

/** Mismo texto que la política diaria ("… ya está asignado al PLAN-X para el dd/mm/aaaa."); la fecha es la del inicio del conflicto. */
export function mensajeConflictoProgramacionIntervalo(c: ConflictoProgramacionIntervalo): string {
  return mensajeConflictoProgramacionDia({
    tipo: c.tipo, id: c.id, nombre: c.nombre, planIdConflicto: c.planIdConflicto,
    codigoConflicto: c.codigoConflicto, fechaConflicto: c.inicioConflicto.slice(0, 10),
  });
}

/** Históricos incoherentes nunca liberan recursos: vuelven a la reserva diaria. */
function intervaloCandidato(fila: Candidato): IntervaloConsulta & { fin: string } {
  try {
    return intervaloProgramacion({
      fechaPlan: fila.fecha_plan,
      horaCarga: fila.hora_carga,
      regresoEstimado: fila.regreso_estimado,
    });
  } catch {
    return diaCompleto(fila.fecha_plan);
  }
}

const estados = ESTADOS_ASIGNACION_DIARIA.map(() => "?").join(",");

/**
 * Predicado acotado por empresa/recurso/estado y por ventana: candidatos que
 * empiezan entre los días de la consulta O empezaron antes y regresan después
 * de su inicio. Así se encuentran viajes de ayer que terminan hoy (y viajes
 * multidiarios), sin cargar todo el historial en memoria.
 */
const ventanaSql = `p.empresa_id = ? AND p.estado IN (${estados})
  AND COALESCE(p.tipo_viaje, 'Propio') <> 'Tercerizado'
  AND p.fecha_plan <= ?
  AND (p.fecha_plan >= ? OR p.regreso_estimado > ?)`;

const columnas = (recursoId: string, nombre: string) => `SELECT ${recursoId} AS recurso_id, ${nombre} AS nombre, p.id AS plan_id, p.codigo,
  DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
  p.hora_carga,
  DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado`;

async function leer(
  conn: PoolConnection | undefined, sql: string, params: SqlParams,
): Promise<Candidato[]> {
  if (conn) {
    // Current read aun si PATCH abrió un snapshot REPEATABLE READ antes del candado.
    const [rows] = await conn.query<Candidato[]>(`${sql} FOR UPDATE`, params);
    return rows;
  }
  return query<Candidato[]>(sql, params);
}

/**
 * Ids de plan a excluir de la comparación (deduplicados y saneados). `[]` = no excluir nada. Un lote que reemplaza
 * asignaciones (p. ej. intercambio de pilotos) excluye todos los planes que él mismo reescribe: su estado FINAL se
 * compara aparte, no contra el estado viejo de la BD.
 */
export function normalizarPlanesExcluidos(excluirPlanIds: readonly number[]): number[] {
  return [...new Set(excluirPlanIds.filter((id) => Number.isInteger(id) && id > 0))];
}

/** Consulta compartida para piloto, auxiliares, unidad y TC; sin N+1 por recurso. */
export async function primerConflictoProgramacionIntervalo(
  empresaId: number,
  recursos: RecursoDia[],
  ventana: VentanaProgramacion,
  excluirPlanIds: readonly number[],
  conn?: PoolConnection,
): Promise<ConflictoProgramacionIntervalo | null> {
  if (!recursos.length) return null; // Tercerizado sin recursos internos.
  const intervaloNuevo = intervaloProgramacion(ventana);
  const fechaInicio = intervaloNuevo.inicio.slice(0, 10);
  const fechaFin = intervaloNuevo.fin.slice(0, 10);
  const base: SqlParams = [empresaId, ...ESTADOS_ASIGNACION_DIARIA, fechaFin, fechaInicio, intervaloNuevo.inicio];
  const excluidos = normalizarPlanesExcluidos(excluirPlanIds);
  // Siempre parametrizado: nunca se concatenan ids en el SQL.
  const excluirSql = excluidos.length ? ` AND p.id NOT IN (${Array(excluidos.length).fill("?").join(",")})` : "";
  const idsPersonal = [...new Set(recursos.filter((r) => r.tipo === "piloto" || r.tipo === "auxiliar").map((r) => r.id))];
  const idsUnidad = [...new Set(recursos.filter((r) => r.tipo === "unidad").map((r) => r.id))];
  const idsTc = [...new Set(recursos.filter((r) => r.tipo === "tc").map((r) => r.id))];
  const idsSql = (n: number) => Array(n).fill("?").join(",");
  const params = (ids: number[]): SqlParams => [...base, ...ids, ...excluidos];

  const [personas, unidades, tcs] = await Promise.all([
    idsPersonal.length ? leer(conn,
      `${columnas("tp.id", "tp.nombre")}
       FROM tms_personal tp
       INNER JOIN tms_personal eq ON eq.empresa_id = tp.empresa_id
         AND (eq.id = tp.id OR (tp.id_empleado IS NOT NULL AND eq.id_empleado = tp.id_empleado))
       INNER JOIN tms_planes_viaje p ON p.empresa_id = tp.empresa_id
         AND (p.piloto_id = eq.id OR p.auxiliar_id = eq.id OR EXISTS (
           SELECT 1 FROM tms_plan_auxiliares pa WHERE pa.plan_id = p.id AND pa.personal_id = eq.id)
           OR EXISTS (SELECT 1 FROM tms_plan_pilotos_adicionales pe WHERE pe.plan_id = p.id AND pe.personal_id = eq.id))
       WHERE ${ventanaSql} AND tp.empresa_id = ? AND tp.id IN (${idsSql(idsPersonal.length)})${excluirSql}
       ORDER BY p.fecha_plan, p.id`,
      [...base, empresaId, ...idsPersonal, ...excluidos],
    ) : Promise.resolve([] as Candidato[]),
    idsUnidad.length ? leer(conn,
      `${columnas("u.id", "u.placa")}
       FROM tms_unidades u
       INNER JOIN tms_planes_viaje p ON p.empresa_id = u.empresa_id AND p.unidad_id = u.id
       WHERE ${ventanaSql} AND u.id IN (${idsSql(idsUnidad.length)})${excluirSql}
       ORDER BY p.fecha_plan, p.id`,
      params(idsUnidad),
    ) : Promise.resolve([] as Candidato[]),
    idsTc.length ? leer(conn,
      `${columnas("v.id", "v.placa")}
       FROM flota_vehiculos v
       INNER JOIN tms_planes_viaje p ON p.tc_vehiculo_id = v.id
       WHERE ${ventanaSql} AND v.id IN (${idsSql(idsTc.length)})${excluirSql}
       ORDER BY p.fecha_plan, p.id`,
      params(idsTc),
    ) : Promise.resolve([] as Candidato[]),
  ]);

  for (const recurso of recursos) {
    const fuente = recurso.tipo === "unidad" ? unidades : recurso.tipo === "tc" ? tcs : personas;
    for (const fila of fuente) {
      if (Number(fila.recurso_id) !== recurso.id) continue;
      const intervaloExistente = intervaloCandidato(fila);
      if (!seSolapaConOcupacionReal(intervaloExistente, intervaloNuevo)) continue;
      return {
        tipo: recurso.tipo, id: recurso.id, nombre: String(fila.nombre),
        planIdConflicto: Number(fila.plan_id), codigoConflicto: String(fila.codigo),
        inicioConflicto: intervaloExistente.inicio, finConflicto: intervaloExistente.fin,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- lectura / buscadores
export type OcupacionIntervalo = { planId: number; planCodigo: string; horaInicio: string; horaFin: null };

/**
 * A2.2 — ocupación de TODOS los recursos de la empresa frente a la ventana consultada (buscadores de Programación).
 * Misma política que `primerConflictoProgramacionIntervalo`: mismos estados, mismo predicado de ventana, misma
 * comparación de intervalos (semiabiertos; sin hora o sin regreso = todo fecha_plan) y misma exclusión de planes.
 * Forma de la respuesta = contrato de `listarDisponibilidadProgramacionDia`: personal por `empleados.id`
 * (`tms_personal.id_empleado`, equivalencia entre filas del mismo empleado), unidades y TC por placa en mayúsculas.
 */
export async function listarOcupacionProgramacionIntervalo(
  empresaId: number,
  ventana: VentanaProgramacion,
  excluirPlanIds: readonly number[],
): Promise<{ personal: Map<number, OcupacionIntervalo>; unidades: Map<string, OcupacionIntervalo>; tcs: Map<string, OcupacionIntervalo> }> {
  const ventanaSegura = ventanaProgramacionSegura(ventana);
  const intervaloConsulta = intervaloProgramacion(ventanaSegura);
  const excluidos = normalizarPlanesExcluidos(excluirPlanIds);
  const excluirSql = excluidos.length ? ` AND p.id NOT IN (${Array(excluidos.length).fill("?").join(",")})` : "";
  const base: SqlParams = [empresaId, ...ESTADOS_ASIGNACION_DIARIA, intervaloConsulta.fin.slice(0, 10), intervaloConsulta.inicio.slice(0, 10), intervaloConsulta.inicio];
  const [personas, unidades, tcs] = await Promise.all([
    query<Candidato[]>(
      `${columnas("tp.id_empleado", "tp.nombre")}
       FROM tms_personal tp
       INNER JOIN tms_personal eq ON eq.empresa_id = tp.empresa_id
         AND (eq.id = tp.id OR (tp.id_empleado IS NOT NULL AND eq.id_empleado = tp.id_empleado))
       INNER JOIN tms_planes_viaje p ON p.empresa_id = tp.empresa_id
         AND (p.piloto_id = eq.id OR p.auxiliar_id = eq.id OR EXISTS (
           SELECT 1 FROM tms_plan_auxiliares pa WHERE pa.plan_id = p.id AND pa.personal_id = eq.id)
           OR EXISTS (SELECT 1 FROM tms_plan_pilotos_adicionales pe WHERE pe.plan_id = p.id AND pe.personal_id = eq.id))
       WHERE ${ventanaSql} AND tp.empresa_id = ? AND tp.id_empleado IS NOT NULL${excluirSql}
       ORDER BY p.fecha_plan, p.id`,
      [...base, empresaId, ...excluidos],
    ),
    query<Candidato[]>(
      `${columnas("u.placa", "u.placa")}
       FROM tms_unidades u
       INNER JOIN tms_planes_viaje p ON p.empresa_id = u.empresa_id AND p.unidad_id = u.id
       WHERE ${ventanaSql}${excluirSql}
       ORDER BY p.fecha_plan, p.id`,
      [...base, ...excluidos],
    ),
    query<Candidato[]>(
      `${columnas("v.placa", "v.placa")}
       FROM flota_vehiculos v
       INNER JOIN tms_planes_viaje p ON p.tc_vehiculo_id = v.id
       WHERE ${ventanaSql}${excluirSql}
       ORDER BY p.fecha_plan, p.id`,
      [...base, ...excluidos],
    ).catch((): Candidato[] => []), // catálogo de TC aún no migrado: como en la política diaria
  ]);
  const ocupacion = (f: Candidato): OcupacionIntervalo => ({ planId: Number(f.plan_id), planCodigo: String(f.codigo), horaInicio: "", horaFin: null });
  const choca = (f: Candidato) => seSolapaConOcupacionReal(intervaloCandidato(f), intervaloConsulta);
  const personal = new Map<number, OcupacionIntervalo>();
  for (const f of personas) if (choca(f) && !personal.has(Number(f.recurso_id))) personal.set(Number(f.recurso_id), ocupacion(f));
  const porPlaca = (filas: Candidato[]) => {
    const m = new Map<string, OcupacionIntervalo>();
    for (const f of filas) { const placa = String(f.recurso_id).toUpperCase(); if (choca(f) && !m.has(placa)) m.set(placa, ocupacion(f)); }
    return m;
  };
  return { personal, unidades: porPlaca(unidades), tcs: porPlaca(tcs) };
}
