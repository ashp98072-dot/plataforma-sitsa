import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { hoyLocal } from "@/lib/rrhh/dates";
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

type PlanBD = {
  id: number; codigo: string; estado: string; fechaPlan: string; horaCarga: string | null; regresoEstimado: string | null;
  tipoViaje: string; pilotoId: number | null; unidadTmsId: number | null; unidadPlaca: string | null; flotaVehiculoId: number | null;
  tcVehiculoId: number | null; pendienteCierre: boolean; auxiliares: { personalId: number; nombre: string }[]; pilotoNombre: string;
};

type Recursos = { pilotoId: number | null; auxiliaresIds: number[]; flotaVehiculoId: number | null; tcVehiculoId: number | null };
type FilaTrabajo = {
  planId: number; plan: PlanBD | null; errores: ErrorFilaEdicionRapida[]; advertencias: AdvertenciaFilaEdicionRapida[];
  actual: Recursos | null; final: Recursos | null; hayCambios: boolean; fatal: boolean;
  cambiaPiloto: boolean; cambiaAuxiliares: boolean; cambiaUnidad: boolean; cambiaTc: boolean;
};

const err = (fila: FilaTrabajo, codigo: CodigoErrorEdicionRapida, mensaje: string) => { fila.errores.push({ codigo, mensaje }); };
const igualesOrdenados = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const mismoConjunto = (a: number[], b: number[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;
const hora5 = (h: string | null) => (h ? h.slice(0, 5) : null);
const regresoNorm = (r: string | null) => (r ? r.slice(0, 16).replace(" ", "T") : null);
const placeholders = (n: number) => Array(n).fill("?").join(",");
const fechaDMA = (f: string) => f.split("-").reverse().join("/");

async function cargarPlanes(empresaId: number, ids: number[]): Promise<Map<number, PlanBD>> {
  const mapa = new Map<number, PlanBD>();
  if (!ids.length) return mapa;
  const [planes, aux] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, p.estado, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan, p.hora_carga,
              DATE_FORMAT(p.regreso_estimado, '%Y-%m-%d %H:%i:%s') AS regreso_estimado, p.tipo_viaje, p.piloto_id, p.unidad_id,
              u.placa AS unidad_placa, u.flota_vehiculo_id, p.tc_vehiculo_id, pil.nombre AS piloto_nombre,
              ${SQL_PENDIENTE_CIERRE} AS pendiente_cierre
       FROM tms_planes_viaje p
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
       WHERE p.empresa_id = ? AND p.id IN (${placeholders(ids.length)})`,
      [empresaId, ...ids],
    ),
    query<RowDataPacket[]>(
      `SELECT pa.plan_id, pa.personal_id, per.nombre
       FROM tms_plan_auxiliares pa
       INNER JOIN tms_personal per ON per.id = pa.personal_id AND per.empresa_id = ?
       INNER JOIN tms_planes_viaje p ON p.id = pa.plan_id AND p.empresa_id = per.empresa_id
       WHERE pa.plan_id IN (${placeholders(ids.length)})
       ORDER BY pa.plan_id, pa.orden, pa.id`,
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
    });
  }
  for (const a of aux) mapa.get(Number(a.plan_id))?.auxiliares.push({ personalId: Number(a.personal_id), nombre: String(a.nombre) });
  return mapa;
}

type PersonalInfo = { id: number; idEmpleado: number | null; nombre: string };
async function cargarPersonal(empresaId: number, ids: number[]): Promise<Map<number, PersonalInfo>> {
  const mapa = new Map<number, PersonalInfo>();
  if (!ids.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, id_empleado, nombre FROM tms_personal WHERE empresa_id = ? AND id IN (${placeholders(ids.length)})`,
    [empresaId, ...ids],
  );
  for (const r of rows) mapa.set(Number(r.id), { id: Number(r.id), idEmpleado: r.id_empleado != null ? Number(r.id_empleado) : null, nombre: String(r.nombre) });
  return mapa;
}

/** tms_unidades.id YA existente por placa (SOLO LECTURA: la edición real puede crear la unidad, esta validación nunca). */
async function cargarUnidadesTms(empresaId: number, placas: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const lista = [...new Set(placas.map((p) => p.toUpperCase()))];
  if (!lista.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, placa FROM tms_unidades WHERE empresa_id = ? AND UPPER(placa) IN (${placeholders(lista.length)})`,
    [empresaId, ...lista],
  );
  for (const r of rows) mapa.set(String(r.placa).toUpperCase(), Number(r.id));
  return mapa;
}

export async function validarEdicionRapida(empresaId: number, datos: ValidarEdicionRapida): Promise<ResultadoValidarEdicionRapida> {
  const hoy = hoyLocal();
  const planIdsLote = datos.cambios.map((c) => c.planId);
  const planes = await cargarPlanes(empresaId, planIdsLote);
  const motivo = datos.motivoCambio?.trim() || undefined;

  const filas: FilaTrabajo[] = datos.cambios.map((c) => ({
    planId: c.planId, plan: planes.get(c.planId) ?? null, errores: [], advertencias: [], actual: null, final: null,
    hayCambios: false, fatal: false, cambiaPiloto: false, cambiaAuxiliares: false, cambiaUnidad: false, cambiaTc: false,
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
    fila.actual = { pilotoId: plan.pilotoId, auxiliaresIds: auxActual, flotaVehiculoId: plan.flotaVehiculoId, tcVehiculoId: plan.tcVehiculoId };
    fila.final = { pilotoId: c.nuevo.pilotoPersonalId, auxiliaresIds: c.nuevo.auxiliarPersonalIds, flotaVehiculoId: c.nuevo.flotaVehiculoId, tcVehiculoId: c.nuevo.tcVehiculoId };

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
    fila.hayCambios = fila.cambiaPiloto || fila.cambiaAuxiliares || fila.cambiaUnidad || fila.cambiaTc;
  }

  // ---------------------------------------------------------------- 2) reglas por fila (mismos helpers que el PATCH)
  const sinCambios = (f: FilaTrabajo) => !f.fatal && !f.hayCambios;
  const candidatas = filas.filter((f) => !f.fatal && f.hayCambios);
  const tocaDe = (f: FilaTrabajo): CamposTocados => ({ piloto: f.cambiaPiloto, auxiliares: f.cambiaAuxiliares, unidad: f.cambiaUnidad, fecha: false, paradas: false, hora: false, comercial: false });

  for (const fila of candidatas) {
    const plan = fila.plan!;
    const toca = tocaDe(fila);
    const eMotivo = validarMotivoCambioRecursos(toca, motivo);
    if (eMotivo) err(fila, "MOTIVO_REQUERIDO", eMotivo.error);
    const eEstado = validarEstadoEditable({ estado: plan.estado, pendienteCierre: plan.pendienteCierre }, toca);
    if (eEstado) { err(fila, "ESTADO_NO_EDITABLE", eEstado.error); fila.fatal = true; continue; }
    const eFecha = validarFechaNoPasada(plan.fechaPlan, hoy);
    if (eFecha) { err(fila, "FECHA_PASADA", eFecha.error); fila.fatal = true; continue; }
    if (plan.tipoViaje === "Tercerizado") {
      err(fila, "TERCERIZADO_SIN_RECURSOS_INTERNOS", "Un viaje tercerizado no usa piloto, auxiliares, unidad ni TC internos.");
      fila.fatal = true;
      continue;
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
  }
  const personal = await cargarPersonal(empresaId, [...todosPersonalIds]);
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

  // Viáticos ya procesados impiden retirar a alguien del viaje (solo lectura).
  for (const fila of activas.filter((x) => (x.cambiaPiloto || x.cambiaAuxiliares))) {
    const plan = fila.plan!;
    const removidos = personalQueSale(
      { pilotoId: plan.pilotoId, piloto: plan.pilotoNombre, auxiliaresIds: plan.auxiliares.map((a) => a.personalId), auxiliaresNombres: plan.auxiliares.map((a) => a.nombre) },
      { pilotoId: fila.final!.pilotoId, auxiliaresIds: fila.final!.auxiliaresIds },
    );
    const ev = await validarRemocionConViaticos(fila.planId, removidos);
    if (ev) err(fila, "VIATICO_PROCESADO", ev.error);
  }

  // Unidad: existe/es accesible, no es TC, no inactiva, taller/en ruta (bloquean solo HOY).
  const unidadesNuevas = activas.filter((f) => f.cambiaUnidad && f.final!.flotaVehiculoId != null);
  let vehiculos: VehiculoDisponibilidadRegla[] = [];
  const placaPorFlota = new Map<number, string>();
  if (unidadesNuevas.length) {
    vehiculos = ((await listarDisponibilidadVehiculos(empresaId)).vehiculos as unknown) as VehiculoDisponibilidadRegla[];
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
  const unidadesTms = await cargarUnidadesTms(empresaId, [...placaPorFlota.values()]);
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
    const conflicto = await primerConflictoProgramacionIntervalo(empresaId, recursos, ventanaDe(fila), planIdsLote);
    if (conflicto) err(fila, "RECURSO_OCUPADO_BD", mensajeConflictoProgramacionIntervalo(conflicto));
  }

  // ---------------------------------------------------------------- 4) ESTADO FINAL del lote: las filas se comparan entre sí
  // Una fila inválida (personal/unidad inexistente, etc.) no reasigna nada: aporta su asignación ACTUAL.
  for (const f of filas) {
    if (f.fatal && f.actual) { f.final = f.actual; f.cambiaPiloto = f.cambiaAuxiliares = f.cambiaUnidad = f.cambiaTc = false; }
  }
  type Uso = { fila: FilaTrabajo; cambiado: boolean };
  const claves = new Map<string, { etiqueta: string; usos: Uso[] }>();
  const anotar = (clave: string, etiqueta: string, fila: FilaTrabajo, cambiado: boolean) => {
    const e = claves.get(clave) ?? { etiqueta, usos: [] };
    if (!e.usos.some((u) => u.fila === fila)) e.usos.push({ fila, cambiado });
    claves.set(clave, e);
  };
  for (const f of filas) {
    if (!f.plan || !f.final || !f.actual) continue;
    if (f.plan.tipoViaje === "Tercerizado") continue; // Tercerizado no consume recursos internos
    const antesPersonas = new Set([...(f.actual.pilotoId != null ? [claveDe(f.actual.pilotoId)] : []), ...f.actual.auxiliaresIds.map(claveDe)]);
    const personasFinal = [...(f.final.pilotoId != null ? [f.final.pilotoId] : []), ...f.final.auxiliaresIds];
    for (const pid of personasFinal) anotar(claveDe(pid), nombreDe(pid), f, !antesPersonas.has(claveDe(pid)));
    const fid = f.final.flotaVehiculoId;
    if (fid != null) anotar(`u:${fid}`, `La unidad ${placaPorFlota.get(fid) ?? f.plan.unidadPlaca ?? `#${fid}`}`, f, f.cambiaUnidad);
    else if (f.plan.unidadTmsId != null && !f.cambiaUnidad) anotar(`ut:${f.plan.unidadTmsId}`, `La unidad ${f.plan.unidadPlaca ?? `#${f.plan.unidadTmsId}`}`, f, false);
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
  return { ok: resultado.every((f) => f.estado !== "error"), filas: resultado };
}
