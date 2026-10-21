import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { getPool, query } from "@/lib/db";
import { toIsoDate } from "./dates";
import { obtenerFeriadosEnRango } from "./vacaciones";
import { analizarTraslapes } from "./vacaciones-periodos";
import { obtenerPoliticaConConsulta } from "./vacaciones-modo-db";
import type { PoliticaVacaciones } from "./vacaciones-politica";
import { bloqueosDeDetalle, cargarHechos, reemplazarSerieEnConexion, type Consulta, type Hechos } from "./vacaciones-rebase-db";
import { diagnosticarSerie, planificarReparacion, type DefectoSerie, type PlanReparacion } from "./vacaciones-reparacion";

/**
 * RRHH VACACIONES — REPARACIÓN ADMINISTRADA de series inconsistentes (capa de BD). Ver vacaciones-reparacion.ts para las reglas.
 *
 * - `previsualizarReparacion`: SOLO LECTURA. Diagnostica y propone la serie reconstruida desde `empleados.fecha_alta` ACTUAL.
 * - `repararSerieVacaciones`: una transacción propia que vuelve a validar TODO bajo bloqueo (no confía en el preview), exige que lo que se confirma
 *   sea exactamente lo previsualizado (`huella`) y reemplaza SOLO los saldos/detalle FIFO de ese colaborador. Nunca toca `fecha_alta`, incidencias,
 *   `vacaciones`, evidencias, otros colaboradores ni otras empresas. Todas las consultas van acotadas por `empresa_id` y `id_empleado`.
 * - `listarPendientesReparacion`: SOLO LECTURA, identifica (no repara) a quienes requieren reparación en la empresa.
 */

export class ReparacionBloqueadaError extends Error {
  constructor(message: string, public plan: PlanReparacion) {
    super(message);
    this.name = "ReparacionBloqueadaError";
  }
}
export class ReparacionEmpleadoNoEncontradoError extends Error {
  constructor() {
    super("Empleado no encontrado.");
    this.name = "ReparacionEmpleadoNoEncontradoError";
  }
}
/** Lo que se está por reparar ya no es lo que se previsualizó: se aborta sin escribir. */
export class ReparacionCambioError extends Error {
  constructor(public plan: PlanReparacion) {
    super("La información del colaborador cambió desde la vista previa. Vuelva a revisarla antes de reparar.");
    this.name = "ReparacionCambioError";
  }
}

/** Huella de lo que el administrador revisa: fecha de alta, series actual y propuesta, consumos y líneas FIFO. Cambia si algo de eso cambia. */
export function huellaReparacion(plan: PlanReparacion): string {
  const base = {
    alta: plan.fechaAltaActual,
    actual: plan.periodosActuales.map((p) => [p.id, p.anioLaboral, p.inicio, p.fin, p.otorgados, p.consumidos, p.disponibles, p.estado]),
    propuesta: plan.periodos.map((p) => [p.anioLaboral, p.inicio, p.fin, p.otorgados, p.consumidos, p.disponibles, p.estado]),
    lineas: plan.lineas.map((l) => [l.incidenciaId, l.anioLaboral, l.dias]).sort(),
    consumido: plan.consumidoPreservado,
    vacaciones: plan.vacaciones,
    bloqueos: plan.bloqueos.map((b) => b.codigo),
  };
  return createHash("sha256").update(JSON.stringify(base)).digest("hex").slice(0, 32);
}

async function armarPlanReparacion(consulta: Consulta, empresaId: number, idEmpleado: number, fechaAlta: string | null, hoy: Date, bloqueo: boolean): Promise<{ plan: PlanReparacion; datos: Hechos; politica: PoliticaVacaciones }> {
  const h = await cargarHechos(consulta, empresaId, idEmpleado, bloqueo);
  const fechas = h.hechos.flatMap((x) => [x.inicio, x.fin]).sort();
  const feriados = fechas.length ? await obtenerFeriadosEnRango(empresaId, fechas[0], fechas[fechas.length - 1]) : new Set<string>();
  const politica = await obtenerPoliticaConConsulta(consulta, empresaId);
  const plan = planificarReparacion({ fechaAlta, hoy, hechos: h.hechos, saldos: h.saldos, feriados, lineasAntes: h.detalleIds.length, politica });
  if (plan.aplica) plan.bloqueos.push(...bloqueosDeDetalle(h, empresaId));
  return { plan, datos: h, politica };
}

export type PreviaReparacion = {
  requiereReparacion: boolean;
  /** true = hay algo que reparar y ningún bloqueo: el botón de confirmar puede habilitarse. */
  puedeReparar: boolean;
  fechaAltaActual: string | null;
  periodosActuales: PlanReparacion["periodosActuales"];
  periodosPropuestos: PlanReparacion["periodos"];
  traslapesActuales: number;
  aniosLaboralesDuplicados: number[];
  aniosLaboralesFaltantes: number[];
  periodosFueraDeBase: { saldoId: number; anioLaboral: number | null; inicio: string; fin: string }[];
  defectos: DefectoSerie[];
  vacacionesRegistradas: number;
  consumidoPreservado: number;
  saldoAntes: number;
  saldoDespues: number;
  lineasFifoAntes: number;
  lineasFifoDespues: number;
  bloqueos: PlanReparacion["bloqueos"];
  advertencias: string[];
  huella: string;
};

function aPrevia(plan: PlanReparacion, datos: Hechos): PreviaReparacion {
  const traslapes = analizarTraslapes(datos.saldos.map((s) => ({ id: s.id, anioLaboral: s.anioLaboral, inicio: s.inicio, fin: s.fin, otorgados: s.otorgados, disponibles: s.disponibles, estado: s.estado, conConsumo: false }))).filter((a) => a.codigo === "TRASLAPE_REAL").length;
  const fuera = new Set(plan.diagnostico.fueraDeBase);
  const advertencias = [...plan.advertencias];
  const sinAnio = datos.saldos.filter((s) => s.anioLaboral == null && !s.conDetalle).length;
  if (plan.requiereReparacion && sinAnio) advertencias.push(`${sinAnio} saldo(s) sin año laboral y sin consumo se reemplazarán junto con el resto de la serie.`);
  return {
    requiereReparacion: plan.requiereReparacion,
    puedeReparar: plan.requiereReparacion && plan.aplica && plan.bloqueos.length === 0,
    fechaAltaActual: plan.fechaAltaActual,
    periodosActuales: plan.periodosActuales,
    periodosPropuestos: plan.periodos,
    traslapesActuales: traslapes,
    aniosLaboralesDuplicados: plan.diagnostico.aniosDuplicados,
    aniosLaboralesFaltantes: plan.diagnostico.aniosFaltantes,
    periodosFueraDeBase: datos.saldos.filter((s) => fuera.has(s.id)).map((s) => ({ saldoId: s.id, anioLaboral: s.anioLaboral, inicio: s.inicio, fin: s.fin })),
    defectos: plan.diagnostico.defectos,
    vacacionesRegistradas: plan.vacaciones,
    consumidoPreservado: plan.consumidoPreservado,
    saldoAntes: plan.saldoAntes,
    saldoDespues: plan.saldoDespues,
    lineasFifoAntes: plan.lineasAntes,
    lineasFifoDespues: plan.lineas.length,
    bloqueos: plan.bloqueos,
    advertencias,
    huella: huellaReparacion(plan),
  };
}

/** Vista previa (SOLO LECTURA, pool). `null` = el colaborador no existe en esta empresa. */
export async function previsualizarReparacion(empresaId: number, idEmpleado: number, hoy: Date = new Date()): Promise<PreviaReparacion | null> {
  const emp = await query<RowDataPacket[]>("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [idEmpleado, empresaId]);
  if (!emp.length) return null;
  const fechaAlta = emp[0].fecha_alta ? toIsoDate(emp[0].fecha_alta as string | Date) : null;
  const consulta: Consulta = (sql, p) => query<RowDataPacket[]>(sql, p);
  const { plan, datos } = await armarPlanReparacion(consulta, empresaId, idEmpleado, fechaAlta, hoy, false);
  return aPrevia(plan, datos);
}

export type ResultadoReparacion = { aplicado: boolean; plan: PlanReparacion };

/**
 * Repara la serie DENTRO de la transacción del llamador (no confirma ni revierte). Vuelve a diagnosticar y planificar con las filas BLOQUEADAS:
 * - serie ya correcta ⇒ `aplicado: false`, no escribe nada;
 * - bloqueo ⇒ lanza `ReparacionBloqueadaError`; huella distinta a la previsualizada ⇒ lanza `ReparacionCambioError`;
 * - cualquier invariante fallida ⇒ lanza (el llamador revierte todo).
 */
export async function repararSerieVacacionesEnConexion(
  conn: PoolConnection, empresaId: number, idEmpleado: number, opciones: { huella: string; usuario?: string | null; hoy?: Date },
): Promise<ResultadoReparacion> {
  const hoy = opciones.hoy ?? new Date();
  const consulta: Consulta = async (sql, p) => (await conn.query<RowDataPacket[]>(sql, p))[0];
  const [emp] = await conn.query<RowDataPacket[]>("SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE", [idEmpleado, empresaId]);
  if (!emp.length) throw new ReparacionEmpleadoNoEncontradoError();
  const fechaAlta = emp[0].fecha_alta ? toIsoDate(emp[0].fecha_alta as string | Date) : null;

  const { plan, datos, politica } = await armarPlanReparacion(consulta, empresaId, idEmpleado, fechaAlta, hoy, true);
  if (!plan.requiereReparacion || !plan.aplica) return { aplicado: false, plan };
  if (plan.bloqueos.length) throw new ReparacionBloqueadaError(plan.bloqueos.map((b) => b.mensaje).join(" "), plan);
  if (datos.cruzados.length) throw new ReparacionBloqueadaError("Detalle FIFO cruzado hacia saldos ajenos: requiere revisión administrada.", plan);
  if (huellaReparacion(plan) !== opciones.huella) throw new ReparacionCambioError(plan);

  const traslapesAnteriores = analizarTraslapes(datos.saldos.map((s) => ({ id: s.id, anioLaboral: s.anioLaboral, inicio: s.inicio, fin: s.fin, otorgados: s.otorgados, disponibles: s.disponibles, estado: s.estado, conConsumo: false }))).filter((a) => a.codigo === "TRASLAPE_REAL").length;
  await reemplazarSerieEnConexion(conn, consulta, empresaId, idEmpleado, plan, datos, {
    etiqueta: "Reparación de la serie de vacaciones", fechaTxt: "la fecha de alta", fechaBase: fechaAlta!, usuario: opciones.usuario ?? null, hoy,
    accion: "vacaciones_reparacion_serie", aplicarTope: politica.aplicarTope,
    detalle: {
      empresaId, empleadoId: idEmpleado, fechaAlta, usuario: opciones.usuario ?? null, fecha: hoy.toISOString(),
      periodosAnteriores: plan.periodosActuales.map((p) => ({ id: p.id, anio: p.anioLaboral, inicio: p.inicio, fin: p.fin, otorgados: p.otorgados, consumidos: p.consumidos, disponibles: p.disponibles, estado: p.estado })),
      periodosNuevos: plan.periodos.map((p) => ({ anio: p.anioLaboral, inicio: p.inicio, fin: p.fin, otorgados: p.otorgados, consumidos: p.consumidos, disponibles: p.disponibles, estado: p.estado })),
      defectos: plan.diagnostico.defectos.map((d) => d.codigo), traslapesAnteriores, aniosDuplicados: plan.diagnostico.aniosDuplicados,
      consumidoPreservado: plan.consumidoPreservado, saldoAntes: plan.saldoAntes, saldoDespues: plan.saldoDespues,
      lineasFifoAnteriores: plan.lineasAntes, lineasFifoReconstruidas: plan.lineas.length,
    },
  });
  return { aplicado: true, plan };
}

/** Reparación completa en UNA transacción propia (BEGIN … COMMIT; cualquier error ⇒ ROLLBACK y se vuelve a lanzar). */
export async function repararSerieVacaciones(
  empresaId: number, idEmpleado: number, opciones: { huella: string; usuario?: string | null; hoy?: Date },
): Promise<ResultadoReparacion> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    try {
      const r = await repararSerieVacacionesEnConexion(conn, empresaId, idEmpleado, opciones);
      await conn.commit();
      return r;
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  } finally {
    conn.release();
  }
}

export type PendienteReparacion = { empleadoId: number; codigo: string; nombre: string; estado: string; fechaAlta: string | null; motivos: string[] };

/** Colaboradores de la empresa cuya serie requiere reparación (SOLO LECTURA: no escribe ni repara nada). */
export async function listarPendientesReparacion(empresaId: number, hoy: Date = new Date()): Promise<{ total: number; empleados: PendienteReparacion[] }> {
  const emps = await query<RowDataPacket[]>(
    `SELECT e.id, e.codigo, e.nombre, e.estado, e.fecha_alta FROM empleados e WHERE e.empresa_id = ?
       AND EXISTS (SELECT 1 FROM saldos_vacaciones s WHERE s.empresa_id = e.empresa_id AND s.id_empleado = e.id) ORDER BY e.nombre, e.id`,
    [empresaId],
  );
  const saldos = await query<RowDataPacket[]>(
    "SELECT id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado FROM saldos_vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  const conConsumo = new Set((await query<RowDataPacket[]>(
    "SELECT DISTINCT s.id AS saldo_id FROM saldos_vacaciones s INNER JOIN detalle_consumo_vacaciones d ON d.saldo_id = s.id WHERE s.empresa_id = ?",
    [empresaId],
  )).map((r) => Number(r.saldo_id)));
  const porEmpleado = new Map<number, RowDataPacket[]>();
  for (const s of saldos) porEmpleado.set(Number(s.id_empleado), [...(porEmpleado.get(Number(s.id_empleado)) ?? []), s]);

  const empleados: PendienteReparacion[] = [];
  for (const e of emps) {
    const filas = (porEmpleado.get(Number(e.id)) ?? []).map((s) => ({
      id: Number(s.id), anioLaboral: s.anio_laboral != null ? Number(s.anio_laboral) : null, inicio: String(toIsoDate(s.periodo_inicio) ?? ""), fin: String(toIsoDate(s.periodo_fin) ?? ""),
      otorgados: Number(s.dias_otorgados), disponibles: Number(s.dias_disponibles), estado: String(s.estado), conConsumo: conConsumo.has(Number(s.id)),
    }));
    const fechaAlta = e.fecha_alta ? toIsoDate(e.fecha_alta as string | Date) : null;
    const d = diagnosticarSerie({ fechaAlta, hoy, filas });
    if (!d.requiereReparacion) continue;
    empleados.push({ empleadoId: Number(e.id), codigo: String(e.codigo ?? ""), nombre: String(e.nombre ?? ""), estado: String(e.estado ?? ""), fechaAlta, motivos: [...new Set(d.defectos.map((x) => x.codigo))] });
  }
  return { total: empleados.length, empleados };
}

/* ───────────────────────── REPARACIÓN POR LOTE (todos los elegibles) ─────────────────────────
 * NO es un UPDATE/DELETE masivo: equivale a ejecutar, colaborador por colaborador, EXACTAMENTE la reparación individual (`previsualizarReparacion` /
 * `repararSerieVacaciones`), cada una en SU PROPIA transacción (un fallo no revierte a los demás). No hay un segundo motor ni lógica duplicada. */

export type EstadoLote = "ELEGIBLE" | "BLOQUEADO" | "SIN_CAMBIOS";
export type FilaLote = {
  empleadoId: number;
  codigo: string;
  nombre: string;
  fechaAlta: string | null;
  motivos: string[];
  periodosActuales: PreviaReparacion["periodosActuales"];
  periodosPropuestos: PreviaReparacion["periodosPropuestos"];
  saldoAntes: number;
  saldoDespues: number;
  consumidoPreservado: number;
  bloqueos: PreviaReparacion["bloqueos"];
  estado: EstadoLote;
  /** Huella individual de lo previsualizado: solo para ELEGIBLES (se vuelve a verificar al confirmar). */
  huella: string | null;
};
export type PreviaLote = { pendientes: number; elegibles: number; bloqueados: number; sinCambios: number; filas: FilaLote[] };

/** Vista previa GLOBAL (SOLO LECTURA): la vista previa individual de cada pendiente. No escribe absolutamente nada. */
export async function previsualizarReparacionLote(empresaId: number, hoy: Date = new Date()): Promise<PreviaLote> {
  const pendientes = await listarPendientesReparacion(empresaId, hoy);
  const filas: FilaLote[] = [];
  for (const p of pendientes.empleados) {
    const previa = await previsualizarReparacion(empresaId, p.empleadoId, hoy);
    if (!previa) continue; // desapareció entre el listado y la vista previa
    // Solo es ELEGIBLE si hay algo que reparar, la fecha de alta es válida (sin bloqueos del motor) y el plan es aplicable; nada se asume desde el cliente.
    const estado: EstadoLote = !previa.requiereReparacion ? "SIN_CAMBIOS" : previa.puedeReparar && previa.fechaAltaActual ? "ELEGIBLE" : "BLOQUEADO";
    filas.push({
      empleadoId: p.empleadoId, codigo: p.codigo, nombre: p.nombre, fechaAlta: previa.fechaAltaActual,
      motivos: [...new Set(previa.defectos.map((d) => d.codigo))],
      periodosActuales: previa.periodosActuales, periodosPropuestos: previa.periodosPropuestos,
      saldoAntes: previa.saldoAntes, saldoDespues: previa.saldoDespues, consumidoPreservado: previa.consumidoPreservado,
      bloqueos: previa.bloqueos, estado, huella: estado === "ELEGIBLE" ? previa.huella : null,
    });
  }
  return {
    pendientes: pendientes.total,
    elegibles: filas.filter((f) => f.estado === "ELEGIBLE").length,
    bloqueados: filas.filter((f) => f.estado === "BLOQUEADO").length,
    sinCambios: filas.filter((f) => f.estado === "SIN_CAMBIOS").length,
    filas,
  };
}

export type ResultadoEmpleadoLote = {
  empleadoId: number;
  resultado: "REPARADO" | "BLOQUEADO" | "CAMBIO_DESDE_PREVIEW" | "SIN_CAMBIOS" | "ERROR";
  mensaje: string;
};
export type ResultadoLote = {
  solicitados: number;
  reparados: number;
  bloqueados: number;
  cambiosDesdePreview: number;
  sinCambios: number;
  errores: number;
  resultados: ResultadoEmpleadoLote[];
};

/**
 * Repara, UNO POR UNO y cada uno en su propia transacción, los colaboradores indicados con la huella de su vista previa. Para cada uno se ejecuta
 * `repararSerieVacaciones` (FOR UPDATE del empleado, recarga, rediagnóstico, replanificación, verificación de huella, invariantes y auditoría
 * individual `vacaciones_reparacion_serie`). Un bloqueo, un cambio desde la vista previa o un error en uno NO impide continuar con los siguientes
 * ni revierte los ya confirmados. La empresa viene siempre del servidor: un colaborador de otra empresa jamás entra (no se encuentra). Al final se
 * registra un resumen `vacaciones_reparacion_lote` (la auditoría individual sigue siendo la obligatoria).
 */
export async function repararLoteVacaciones(
  empresaId: number, items: readonly { empleadoId: number; huella: string }[], opciones: { usuario?: string | null; hoy?: Date } = {},
): Promise<ResultadoLote> {
  const hoy = opciones.hoy ?? new Date();
  const vistos = new Set<number>();
  const unicos = items.filter((i) => (vistos.has(i.empleadoId) ? false : (vistos.add(i.empleadoId), true)));
  const resultados: ResultadoEmpleadoLote[] = [];
  for (const it of unicos) {
    let r: ResultadoEmpleadoLote;
    try {
      const res = await repararSerieVacaciones(empresaId, it.empleadoId, { huella: it.huella, usuario: opciones.usuario ?? null, hoy });
      r = res.aplicado
        ? { empleadoId: it.empleadoId, resultado: "REPARADO", mensaje: "Serie reconstruida correctamente." }
        : { empleadoId: it.empleadoId, resultado: "SIN_CAMBIOS", mensaje: "La serie ya era correcta: no se modificó nada." };
    } catch (error) {
      if (error instanceof ReparacionBloqueadaError) r = { empleadoId: it.empleadoId, resultado: "BLOQUEADO", mensaje: `No reparado — requiere revisión manual. ${error.message}` };
      else if (error instanceof ReparacionCambioError) r = { empleadoId: it.empleadoId, resultado: "CAMBIO_DESDE_PREVIEW", mensaje: "La información cambió desde la vista previa: revise nuevamente. No se modificó nada." };
      else if (error instanceof ReparacionEmpleadoNoEncontradoError) r = { empleadoId: it.empleadoId, resultado: "ERROR", mensaje: "Colaborador no encontrado en esta empresa. No se modificó nada." };
      else {
        console.error("[vacaciones/reparacion/lote]", it.empleadoId, error);
        r = { empleadoId: it.empleadoId, resultado: "ERROR", mensaje: "Error inesperado: este colaborador no se modificó." };
      }
    }
    resultados.push(r);
  }
  const cuenta = (x: ResultadoEmpleadoLote["resultado"]) => resultados.filter((r) => r.resultado === x).length;
  const lote: ResultadoLote = {
    solicitados: unicos.length, reparados: cuenta("REPARADO"), bloqueados: cuenta("BLOQUEADO"), cambiosDesdePreview: cuenta("CAMBIO_DESDE_PREVIEW"),
    sinCambios: cuenta("SIN_CAMBIOS"), errores: cuenta("ERROR"), resultados,
  };
  // Resumen del lote (solo informativo; la auditoría individual ya quedó dentro de cada transacción). Un fallo aquí no deshace nada.
  try {
    const conn = await getPool().getConnection();
    try {
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: opciones.usuario ?? null, accion: "vacaciones_reparacion_lote", modulo: "rrhh",
        detalle: JSON.stringify({
          empresaId, usuario: opciones.usuario ?? null, fecha: hoy.toISOString(), cantidadSolicitada: lote.solicitados, reparados: lote.reparados,
          bloqueados: lote.bloqueados, cambiosPreview: lote.cambiosDesdePreview, sinCambios: lote.sinCambios, errores: lote.errores,
          empleados: resultados.map((r) => [r.empleadoId, r.resultado]),
        }),
      });
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("[vacaciones/reparacion/lote] auditoría del lote", error);
  }
  return lote;
}
