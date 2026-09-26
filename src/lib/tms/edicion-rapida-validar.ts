import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query } from "@/lib/db";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { hoyLocal } from "@/lib/rrhh/dates";
import { tarifaParaSnapshot } from "@/lib/tms/ruta-tarifas";
import { listarViaticosRechazadosDelPlan, personalRecienAsignadoDelPlan } from "@/lib/tms/viaticos";
import type { RecursoDia } from "./disponibilidad-programacion-dia";
import {
  mensajeConflictoProgramacionIntervalo,
  primerConflictoProgramacionIntervalo,
  ventanaProgramacionSegura,
  ventanasProgramacionSeSolapan,
  type VentanaProgramacion,
} from "./disponibilidad-programacion-intervalos";
import type {
  AdvertenciaFilaEdicionRapida,
  CodigoErrorEdicionRapida,
  ErrorFilaEdicionRapida,
  FilaResultadoEdicionRapida,
  ResultadoValidarEdicionRapida,
  ValidarEdicionRapida,
} from "./edicion-rapida-schema";
import {
  evaluarDisponibilidadPersonal,
  evaluarDisponibilidadUnidad,
  personalQueSale,
  resolverCambioTc,
  resolverSeleccionPersonal,
  validarEstadoEditable,
  validarFechaNoPasada,
  validarMotivoCambioRecursos,
  validarRemocionConViaticos,
  type CamposTocados,
  type DisponibilidadPersonalRegla,
  type RecursoPersonalValidar,
  type VehiculoDisponibilidadRegla,
} from "./programacion-validacion-recursos";
import { MSG_PERSONA_DUPLICADA, hayPersonaDuplicada } from "./piloto-extra";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-1: VALIDACIÓN de solo LECTURA del ESTADO FINAL de un lote de cambios de piloto,
 * auxiliares, unidad y TC. NO escribe nada (ni UPDATE/INSERT/DELETE, ni auditoría, ni viáticos, ni tms_personal) y no
 * toma candado: la validación definitiva bajo GET_LOCK + transacción + FOR UPDATE será PR-2.
 *
 * Idea central: los planes del lote se REEMPLAZAN entre sí. Por eso (1) se comparan contra la BD EXCLUYENDO todos los
 * planes del lote y (2) se comparan ENTRE SÍ por su estado FINAL (ventanas por intervalos). Así un intercambio
 * Carlos <-> Juan no falla por el estado viejo, pero sí si las ventanas finales se solapan de verdad.
 */

// Misma definición que planes/route.ts (constante privada de ese módulo; una ruta no puede exportarla).
const SQL_PENDIENTE_CIERRE = `(
  p.estado NOT IN ('Cerrado', 'Cancelado')
  AND EXISTS (SELECT 1 FROM flota_viajes fv WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado')
)`;

/**
 * Lector de BD del núcleo. Sin `conn` (PR-1 /validar) usa el pool: solo lectura, sin transacción ni candado. Con `conn`
 * (PR-2 guardar) lee por la conexión que tiene el candado y la transacción abiertos.
 */
type Lector = (sql: string, params: unknown[]) => Promise<RowDataPacket[]>;
const lectorDe = (conn?: PoolConnection): Lector =>
  conn ? async (sql, params) => (await conn.query<RowDataPacket[]>(sql, params))[0] : (sql, params) => query<RowDataPacket[]>(sql, params as never);

export type PlanBD = {
  id: number; codigo: string; estado: string; fechaPlan: string; horaCarga: string | null; regresoEstimado: string | null;
  tipoViaje: string; pilotoId: number | null; unidadTmsId: number | null; unidadPlaca: string | null; flotaVehiculoId: number | null;
  tcVehiculoId: number | null; pendienteCierre: boolean; auxiliares: { personalId: number; nombre: string }[]; pilotoNombre: string;
  /** Piloto EXTRA (tms_plan_pilotos_adicionales). La edición rápida NO lo modifica: lo conserva y lo tiene en cuenta en las validaciones. */
  pilotoExtraId?: number | null;
  // PR-355: tarifa del catálogo (snapshot en el viaje) y viáticos actuales por tms_personal.id.
  rutaId: number | null; tarifaId: number | null; tarifaComercial: number | null; tarifaNombre: string | null;
  viaticos: { personalId: number; montoAsignado: number; montoSugerido: number; estado: string }[];
};
export type TarifaSnapshot = { id: number; nombre: string; monto: number; moneda: string };
/** Estado FINAL de la tarifa de un viaje: catálogo (snapshot), manual (solo tarifa_comercial) o sin tarifa. */
export type TarifaDestino = { tipo: "catalogo"; snap: TarifaSnapshot } | { tipo: "manual"; monto: number } | { tipo: "sin" };

export type Recursos = {
  pilotoId: number | null;
  /** Piloto extra: igual en `actual` y `final` (la edición rápida no lo cambia; solo se considera en duplicados/conflictos). */
  pilotoExtraId?: number | null;
  auxiliaresIds: number[];
  flotaVehiculoId: number | null;
  tcVehiculoId: number | null;
};
export type FilaTrabajo = {
  planId: number; plan: PlanBD | null; errores: ErrorFilaEdicionRapida[]; advertencias: AdvertenciaFilaEdicionRapida[];
  actual: Recursos | null; final: Recursos | null; hayCambios: boolean; fatal: boolean;
  cambiaPiloto: boolean; cambiaAuxiliares: boolean; cambiaUnidad: boolean; cambiaTc: boolean;
  /** `tarifaDestino` undefined = no se toca la tarifa; si no, el estado final ya validado a escribir. */
  cambiaTarifa: boolean; tarifaDestino: TarifaDestino | undefined;
  /** PR-355: solo los montos que REALMENTE cambian (los que el sync de viáticos debe respetar como override). */
  cambiaViaticos: boolean; viaticosOverrides: { personalId: number; montoAsignado: number }[];
};

const err = (fila: FilaTrabajo, codigo: CodigoErrorEdicionRapida, mensaje: string) => { fila.errores.push({ codigo, mensaje }); };
const igualesOrdenados = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const mismoConjunto = (a: number[], b: number[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;
const montoIgual = (a: number, b: number) => Math.abs(a - b) < 0.005;
const hora5 = (h: string | null) => (h ? h.slice(0, 5) : null);
const regresoNorm = (r: string | null) => (r ? r.slice(0, 16).replace(" ", "T") : null);
const placeholders = (n: number) => Array(n).fill("?").join(",");
const fechaDMA = (f: string) => f.split("-").reverse().join("/");
const placaNormalizada = (placa: string | null | undefined) => placa?.trim().toUpperCase() || null;

/** Una placa ambigua conserva identidad por placa: nunca separa dos referencias al mismo vehículo físico. */
function claveUnidadFinal(
  flotaId: number | null, tmsId: number | null, placa: string | null,
  flotaPorPlaca: Map<string, Set<number>>,
): string | null {
  const normalizada = placaNormalizada(placa);
  if (normalizada) {
    const ids = flotaPorPlaca.get(normalizada);
    if (ids?.size === 1) return `u:${ids.values().next().value}`;
    return `placa:${normalizada}`;
  }
  if (flotaId != null) return `u:${flotaId}`;
  return tmsId != null ? `ut:${tmsId}` : null;
}

async function cargarPlanes(leer: Lector, empresaId: number, ids: number[], bloquear: boolean): Promise<Map<number, PlanBD>> {
  const mapa = new Map<number, PlanBD>();
  if (!ids.length) return mapa;
  if (bloquear) {
    // PR-2: relectura final de los planes del lote CON FOR UPDATE (orden por id: sin deadlocks entre dos lotes). Las lecturas
    // siguientes ya ven lo confirmado por quien tenía el candado antes que nosotros.
    await leer(`SELECT id FROM tms_planes_viaje WHERE empresa_id = ? AND id IN (${placeholders(ids.length)}) ORDER BY id FOR UPDATE`, [empresaId, ...ids]);
  }
  const [planes, aux, viaticos, extras] = await Promise.all([
    leer(
      `SELECT p.id, p.codigo, p.estado, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan, p.hora_carga,
              DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado, p.tipo_viaje, p.piloto_id, p.unidad_id,
              u.placa AS unidad_placa, u.flota_vehiculo_id, p.tc_vehiculo_id, pil.nombre AS piloto_nombre,
              p.ruta_id, p.tarifa_id, p.tarifa_comercial, p.tarifa_nombre_historico,
              ${SQL_PENDIENTE_CIERRE} AS pendiente_cierre
       FROM tms_planes_viaje p
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
       WHERE p.empresa_id = ? AND p.id IN (${placeholders(ids.length)})`,
      [empresaId, ...ids],
    ),
    leer(
      `SELECT pa.plan_id, pa.personal_id, per.nombre
       FROM tms_plan_auxiliares pa
       INNER JOIN tms_personal per ON per.id = pa.personal_id AND per.empresa_id = ?
       INNER JOIN tms_planes_viaje p ON p.id = pa.plan_id AND p.empresa_id = per.empresa_id
       WHERE pa.plan_id IN (${placeholders(ids.length)})
       ORDER BY pa.plan_id, pa.orden, pa.id`,
      [empresaId, ...ids],
    ).catch((): RowDataPacket[] => []),
    leer(
      `SELECT plan_id, personal_id, monto_asignado, monto_sugerido, estado FROM tms_viaticos
       WHERE empresa_id = ? AND plan_id IN (${placeholders(ids.length)}) ORDER BY plan_id, personal_id`,
      [empresaId, ...ids],
    ).catch((): RowDataPacket[] => []),
    // Piloto extra de los planes del lote (una consulta; tolera que la tabla aún no exista).
    leer(
      `SELECT plan_id, personal_id FROM tms_plan_pilotos_adicionales WHERE empresa_id = ? AND plan_id IN (${placeholders(ids.length)}) ORDER BY plan_id, orden, id`,
      [empresaId, ...ids],
    ).catch((): RowDataPacket[] => []),
  ]);
  for (const r of planes) {
    const id = Number(r.id);
    mapa.set(id, {
      id, codigo: String(r.codigo), estado: String(r.estado), fechaPlan: String(r.fecha_plan), horaCarga: r.hora_carga ? String(r.hora_carga) : null,
      regresoEstimado: r.regreso_estimado ? String(r.regreso_estimado) : null, tipoViaje: String(r.tipo_viaje ?? "Propio"),
      pilotoId: r.piloto_id != null ? Number(r.piloto_id) : null, unidadTmsId: r.unidad_id != null ? Number(r.unidad_id) : null,
      unidadPlaca: r.unidad_placa ? String(r.unidad_placa).toUpperCase() : null, flotaVehiculoId: r.flota_vehiculo_id != null ? Number(r.flota_vehiculo_id) : null,
      tcVehiculoId: r.tc_vehiculo_id != null ? Number(r.tc_vehiculo_id) : null, pendienteCierre: Number(r.pendiente_cierre) === 1,
      auxiliares: [], pilotoNombre: r.piloto_nombre ? String(r.piloto_nombre) : "",
      rutaId: r.ruta_id != null && Number(r.ruta_id) > 0 ? Number(r.ruta_id) : null, tarifaId: r.tarifa_id != null ? Number(r.tarifa_id) : null,
      tarifaComercial: r.tarifa_comercial != null ? Number(r.tarifa_comercial) : null, tarifaNombre: r.tarifa_nombre_historico ? String(r.tarifa_nombre_historico) : null, viaticos: [],
    });
  }
  for (const v of viaticos) {
    mapa.get(Number(v.plan_id))?.viaticos.push({
      personalId: Number(v.personal_id), montoAsignado: Number(v.monto_asignado ?? 0), montoSugerido: Number(v.monto_sugerido ?? 0), estado: String(v.estado ?? "PROGRAMADO"),
    });
  }
  for (const a of aux) mapa.get(Number(a.plan_id))?.auxiliares.push({ personalId: Number(a.personal_id), nombre: String(a.nombre) });
  for (const x of extras) {
    const plan = mapa.get(Number(x.plan_id));
    if (plan && plan.pilotoExtraId == null) plan.pilotoExtraId = Number(x.personal_id);
  }
  return mapa;
}

type PersonalInfo = { id: number; idEmpleado: number | null; nombre: string };
export type { PersonalInfo };
async function cargarPersonal(leer: Lector, empresaId: number, ids: number[]): Promise<Map<number, PersonalInfo>> {
  const mapa = new Map<number, PersonalInfo>();
  if (!ids.length) return mapa;
  const rows = await leer(
    `SELECT id, id_empleado, nombre FROM tms_personal WHERE empresa_id = ? AND id IN (${placeholders(ids.length)})`,
    [empresaId, ...ids],
  );
  for (const r of rows) mapa.set(Number(r.id), { id: Number(r.id), idEmpleado: r.id_empleado != null ? Number(r.id_empleado) : null, nombre: String(r.nombre) });
  return mapa;
}

/** tms_unidades.id YA existente por placa (SOLO LECTURA: la edición real puede crear la unidad, esta validación nunca). */
async function cargarUnidadesTms(leer: Lector, empresaId: number, placas: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const lista = [...new Set(placas.map((p) => p.toUpperCase()))];
  if (!lista.length) return mapa;
  const rows = await leer(
    `SELECT id, placa FROM tms_unidades WHERE empresa_id = ? AND UPPER(placa) IN (${placeholders(lista.length)})`,
    [empresaId, ...lista],
  );
  for (const r of rows) mapa.set(String(r.placa).toUpperCase(), Number(r.id));
  return mapa;
}

export type ContextoEdicionRapida = {
  /** Personal implicado (actual y final) con su `id_empleado` y nombre (para identidad y auditoría). */
  personal: Map<number, PersonalInfo>;
  /** Placa (mayúsculas) de las unidades NUEVAS por `flota_vehiculos.id`. */
  placaPorFlota: Map<number, string>;
  /** Placa de los TC NUEVOS por `flota_vehiculos.id`. */
  tcPlaca: Map<number, string>;
};
export type EvaluacionEdicionRapida = { resultado: ResultadoValidarEdicionRapida; filas: FilaTrabajo[]; contexto: ContextoEdicionRapida };

/** PR-1 /validar: solo lectura, sin candado ni transacción. */
export async function validarEdicionRapida(empresaId: number, datos: ValidarEdicionRapida): Promise<ResultadoValidarEdicionRapida> {
  return (await evaluarEdicionRapida(empresaId, datos)).resultado;
}

/**
 * Núcleo COMPARTIDO por /validar (PR-1) y guardar (PR-2). Sin `conn`: lectura por el pool. Con `conn`: el llamador ya
 * tiene el candado por empresa y una transacción abiertos; los planes se releen con FOR UPDATE y los conflictos contra
 * BD se leen por esa misma conexión (también FOR UPDATE, como el motor de intervalos). No escribe nunca.
 */
export async function evaluarEdicionRapida(empresaId: number, datos: ValidarEdicionRapida, opciones: { conn?: PoolConnection } = {}): Promise<EvaluacionEdicionRapida> {
  const hoy = hoyLocal();
  const leer = lectorDe(opciones.conn);
  const planIdsLote = datos.cambios.map((c) => c.planId);
  const planes = await cargarPlanes(leer, empresaId, planIdsLote, opciones.conn != null);
  const motivo = datos.motivoCambio?.trim() || undefined;

  const filas: FilaTrabajo[] = datos.cambios.map((c) => ({
    planId: c.planId, plan: planes.get(c.planId) ?? null, errores: [], advertencias: [], actual: null, final: null,
    hayCambios: false, fatal: false, cambiaPiloto: false, cambiaAuxiliares: false, cambiaUnidad: false, cambiaTc: false,
    cambiaTarifa: false, tarifaDestino: undefined, cambiaViaticos: false, viaticosOverrides: [],
  }));

  // ---------------------------------------------------------------- 1) existencia + snapshot esperado + cambios reales
  for (const fila of filas) {
    const c = datos.cambios.find((x) => x.planId === fila.planId)!;
    const plan = fila.plan;
    if (!plan) {
      err(fila, "PLAN_NO_ENCONTRADO", "El viaje no existe en esta empresa."); // también cubre un plan de OTRA empresa
      fila.fatal = true;
      continue;
    }
    const auxActual = plan.auxiliares.map((a) => a.personalId);
    fila.actual = { pilotoId: plan.pilotoId, pilotoExtraId: plan.pilotoExtraId ?? null, auxiliaresIds: auxActual, flotaVehiculoId: plan.flotaVehiculoId, tcVehiculoId: plan.tcVehiculoId };
    fila.final = { pilotoId: c.nuevo.pilotoPersonalId, pilotoExtraId: plan.pilotoExtraId ?? null, auxiliaresIds: c.nuevo.auxiliarPersonalIds, flotaVehiculoId: c.nuevo.flotaVehiculoId, tcVehiculoId: c.nuevo.tcVehiculoId };

    const dif: string[] = [];
    const e = c.esperado;
    if (e.estado !== plan.estado) dif.push(`estado (${plan.estado})`);
    if (e.fechaPlan !== plan.fechaPlan) dif.push(`fecha (${fechaDMA(plan.fechaPlan)})`);
    if (hora5(e.horaCarga) !== hora5(plan.horaCarga)) dif.push("hora de carga");
    if (regresoNorm(e.regresoEstimado) !== regresoNorm(plan.regresoEstimado)) dif.push("regreso estimado");
    if (e.pilotoPersonalId !== plan.pilotoId) dif.push("piloto");
    if (!mismoConjunto(e.auxiliarPersonalIds, auxActual)) dif.push("auxiliares");
    if (e.flotaVehiculoId !== plan.flotaVehiculoId) dif.push("unidad");
    if (e.tcVehiculoId !== plan.tcVehiculoId) dif.push("TC");
    // PR-355: tarifa y viáticos se comparan solo si el cliente los mandó (retrocompatible con clientes anteriores).
    if (e.tarifaId !== undefined && e.tarifaId !== plan.tarifaId) dif.push("tarifa");
    else if (e.tarifaComercial !== undefined && (e.tarifaComercial === null) !== (plan.tarifaComercial === null)) dif.push("tarifa");
    else if (e.tarifaComercial != null && plan.tarifaComercial != null && !montoIgual(e.tarifaComercial, plan.tarifaComercial)) dif.push("tarifa");
    if (e.viaticos !== undefined) {
      const a = [...e.viaticos].sort((x, y) => x.personalId - y.personalId);
      const b = [...plan.viaticos].sort((x, y) => x.personalId - y.personalId);
      const igual = a.length === b.length && a.every((v, i) => v.personalId === b[i].personalId && v.estado === b[i].estado && montoIgual(v.montoAsignado, b[i].montoAsignado));
      if (!igual) dif.push("viáticos");
    }
    if (dif.length) {
      err(fila, "PLAN_DESACTUALIZADO", `El viaje ${plan.codigo} cambió mientras lo editabas (${dif.join(", ")}). Recarga la programación.`);
      fila.fatal = true;
      fila.final = fila.actual; // su asignación real sigue siendo la de la BD
      continue;
    }
    fila.cambiaPiloto = fila.final.pilotoId !== fila.actual.pilotoId;
    fila.cambiaAuxiliares = !igualesOrdenados(fila.final.auxiliaresIds, fila.actual.auxiliaresIds); // el orden define al principal
    fila.cambiaUnidad = fila.final.flotaVehiculoId !== fila.actual.flotaVehiculoId;
    fila.cambiaTc = fila.final.tcVehiculoId !== fila.actual.tcVehiculoId;
    if (c.nuevo.tarifaId !== undefined) {
      if (c.nuevo.tarifaId != null) fila.cambiaTarifa = c.nuevo.tarifaId !== plan.tarifaId; // catálogo: misma tarifa = sin cambio
      else if (c.nuevo.tarifaComercial != null) {
        // manual: cambia si hoy hay tarifa de catálogo, no hay monto, o el monto es distinto (un monto negativo o con más de 2 decimales se marca como cambio para rechazarlo abajo)
        fila.cambiaTarifa = plan.tarifaId != null || plan.tarifaComercial == null || c.nuevo.tarifaComercial < 0 || Math.abs(c.nuevo.tarifaComercial * 100 - Math.round(c.nuevo.tarifaComercial * 100)) > 1e-6 || !montoIgual(c.nuevo.tarifaComercial, plan.tarifaComercial);
      } else fila.cambiaTarifa = plan.tarifaId != null || plan.tarifaComercial != null; // sin tarifa
    }
    if (c.nuevo.viaticos !== undefined) {
      const porPersona = new Map(plan.viaticos.map((v) => [v.personalId, v]));
      fila.viaticosOverrides = c.nuevo.viaticos.filter((v) => { const ex = porPersona.get(v.personalId); return !ex || !montoIgual(ex.montoAsignado, v.montoAsignado); });
      fila.cambiaViaticos = fila.viaticosOverrides.length > 0;
    }
    fila.hayCambios = fila.cambiaPiloto || fila.cambiaAuxiliares || fila.cambiaUnidad || fila.cambiaTc || fila.cambiaTarifa || fila.cambiaViaticos;
  }

  // ---------------------------------------------------------------- 2) reglas por fila (mismos helpers que el PATCH)
  const sinCambios = (f: FilaTrabajo) => !f.fatal && !f.hayCambios;
  const candidatas = filas.filter((f) => !f.fatal && f.hayCambios);
  const tocaDe = (f: FilaTrabajo): CamposTocados => ({ piloto: f.cambiaPiloto, pilotoExtra: false, auxiliares: f.cambiaAuxiliares, unidad: f.cambiaUnidad, fecha: false, paradas: false, hora: false, comercial: f.cambiaTarifa || f.cambiaViaticos });

  for (const fila of candidatas) {
    const plan = fila.plan!;
    const toca = tocaDe(fila);
    const eMotivo = validarMotivoCambioRecursos(toca, motivo);
    if (eMotivo) err(fila, "MOTIVO_REQUERIDO", eMotivo.error);
    else if (fila.cambiaViaticos && !motivo) err(fila, "MOTIVO_REQUERIDO", "Indica el motivo del cambio de viáticos.");
    const eEstado = validarEstadoEditable({ estado: plan.estado, pendienteCierre: plan.pendienteCierre }, toca);
    if (eEstado) { err(fila, "ESTADO_NO_EDITABLE", eEstado.error); fila.fatal = true; continue; }
    const eFecha = validarFechaNoPasada(plan.fechaPlan, hoy);
    if (eFecha) { err(fila, "FECHA_PASADA", eFecha.error); fila.fatal = true; continue; }
    // La tarifa SÍ es editable en un viaje tercerizado; recursos internos y viáticos no.
    if (plan.tipoViaje === "Tercerizado" && (fila.cambiaPiloto || fila.cambiaAuxiliares || fila.cambiaUnidad || fila.cambiaTc || fila.cambiaViaticos)) {
      err(fila, "TERCERIZADO_SIN_RECURSOS_INTERNOS", "Un viaje tercerizado no usa piloto, auxiliares, unidad, TC ni viáticos internos.");
      fila.fatal = true;
      continue;
    }
    // Tarifa final. Catálogo: debe ser vigente y de la ruta del viaje (misma empresa), nunca se inventa. Manual: monto >= 0 con
    // máximo 2 decimales (NO crea filas en tms_ruta_tarifas). Sin tarifa: todo NULL (nunca 0).
    if (fila.cambiaTarifa) {
      const n = datos.cambios.find((x) => x.planId === fila.planId)!.nuevo;
      if (n.tarifaId != null) {
        const snap = plan.rutaId != null ? await tarifaParaSnapshot(empresaId, plan.rutaId, n.tarifaId, opciones.conn) : null;
        if (!snap) err(fila, "TARIFA_INVALIDA", "La tarifa seleccionada no es una tarifa vigente de la ruta de este viaje.");
        else fila.tarifaDestino = { tipo: "catalogo", snap };
      } else if (n.tarifaComercial != null) {
        const m = n.tarifaComercial;
        if (!Number.isFinite(m) || m < 0) err(fila, "TARIFA_INVALIDA", "El monto de la tarifa manual debe ser un número mayor o igual a 0.");
        else if (Math.abs(m * 100 - Math.round(m * 100)) > 1e-6) err(fila, "TARIFA_INVALIDA", "El monto de la tarifa manual admite máximo 2 decimales.");
        else if (m > 9999999999.99) err(fila, "TARIFA_INVALIDA", "El monto de la tarifa manual es demasiado grande.");
        else fila.tarifaDestino = { tipo: "manual", monto: Math.round(m * 100) / 100 };
      } else fila.tarifaDestino = { tipo: "sin" };
    }
  }
  // una fila con error fatal aporta su asignación ACTUAL (nada cambia en ella) al estado final del lote
  for (const f of filas) if (f.fatal && f.actual) f.final = f.actual;

  const activas = candidatas.filter((f) => !f.fatal);

  // Personal: ids exactos válidos (SOLO LECTURA: resolverSeleccionPersonal en modo "lectura" nunca inserta ni actualiza).
  const todosPersonalIds = new Set<number>();
  for (const f of filas) if (f.actual && f.final) for (const r of [f.actual, f.final]) { if (r.pilotoId != null) todosPersonalIds.add(r.pilotoId); r.auxiliaresIds.forEach((x) => todosPersonalIds.add(x)); }
  for (const fila of activas) {
    const r = await resolverSeleccionPersonal(empresaId, {
      pilotoPersonalId: fila.cambiaPiloto && fila.final!.pilotoId != null ? fila.final!.pilotoId : undefined,
      auxiliarPersonalIds: fila.cambiaAuxiliares ? fila.final!.auxiliaresIds : undefined,
    }, "lectura");
    if (!r.ok) { err(fila, "PERSONAL_INVALIDO", r.error); fila.fatal = true; }
    const rep = fila.final!.pilotoId != null && fila.final!.auxiliaresIds.includes(fila.final!.pilotoId);
    if (!fila.fatal && rep) { err(fila, "PERSONAL_INVALIDO", "El piloto no puede ser también auxiliar del mismo viaje."); fila.fatal = true; }
    // Piloto extra (no editable aquí): el nuevo principal o los nuevos auxiliares no pueden coincidir con él.
    if (!fila.fatal && hayPersonaDuplicada(fila.final!.pilotoId, fila.final!.pilotoExtraId ?? null, fila.final!.auxiliaresIds)) {
      err(fila, "PERSONAL_INVALIDO", MSG_PERSONA_DUPLICADA); fila.fatal = true;
    }
  }
  const personal = await cargarPersonal(leer, empresaId, [...todosPersonalIds]);
  const claveDe = (personalId: number) => { const p = personal.get(personalId); return p?.idEmpleado != null ? `e:${p.idEmpleado}` : `p:${personalId}`; };
  const nombreDe = (personalId: number) => personal.get(personalId)?.nombre ?? `#${personalId}`;

  // Disponibilidad de personal (incidencia bloqueante, baja, viaje en curso HOY) por fecha: una consulta por fecha distinta.
  const idsLote = new Set(planIdsLote);
  const porFecha = new Map<string, FilaTrabajo[]>();
  for (const f of activas.filter((x) => !x.fatal)) porFecha.set(f.plan!.fechaPlan, [...(porFecha.get(f.plan!.fechaPlan) ?? []), f]);
  for (const [fecha, grupo] of porFecha) {
    let disp: DisponibilidadPersonalRegla[] = [];
    if (grupo.some((f) => f.cambiaPiloto || f.cambiaAuxiliares)) {
      disp = (await listarDisponibilidadPersonal(empresaId, fecha)) as unknown as DisponibilidadPersonalRegla[];
      // otros planes del día que están DENTRO del lote se reemplazan: no se advierte contra ellos (como el PATCH con su propio plan)
      disp = disp.map((d) => ({ ...d, otrosPlanesDelDia: d.otrosPlanesDelDia.filter((o) => !idsLote.has(o.planId)) }));
    }
    for (const fila of grupo) {
      // La fecha no cambia en la edición rápida: solo se revalida el recurso que REALMENTE cambia (quitar = null: nada que validar).
      const recursos: RecursoPersonalValidar[] = [];
      if (fila.cambiaPiloto && fila.final!.pilotoId != null) recursos.push({ personalId: fila.final!.pilotoId, rol: "piloto" });
      if (fila.cambiaAuxiliares) for (const pid of fila.final!.auxiliaresIds) recursos.push({ personalId: pid, rol: "auxiliar" });
      if (recursos.length) {
        const ev = evaluarDisponibilidadPersonal(disp, recursos, { fechaEfectiva: fecha, esHoy: fecha === hoy, planId: fila.planId });
        fila.advertencias.push(...ev.advertencias);
        if (ev.error) err(fila, "PERSONAL_NO_DISPONIBLE", ev.error.error);
      }
      // aviso informativo (nunca bloquea): viático RECHAZADO de esta misma persona en este viaje
      const nuevos = personalRecienAsignadoDelPlan({
        pilotoCambioReal: fila.cambiaPiloto, pilotoFinal: fila.final!.pilotoId, auxiliaresCambioReal: fila.cambiaAuxiliares,
        auxiliaresFinal: fila.final!.auxiliaresIds, antesAuxiliaresIds: fila.actual!.auxiliaresIds,
      });
      for (const rz of await listarViaticosRechazadosDelPlan(empresaId, fila.planId, nuevos)) {
        fila.advertencias.push({ tipo: "viatico_rechazado_mismo_plan", mensaje: `${rz.nombre || nombreDe(rz.personalId)} ya tiene un viático rechazado para este viaje. No se generará una nueva solicitud de viático para este mismo viaje.${rz.motivoRechazo ? ` Motivo del rechazo: ${rz.motivoRechazo}` : ""}` });
      }
    }
  }

  // PR-355: viáticos editados. La persona debe estar en el estado FINAL del viaje y un viático ya procesado no se toca.
  for (const fila of filas.filter((x) => x.cambiaViaticos && !x.fatal)) {
    const finalIds = new Set([...(fila.final!.pilotoId != null ? [fila.final!.pilotoId] : []), ...(fila.final!.pilotoExtraId != null ? [fila.final!.pilotoExtraId] : []), ...fila.final!.auxiliaresIds]);
    const existentes = new Map(fila.plan!.viaticos.map((v) => [v.personalId, v]));
    for (const ov of fila.viaticosOverrides) {
      const ex = existentes.get(ov.personalId);
      if (!finalIds.has(ov.personalId)) err(fila, "VIATICO_INVALIDO", `El viático de #${ov.personalId} no se puede editar: esa persona no queda asignada al viaje.`);
      else if (ex && ex.estado !== "PROGRAMADO") err(fila, "VIATICO_PROCESADO", `El viático de esa persona ya está ${ex.estado.toLowerCase()} y no se puede modificar desde Programación.`);
    }
  }

  // Viáticos ya procesados impiden retirar a alguien del viaje (solo lectura).
  for (const fila of activas.filter((x) => (x.cambiaPiloto || x.cambiaAuxiliares))) {
    const plan = fila.plan!;
    const removidos = personalQueSale(
      { pilotoId: plan.pilotoId, piloto: plan.pilotoNombre, pilotoExtraId: plan.pilotoExtraId ?? null, auxiliaresIds: plan.auxiliares.map((a) => a.personalId), auxiliaresNombres: plan.auxiliares.map((a) => a.nombre) },
      { pilotoId: fila.final!.pilotoId, pilotoExtraId: fila.final!.pilotoExtraId ?? null, auxiliaresIds: fila.final!.auxiliaresIds },
    );
    const ev = await validarRemocionConViaticos(fila.planId, removidos);
    if (ev) err(fila, "VIATICO_PROCESADO", ev.error);
  }

  // Unidad: existe/es accesible, no es TC, no inactiva, taller/en ruta (bloquean solo HOY).
  const unidadesNuevas = activas.filter((f) => f.cambiaUnidad && f.final!.flotaVehiculoId != null);
  let vehiculos: VehiculoDisponibilidadRegla[] = [];
  const placaPorFlota = new Map<number, string>();
  const hayUnidadHeredada = filas.some((f) => f.plan?.unidadTmsId != null && f.plan.flotaVehiculoId == null && !f.cambiaUnidad);
  if (unidadesNuevas.length || hayUnidadHeredada) {
    vehiculos = ((await listarDisponibilidadVehiculos(empresaId)).vehiculos as unknown) as VehiculoDisponibilidadRegla[];
  }
  if (unidadesNuevas.length) {
    for (const fila of unidadesNuevas) {
      const fid = fila.final!.flotaVehiculoId!;
      const acc = await obtenerVehiculoAccesible(empresaId, fid);
      if (!acc) { err(fila, "UNIDAD_INVALIDA", "La unidad seleccionada no existe o no es accesible para esta empresa."); fila.fatal = true; continue; }
      placaPorFlota.set(fid, String(acc.placa).toUpperCase());
      const ev = evaluarDisponibilidadUnidad(vehiculos, fid, true, { fechaEfectiva: fila.plan!.fechaPlan, esHoy: fila.plan!.fechaPlan === hoy });
      fila.advertencias.push(...ev.advertencias);
      if (ev.error) err(fila, "UNIDAD_INVALIDA", ev.error.error);
    }
  }

  // TC: existe, es TC, activo y fuera de taller (el mismo TC no se re-valida, como el PATCH).
  const tcPlaca = new Map<number, string>();
  for (const fila of activas.filter((f) => f.cambiaTc)) {
    const r = await resolverCambioTc(empresaId, { tipoViaje: fila.plan!.tipoViaje, tcVehiculoId: fila.actual!.tcVehiculoId }, { tcVehiculoId: fila.final!.tcVehiculoId });
    if (!r.ok) { err(fila, "TC_INVALIDO", r.error); continue; }
    if (r.tcVehiculoIdNuevo != null && r.tcPlacaNueva) tcPlaca.set(r.tcVehiculoIdNuevo, r.tcPlacaNueva);
  }

  // ---------------------------------------------------------------- 3) contra la BD, EXCLUYENDO todos los planes del lote
  const unidadesTms = await cargarUnidadesTms(leer, empresaId, [...placaPorFlota.values()]);
  const ventanaDe = (f: FilaTrabajo): VentanaProgramacion =>
    ventanaProgramacionSegura({ fechaPlan: f.plan!.fechaPlan, horaCarga: f.plan!.horaCarga, regresoEstimado: f.plan!.regresoEstimado });
  for (const fila of activas.filter((x) => !x.fatal)) {
    if (fila.errores.length) continue; // con errores de reglas no se consulta conflicto
    const recursos: RecursoDia[] = [];
    if (fila.cambiaPiloto && fila.final!.pilotoId != null) recursos.push({ tipo: "piloto", id: fila.final!.pilotoId });
    const auxAntes = new Set(fila.actual!.auxiliaresIds);
    for (const a of fila.final!.auxiliaresIds) if (!auxAntes.has(a)) recursos.push({ tipo: "auxiliar", id: a });
    if (fila.cambiaUnidad && fila.final!.flotaVehiculoId != null) {
      const tmsId = unidadesTms.get(placaPorFlota.get(fila.final!.flotaVehiculoId) ?? "");
      if (tmsId != null) recursos.push({ tipo: "unidad", id: tmsId }); // sin fila en tms_unidades: ningún plan puede usarla
    }
    if (fila.cambiaTc && fila.final!.tcVehiculoId != null) recursos.push({ tipo: "tc", id: fila.final!.tcVehiculoId });
    if (!recursos.length) continue;
    // Excluye TODOS los planes del lote (no solo el propio): su estado final se compara aparte, en el paso 4.
    const conflicto = await primerConflictoProgramacionIntervalo(empresaId, recursos, ventanaDe(fila), planIdsLote, opciones.conn);
    if (conflicto) err(fila, "RECURSO_OCUPADO_BD", mensajeConflictoProgramacionIntervalo(conflicto));
  }

  // ---------------------------------------------------------------- 4) ESTADO FINAL del lote: las filas se comparan entre sí
  // Una fila inválida (personal/unidad inexistente, etc.) no reasigna nada: aporta su asignación ACTUAL.
  for (const f of filas) {
    if (f.fatal && f.actual) { f.final = f.actual; f.cambiaPiloto = f.cambiaAuxiliares = f.cambiaUnidad = f.cambiaTc = false; f.cambiaTarifa = f.cambiaViaticos = false; f.tarifaDestino = undefined; f.viaticosOverrides = []; }
  }
  type Uso = { fila: FilaTrabajo; cambiado: boolean };
  const claves = new Map<string, { etiqueta: string; usos: Uso[] }>();
  const flotaPorPlaca = new Map<string, Set<number>>();
  const registrarFlota = (id: number, placa: string | null | undefined) => {
    const normalizada = placaNormalizada(placa);
    if (!normalizada) return;
    const ids = flotaPorPlaca.get(normalizada) ?? new Set<number>();
    ids.add(id);
    flotaPorPlaca.set(normalizada, ids);
  };
  for (const vehiculo of vehiculos) registrarFlota(vehiculo.id, vehiculo.placa);
  for (const [id, placa] of placaPorFlota) registrarFlota(id, placa);
  for (const f of filas) if (f.plan?.flotaVehiculoId != null) registrarFlota(f.plan.flotaVehiculoId, f.plan.unidadPlaca);
  const anotar = (clave: string, etiqueta: string, fila: FilaTrabajo, cambiado: boolean) => {
    const e = claves.get(clave) ?? { etiqueta, usos: [] };
    if (!e.usos.some((u) => u.fila === fila)) e.usos.push({ fila, cambiado });
    claves.set(clave, e);
  };
  for (const f of filas) {
    if (!f.plan || !f.final || !f.actual) continue;
    if (f.plan.tipoViaje === "Tercerizado") continue; // Tercerizado no consume recursos internos
    const antesPersonas = new Set([...(f.actual.pilotoId != null ? [claveDe(f.actual.pilotoId)] : []), ...(f.actual.pilotoExtraId != null ? [claveDe(f.actual.pilotoExtraId)] : []), ...f.actual.auxiliaresIds.map(claveDe)]);
    // El piloto extra cuenta como persona del viaje (ocupa el mismo intervalo que el principal) aunque esta edición no lo cambie.
    const personasFinal = [...(f.final.pilotoId != null ? [f.final.pilotoId] : []), ...(f.final.pilotoExtraId != null ? [f.final.pilotoExtraId] : []), ...f.final.auxiliaresIds];
    for (const pid of personasFinal) anotar(claveDe(pid), nombreDe(pid), f, !antesPersonas.has(claveDe(pid)));
    const fid = f.final.flotaVehiculoId;
    const placa = f.cambiaUnidad && fid != null ? placaPorFlota.get(fid) ?? null : f.plan.unidadPlaca;
    const unidadClave = claveUnidadFinal(fid, f.cambiaUnidad ? null : f.plan.unidadTmsId, placa, flotaPorPlaca);
    if (unidadClave) anotar(unidadClave, `La unidad ${placa ?? (fid != null ? `#${fid}` : `#${f.plan.unidadTmsId}`)}`, f, f.cambiaUnidad);
    const tid = f.final.tcVehiculoId;
    if (tid != null) anotar(`tc:${tid}`, `El TC ${tcPlaca.get(tid) ?? `#${tid}`}`, f, f.cambiaTc);
  }
  // Un recurso repetido por dos filas es conflicto SOLO si sus ventanas finales se solapan (intervalos semiabiertos).
  for (const { etiqueta, usos } of claves.values()) {
    if (usos.length < 2) continue;
    for (let i = 0; i < usos.length; i++) {
      for (let j = i + 1; j < usos.length; j++) {
        const a = usos[i], b = usos[j];
        if (!ventanasProgramacionSeSolapan(ventanaDe(a.fila), ventanaDe(b.fila))) continue;
        const marcar = (uso: Uso, otro: Uso) => {
          if (!uso.cambiado) return; // una fila sin ese cambio no se marca (el conflicto es de quien lo asigna)
          const verbo = etiqueta.startsWith("La ") ? "queda asignada" : etiqueta.startsWith("El ") ? "queda asignado" : "queda asignado";
          err(uso.fila, "RECURSO_OCUPADO_LOTE", `${etiqueta} ${verbo} también en el viaje ${otro.fila.plan!.codigo} de este mismo lote con horarios que se solapan.`);
        };
        marcar(a, b);
        marcar(b, a);
      }
    }
  }

  // ---------------------------------------------------------------- 5) respuesta
  const resultado: FilaResultadoEdicionRapida[] = filas.map((f) => ({
    planId: f.planId,
    estado: f.errores.length ? "error" : sinCambios(f) ? "sin_cambios" : "ok",
    errores: f.errores,
    advertencias: f.advertencias,
  }));
  return { resultado: { ok: resultado.every((f) => f.estado !== "error"), filas: resultado }, filas, contexto: { personal, placaPorFlota, tcPlaca } };
}
