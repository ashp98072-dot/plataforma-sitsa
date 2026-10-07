import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { toIsoDate } from "./dates";
import { obtenerFeriadosEnRango } from "./vacaciones";
import { cargarHistorialActual, type Consulta } from "./vacaciones-historial-actual";
import type { FilaExport, ResultadoExport } from "./vacaciones-historial-export";
import { normalizarTexto } from "./vacaciones-historial-import";
import {
  reconstruirEmpleado,
  type AdvertenciaReconstruccion,
  type PeriodoReconstruido,
  type ResultadoReconstruccion,
  type ResumenDiasReconstruccion,
  type VacacionReconstruccion,
} from "./vacaciones-reconstruccion";
import {
  claveDecision,
  huellaTexto,
  validarDecisiones,
  type DecisionPendiente,
  type DecisionReconstruccion,
} from "./vacaciones-reconstruccion-decisiones";

/**
 * RRHH VACACIONES — PLAN DE RECONSTRUCCIÓN (fuente + planificador). El planificador es PURO; el cargador solo hace SELECT.
 *
 * Fuente de verdad: el historial validado (export del historial actual, `completo = true`). El plan calcula, sin escribir nada:
 *   - qué empleados se reconstruyen (con fecha de alta válida y saldos o vacaciones), con sus períodos, vacaciones y detalle FIFO nuevos;
 *   - qué filas actuales son el objetivo del borrado (ids concretos de vacaciones, incidencias de vacaciones, detalle y saldos);
 *   - el relink de evidencias por IDENTIDAD LÓGICA (empresa + empleado + tipo + fecha_inicio + fecha_fin + dias_habiles; nunca el ID viejo);
 *   - las decisiones pendientes y las resoluciones aplicadas;
 *   - `puedeAplicarse` con TODOS los bloqueos.
 * Nunca decide por su cuenta: ante cualquier duda (0 o >1 coincidencias, decisión sin resolver, export no lossless) NO es aplicable.
 */

export type EmpleadoFuente = { id: number; codigo: string; nombre: string; fechaAlta: string | null; fechaInicioLaboral: string | null };

/** Todo lo necesario para recrear una evidencia después del CASCADE de la FK fk_ev_inc (se captura ANTES de borrar nada). */
export type EvidenciaRespaldo = {
  id: number;
  empresaId: number;
  incidenciaId: number;
  idEmpleado: number;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  rutaArchivo: string;
  nombreOriginal: string | null;
  /** "YYYY-MM-DD HH:MM:SS" tal cual la BD (sin conversión de zona horaria). */
  subidoEn: string;
  subidoPor: string | null;
};

export type FuenteReconstruccion = {
  empresaId: number;
  exportacion: ResultadoExport;
  empleados: EmpleadoFuente[];
  vacacionIds: number[];
  incidenciaIds: number[];
  saldos: { id: number; idEmpleado: number }[];
  detalles: { id: number; incidenciaId: number; saldoId: number }[];
  solicitudesLigadas: { id: number; incidenciaId: number }[];
  evidencias: EvidenciaRespaldo[];
  totalEvidenciasEmpresa: number;
  feriados: ReadonlySet<string>;
};

const TIPOS_SQL = "('Vacaciones', 'A cuenta de Vacaciones')";
const sinTabla = (e: unknown) => (e as { errno?: number; code?: string })?.errno === 1146 || (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Carga la fuente con SELECT (pool o la conexión de la transacción). Toda consulta acotada por `empresa_id`. */
export async function cargarFuente(empresaId: number, consulta: Consulta): Promise<FuenteReconstruccion> {
  const exportacion = await cargarHistorialActual(empresaId, consulta);
  const emps = await consulta("SELECT id, codigo, nombre, fecha_alta, fecha_inicio_laboral FROM empleados WHERE empresa_id = ?", [empresaId]);
  const vac = await consulta("SELECT id FROM vacaciones WHERE empresa_id = ? ORDER BY id", [empresaId]);
  const inc = await consulta(`SELECT id FROM incidencias WHERE empresa_id = ? AND tipo IN ${TIPOS_SQL} ORDER BY id`, [empresaId]);
  const sal = await consulta("SELECT id, id_empleado FROM saldos_vacaciones WHERE empresa_id = ? ORDER BY id", [empresaId]);
  const det = await consulta(
    `SELECT d.id, d.incidencia_id, d.saldo_id FROM detalle_consumo_vacaciones d
     WHERE d.incidencia_id IN (SELECT id FROM incidencias WHERE empresa_id = ? AND tipo IN ${TIPOS_SQL})
        OR d.saldo_id IN (SELECT id FROM saldos_vacaciones WHERE empresa_id = ?)
     ORDER BY d.id`,
    [empresaId, empresaId],
  );
  let solicitudes: RowDataPacket[] = [];
  try {
    solicitudes = await consulta("SELECT id, incidencia_id FROM solicitudes_vacaciones WHERE empresa_id = ? AND incidencia_id IS NOT NULL", [empresaId]);
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }
  let evs: RowDataPacket[] = [];
  let totalEv = 0;
  try {
    evs = await consulta(
      `SELECT e.id, e.empresa_id, e.incidencia_id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles,
              e.ruta_archivo, e.nombre_original, DATE_FORMAT(e.subido_en, '%Y-%m-%d %H:%i:%s') AS subido_en, e.subido_por
       FROM evidencias_incidencias e JOIN incidencias i ON i.id = e.incidencia_id
       WHERE e.empresa_id = ? AND i.empresa_id = ? AND i.tipo IN ${TIPOS_SQL} ORDER BY e.id`,
      [empresaId, empresaId],
    );
    const tot = await consulta("SELECT COUNT(*) AS n FROM evidencias_incidencias WHERE empresa_id = ?", [empresaId]);
    totalEv = Number(tot[0]?.n ?? 0);
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }
  const fechas = exportacion.filas.flatMap((f) => [f.fecha_inicio, f.fecha_fin]).sort();
  const feriados = fechas.length ? await obtenerFeriadosEnRango(empresaId, fechas[0], fechas[fechas.length - 1]) : new Set<string>();
  return {
    empresaId,
    exportacion,
    empleados: emps.map((r) => ({
      id: Number(r.id), codigo: String(r.codigo ?? ""), nombre: String(r.nombre ?? ""),
      fechaAlta: toIsoDate(r.fecha_alta as string | Date | null), fechaInicioLaboral: toIsoDate(r.fecha_inicio_laboral as string | Date | null),
    })),
    vacacionIds: vac.map((r) => Number(r.id)),
    incidenciaIds: inc.map((r) => Number(r.id)),
    saldos: sal.map((r) => ({ id: Number(r.id), idEmpleado: Number(r.id_empleado) })),
    detalles: det.map((r) => ({ id: Number(r.id), incidenciaId: Number(r.incidencia_id), saldoId: Number(r.saldo_id) })),
    solicitudesLigadas: solicitudes.map((r) => ({ id: Number(r.id), incidenciaId: Number(r.incidencia_id) })),
    evidencias: evs.map((r) => ({
      id: Number(r.id), empresaId: Number(r.empresa_id), incidenciaId: Number(r.incidencia_id), idEmpleado: Number(r.id_empleado), tipo: String(r.tipo),
      fechaInicio: toIsoDate(r.fecha_inicio as string | Date) ?? "", fechaFin: toIsoDate(r.fecha_fin as string | Date) ?? "", diasHabiles: Number(r.dias_habiles),
      rutaArchivo: String(r.ruta_archivo), nombreOriginal: r.nombre_original == null ? null : String(r.nombre_original),
      subidoEn: String(r.subido_en), subidoPor: r.subido_por == null ? null : String(r.subido_por),
    })),
    totalEvidenciasEmpresa: totalEv,
    feriados,
  };
}

/* ------------------------------------------------------------------ plan */

export type CodigoBloqueo =
  | "EXPORT_NO_LOSSLESS"
  | "HISTORIAL_CON_ERRORES"
  | "DECISIONES_PENDIENTES"
  | "DECISION_INVALIDA"
  | "RELINK_IMPOSIBLE"
  | "SOLICITUDES_LIGADAS"
  | "DETALLE_AJENO";
export type Bloqueo = { codigo: CodigoBloqueo; mensaje: string };

export type VacacionPlan = {
  /** Identidad lógica de la vacación/incidencia nueva: empleado + tipo + inicio + fin + días. */
  clave: string;
  origen: number;
  empleadoId: number;
  tipo: FilaExport["tipo"];
  inicio: string;
  fin: string;
  dias: number;
  observacion: string;
  consumos: { anioLaboral: number; dias: number }[];
  deficit: number;
};

export type EmpleadoPlan = {
  empleadoId: number;
  codigo: string;
  nombre: string;
  fechaAlta: string | null;
  fechaInicioLaboral: string | null;
  vacaciones: number;
  periodos: PeriodoReconstruido[];
  saldoFinal: number;
  resumenDias: ResumenDiasReconstruccion;
  saldosActuales: number;
};

export type RelinkPlan = { evidenciaId: number; incidenciaAnteriorId: number; claveLogica: string; rutaArchivo: string };
export type ErrorRelink = { evidenciaId: number; codigo: "SIN_COINCIDENCIA" | "MULTIPLES_COINCIDENCIAS" | "EMPRESA_DISTINTA"; mensaje: string };

export type PlanReconstruccion = {
  empresaId: number;
  hoy: string;
  huellaFuente: string;
  puedeAplicarse: boolean;
  bloqueos: Bloqueo[];
  resumen: {
    vacacionesAReconstruir: number;
    incidenciasNuevasEsperadas: number;
    detalleFifoEsperado: number;
    empleadosAReconstruir: number;
    saldosAEliminar: number;
    saldosAGenerar: number;
    evidenciasARelinkear: number;
    evidenciasRelinkeables: number;
    erroresRelink: number;
    decisionesPendientes: number;
    decisionesAplicadas: number;
  };
  empleados: EmpleadoPlan[];
  omitidos: { empleadoId: number; nombre: string; motivo: string }[];
  vacaciones: VacacionPlan[];
  evidencias: { relinks: RelinkPlan[]; errores: ErrorRelink[] };
  decisiones: { pendientes: DecisionPendiente[]; aplicadas: DecisionReconstruccion[]; errores: string[] };
  objetivos: { vacacionIds: number[]; incidenciaIds: number[]; saldoIds: number[]; empleadosAReconstruir: number[] };
  /** Evidencias respaldadas en memoria ANTES de borrar (el CASCADE de fk_ev_inc las eliminaría con sus incidencias). */
  evidenciasRespaldo: EvidenciaRespaldo[];
};

export const claveLogicaVacacion = (idEmpleado: number, tipo: string, inicio: string, fin: string, dias: number) =>
  [idEmpleado, tipo, inicio, fin, r2(dias).toFixed(2)].join("|");

/** Huella de la FUENTE (no del resultado): cualquier cambio en el historial, los empleados, los ids objetivo o las evidencias la cambia. */
export function huellaDeFuente(f: FuenteReconstruccion): string {
  const canon = {
    empresaId: f.empresaId,
    filas: f.exportacion.filas.map((x) => [x.codigo, x.dpi, x.nombre, x.fecha_inicio, x.fecha_fin, x.dias_habiles, x.tipo, x.observacion]),
    empleados: [...f.empleados].sort((a, b) => a.id - b.id).map((e) => [e.id, e.codigo, e.fechaAlta, e.fechaInicioLaboral]),
    vacacionIds: [...f.vacacionIds].sort((a, b) => a - b),
    incidenciaIds: [...f.incidenciaIds].sort((a, b) => a - b),
    saldos: [...f.saldos].sort((a, b) => a.id - b.id).map((s) => [s.id, s.idEmpleado]),
    detalles: [...f.detalles].sort((a, b) => a.id - b.id).map((d) => [d.id, d.incidenciaId, d.saldoId]),
    evidencias: [...f.evidencias].sort((a, b) => a.id - b.id).map((e) => [e.id, e.empresaId, e.incidenciaId, e.idEmpleado, e.tipo, e.fechaInicio, e.fechaFin, e.diasHabiles, e.rutaArchivo, e.nombreOriginal, e.subidoEn, e.subidoPor]),
  };
  return createHash("sha256").update(JSON.stringify(canon), "utf8").digest("hex");
}

/**
 * Relink por IDENTIDAD LÓGICA (empresa + empleado + tipo + fecha_inicio + fecha_fin + dias_habiles; nunca el ID viejo): cada evidencia debe
 * tener EXACTAMENTE UNA incidencia nueva compatible. 0 o >1 coincidencias = error duro (nunca se elige una).
 */
export function resolverRelinks(evidencias: readonly EvidenciaRespaldo[], vacaciones: readonly Pick<VacacionPlan, "clave">[], empresaId: number): { relinks: RelinkPlan[]; errores: ErrorRelink[] } {
  const porClave = new Map<string, number>();
  for (const v of vacaciones) porClave.set(v.clave, (porClave.get(v.clave) ?? 0) + 1);
  const relinks: RelinkPlan[] = [];
  const errores: ErrorRelink[] = [];
  for (const ev of evidencias) {
    const clave = claveLogicaVacacion(ev.idEmpleado, ev.tipo, ev.fechaInicio, ev.fechaFin, ev.diasHabiles);
    if (ev.empresaId !== empresaId) { errores.push({ evidenciaId: ev.id, codigo: "EMPRESA_DISTINTA", mensaje: `La evidencia ${ev.id} pertenece a otra empresa (${ev.empresaId}).` }); continue; }
    const n = porClave.get(clave) ?? 0;
    if (n === 0) { errores.push({ evidenciaId: ev.id, codigo: "SIN_COINCIDENCIA", mensaje: `La evidencia ${ev.id} (${ev.rutaArchivo}) no tiene ninguna incidencia nueva compatible (${clave}).` }); continue; }
    if (n > 1) { errores.push({ evidenciaId: ev.id, codigo: "MULTIPLES_COINCIDENCIAS", mensaje: `La evidencia ${ev.id} (${ev.rutaArchivo}) tiene ${n} incidencias nuevas compatibles (${clave}): no se puede elegir.` }); continue; }
    relinks.push({ evidenciaId: ev.id, incidenciaAnteriorId: ev.incidenciaId, claveLogica: clave, rutaArchivo: ev.rutaArchivo });
  }
  return { relinks, errores };
}

export function planificarReconstruccion(fuente: FuenteReconstruccion, opciones: { decisiones?: unknown; hoy: Date }): PlanReconstruccion {
  const { exportacion, empresaId } = fuente;
  const bloqueos: Bloqueo[] = [];
  const hoyIso = `${opciones.hoy.getFullYear()}-${String(opciones.hoy.getMonth() + 1).padStart(2, "0")}-${String(opciones.hoy.getDate()).padStart(2, "0")}`;

  // 1) El historial debe ser LOSSLESS
  if (!exportacion.resumen.completo) {
    bloqueos.push({
      codigo: "EXPORT_NO_LOSSLESS",
      mensaje: `El historial exportado NO es completo (${exportacion.resumen.filasExportadas} de ${exportacion.resumen.vacacionesLeidas} vacaciones; ${exportacion.resumen.problemasError} problema(s)): no reconstruye todas las vacaciones sin pérdida. Resuelva el reporte de «Exportar historial actual».`,
    });
  }
  if (fuente.vacacionIds.length !== exportacion.filas.length || fuente.incidenciaIds.length !== exportacion.filas.length) {
    bloqueos.push({
      codigo: "EXPORT_NO_LOSSLESS",
      mensaje: `Cardinalidad inconsistente: ${fuente.vacacionIds.length} vacaciones, ${fuente.incidenciaIds.length} incidencias de vacaciones y ${exportacion.filas.length} filas exportables deben ser iguales.`,
    });
  }

  // 2) Empleados y vacaciones por empleado (código único garantizado por el export completo)
  const porCodigo = new Map(fuente.empleados.map((e) => [normalizarTexto(e.codigo), e]));
  const historialPorEmpleado = new Map<number, { fila: FilaExport; origen: number }[]>();
  exportacion.filas.forEach((f, i) => {
    const emp = porCodigo.get(normalizarTexto(f.codigo));
    if (!emp) return;
    historialPorEmpleado.set(emp.id, [...(historialPorEmpleado.get(emp.id) ?? []), { fila: f, origen: i + 2 }]);
  });
  const saldosPorEmpleado = new Map<number, number[]>();
  for (const s of fuente.saldos) saldosPorEmpleado.set(s.idEmpleado, [...(saldosPorEmpleado.get(s.idEmpleado) ?? []), s.id]);

  // 3) Motor: pasada 1 (sin reparto manual) para conocer las decisiones pendientes
  const alcance = fuente.empleados.filter((e) => historialPorEmpleado.has(e.id) || saldosPorEmpleado.has(e.id));
  const toVac = (h: { fila: FilaExport; origen: number }): VacacionReconstruccion => ({ origen: h.origen, inicio: h.fila.fecha_inicio, fin: h.fila.fecha_fin, dias: h.fila.dias_habiles, tipo: h.fila.tipo, observacion: h.fila.observacion });
  const correr = (e: EmpleadoFuente, repartoManual?: Map<number, { anioLaboral: number; dias: number }[]>) =>
    reconstruirEmpleado(
      { id: e.id, codigo: e.codigo, nombre: e.nombre, fechaAlta: e.fechaAlta, fechaInicioLaboral: e.fechaInicioLaboral },
      (historialPorEmpleado.get(e.id) ?? []).map(toVac), opciones.hoy, fuente.feriados, { repartoManual },
    );
  const pasada1 = new Map(alcance.map((e) => [e.id, correr(e)]));

  const pendientesDe = (resultados: Map<number, ResultadoReconstruccion>): DecisionPendiente[] => {
    const out: DecisionPendiente[] = [];
    for (const e of alcance) {
      const r = resultados.get(e.id)!;
      for (const w of r.advertencias.filter((a) => a.severidad === "DECISION")) {
        const v = w.origen != null ? (historialPorEmpleado.get(e.id) ?? []).find((h) => h.origen === w.origen) : undefined;
        if (!v) continue;
        const clave = claveDecision(w.codigo, e.codigo, v.fila.fecha_inicio, v.fila.fecha_fin, v.fila.dias_habiles);
        const huella = huellaTexto(w.mensaje);
        out.push({
          clave, codigo: w.codigo, empleadoId: e.id, empleadoCodigo: e.codigo, empleado: e.nombre, origen: w.origen!, inicio: v.fila.fecha_inicio, fin: v.fila.fecha_fin,
          dias: v.fila.dias_habiles, mensaje: w.mensaje, huella,
          plantilla: { clave, tipo: "ACEPTAR_PROPUESTA", huella, resueltoPor: "", resueltoEn: "", motivo: "" },
        });
      }
    }
    return out;
  };

  // 4) Resoluciones recibidas
  const { decisiones, errores: erroresDecision } = validarDecisiones(opciones.decisiones);
  const pend1 = pendientesDe(pasada1);
  const manuales = new Map<number, Map<number, { anioLaboral: number; dias: number }[]>>(); // empleadoId → origen → reparto
  const aplicadas: DecisionReconstruccion[] = [];
  const usadas = new Set<string>();
  for (const d of decisiones) {
    if (d.tipo !== "REPARTO_MANUAL") continue;
    const p = pend1.find((x) => x.clave === d.clave);
    if (!p) continue; // se reporta abajo como «no corresponde»
    if (p.codigo !== "VACACION_CRUZA_ANIVERSARIO") { erroresDecision.push(`Decisión ${d.clave}: REPARTO_MANUAL solo aplica a vacaciones que cruzan un aniversario.`); usadas.add(d.clave); continue; }
    if (d.huella !== p.huella) { erroresDecision.push(`Decisión ${d.clave}: la huella no coincide con la propuesta actual del motor (los datos cambiaron o se aprobó otra propuesta).`); usadas.add(d.clave); continue; }
    const suma = r2((d.reparto ?? []).reduce((s, x) => s + x.dias, 0));
    if (suma !== r2(p.dias)) { erroresDecision.push(`Decisión ${d.clave}: el reparto manual suma ${suma} día(s) y la vacación tiene ${p.dias}.`); usadas.add(d.clave); continue; }
    const m = manuales.get(p.empleadoId) ?? new Map<number, { anioLaboral: number; dias: number }[]>();
    m.set(p.origen, d.reparto!.map((x) => ({ ...x })));
    manuales.set(p.empleadoId, m);
    aplicadas.push(d);
    usadas.add(d.clave);
  }

  // 5) Pasada 2: con los repartos manuales aprobados
  const resultados = new Map(pasada1);
  for (const [empleadoId, m] of manuales) {
    const e = alcance.find((x) => x.id === empleadoId)!;
    resultados.set(empleadoId, correr(e, m));
  }
  const pend2 = pendientesDe(resultados);
  const pendientes: DecisionPendiente[] = [];
  for (const p of pend2) {
    const d = decisiones.find((x) => x.clave === p.clave && x.tipo === "ACEPTAR_PROPUESTA");
    if (!d) { pendientes.push(p); continue; }
    usadas.add(d.clave);
    if (d.huella !== p.huella) { erroresDecision.push(`Decisión ${d.clave}: la huella no coincide con la propuesta actual del motor (los datos cambiaron o se aprobó otra propuesta).`); pendientes.push(p); continue; }
    aplicadas.push(d);
  }
  for (const d of decisiones) {
    if (!usadas.has(d.clave) && !pend2.some((p) => p.clave === d.clave)) erroresDecision.push(`Decisión ${d.clave}: no corresponde a ninguna decisión pendiente actual (obsoleta o mal escrita).`);
  }
  if (erroresDecision.length) bloqueos.push({ codigo: "DECISION_INVALIDA", mensaje: erroresDecision.join(" ") });
  if (pendientes.length) {
    bloqueos.push({
      codigo: "DECISIONES_PENDIENTES",
      mensaje: `Hay ${pendientes.length} decisión(es) pendiente(s) sin resolver: ${pendientes.map((p) => `${p.empleado} ${p.inicio}→${p.fin} (${p.codigo})`).join("; ")}. Regístrelas (resueltoPor, motivo y la huella de la propuesta) antes de aplicar.`,
    });
  }

  // 6) Errores / bloqueos del motor y selección de empleados a reconstruir
  const omitidos: PlanReconstruccion["omitidos"] = [];
  const aReconstruir: EmpleadoFuente[] = [];
  for (const e of alcance) {
    const r = resultados.get(e.id)!;
    const tieneHistorial = historialPorEmpleado.has(e.id);
    const graves = r.advertencias.filter((a: AdvertenciaReconstruccion) => a.severidad === "BLOQUEANTE" || a.severidad === "ERROR");
    if (r.bloqueado && !tieneHistorial) {
      omitidos.push({ empleadoId: e.id, nombre: e.nombre, motivo: `${r.bloqueado}: fecha_alta inválida, sus saldos actuales NO se tocan (no se repara automáticamente).` });
      continue;
    }
    if (graves.length) {
      bloqueos.push({ codigo: "HISTORIAL_CON_ERRORES", mensaje: `${e.nombre}: ${graves.map((g) => g.mensaje).join(" ")}` });
      continue;
    }
    aReconstruir.push(e);
  }

  // 7) Vacaciones nuevas (cronológico por empleado) y detalle FIFO esperado
  const vacaciones: VacacionPlan[] = [];
  const empleadosPlan: EmpleadoPlan[] = [];
  for (const e of [...aReconstruir].sort((a, b) => a.id - b.id)) {
    const r = resultados.get(e.id)!;
    const hist = historialPorEmpleado.get(e.id) ?? [];
    for (const v of r.vacaciones) {
      const h = hist.find((x) => x.origen === v.origen)!;
      vacaciones.push({
        clave: claveLogicaVacacion(e.id, h.fila.tipo, v.inicio, v.fin, v.dias), origen: v.origen, empleadoId: e.id, tipo: h.fila.tipo, inicio: v.inicio, fin: v.fin, dias: v.dias,
        observacion: h.fila.observacion, consumos: r.consumos.filter((c) => c.origen === v.origen).map((c) => ({ anioLaboral: c.anioLaboral, dias: c.dias })), deficit: v.deficit,
      });
    }
    empleadosPlan.push({
      empleadoId: e.id, codigo: e.codigo, nombre: e.nombre, fechaAlta: e.fechaAlta, fechaInicioLaboral: e.fechaInicioLaboral, vacaciones: r.vacaciones.length,
      periodos: r.periodos, saldoFinal: r.saldoFinal, resumenDias: r.resumenDias, saldosActuales: (saldosPorEmpleado.get(e.id) ?? []).length,
    });
  }
  const claves = new Set<string>();
  for (const v of vacaciones) {
    if (claves.has(v.clave)) bloqueos.push({ codigo: "EXPORT_NO_LOSSLESS", mensaje: `Clave lógica repetida en la reconstrucción (${v.clave}): no se puede relinkear evidencias con certeza.` });
    claves.add(v.clave);
  }

  // 8) Objetivos del borrado y verificaciones de alcance
  const idsAReconstruir = new Set(aReconstruir.map((e) => e.id));
  const saldoIds = fuente.saldos.filter((s) => idsAReconstruir.has(s.idEmpleado)).map((s) => s.id);
  const saldoSet = new Set(saldoIds);
  const incSet = new Set(fuente.incidenciaIds);
  const ajeno = fuente.detalles.filter((d) => (saldoSet.has(d.saldoId) && !incSet.has(d.incidenciaId)) || (incSet.has(d.incidenciaId) && !saldoSet.has(d.saldoId)));
  if (ajeno.length) {
    bloqueos.push({ codigo: "DETALLE_AJENO", mensaje: `${ajeno.length} línea(s) de detalle FIFO no pertenecen al conjunto objetivo (detalle de saldos a reconstruir con incidencias que no se borran, o de incidencias objetivo sobre saldos de empleados omitidos): ids ${ajeno.slice(0, 10).map((d) => d.id).join(", ")}.` });
  }
  const ligadas = fuente.solicitudesLigadas.filter((s) => incSet.has(s.incidenciaId));
  if (ligadas.length) {
    bloqueos.push({ codigo: "SOLICITUDES_LIGADAS", mensaje: `${ligadas.length} solicitud(es) de vacaciones están ligadas a incidencias objetivo (la FK las dejaría en NULL): requieren decisión previa.` });
  }

  // 9) Relink de evidencias por IDENTIDAD LÓGICA (nunca por el ID viejo): exactamente UNA incidencia nueva compatible
  const { relinks, errores: erroresRelink } = resolverRelinks(fuente.evidencias, vacaciones, empresaId);
  if (erroresRelink.length) {
    bloqueos.push({ codigo: "RELINK_IMPOSIBLE", mensaje: `${erroresRelink.length} evidencia(s) no se pueden relinkear con certeza: ${erroresRelink.map((e) => e.mensaje).join(" ")}` });
  }
  const detalleEsperado = vacaciones.reduce((s, v) => s + v.consumos.length, 0);
  return {
    empresaId,
    hoy: hoyIso,
    huellaFuente: huellaDeFuente(fuente),
    puedeAplicarse: bloqueos.length === 0,
    bloqueos,
    resumen: {
      vacacionesAReconstruir: vacaciones.length,
      incidenciasNuevasEsperadas: vacaciones.length,
      detalleFifoEsperado: detalleEsperado,
      empleadosAReconstruir: aReconstruir.length,
      saldosAEliminar: saldoIds.length,
      saldosAGenerar: empleadosPlan.reduce((s, e) => s + e.periodos.length, 0),
      evidenciasARelinkear: fuente.evidencias.length,
      evidenciasRelinkeables: relinks.length,
      erroresRelink: erroresRelink.length,
      decisionesPendientes: pendientes.length,
      decisionesAplicadas: aplicadas.length,
    },
    empleados: empleadosPlan,
    omitidos,
    vacaciones,
    evidencias: { relinks, errores: erroresRelink },
    decisiones: { pendientes, aplicadas, errores: erroresDecision },
    objetivos: { vacacionIds: [...fuente.vacacionIds], incidenciaIds: [...fuente.incidenciaIds], saldoIds, empleadosAReconstruir: aReconstruir.map((e) => e.id).sort((a, b) => a - b) },
    evidenciasRespaldo: fuente.evidencias.map((e) => ({ ...e })),
  };
}

/** Dry-run: el plan sin los datos pesados (respaldo de evidencias, ids). Serializable para la API. */
export function resumenParaDryRun(plan: PlanReconstruccion) {
  return {
    modo: "DRY_RUN" as const,
    escribio: false as const,
    empresaId: plan.empresaId,
    hoy: plan.hoy,
    huellaFuente: plan.huellaFuente,
    puedeAplicarse: plan.puedeAplicarse,
    bloqueos: plan.bloqueos,
    resumen: plan.resumen,
    saldoFinalPorEmpleado: plan.empleados.map((e) => ({ empleadoId: e.empleadoId, codigo: e.codigo, nombre: e.nombre, vacaciones: e.vacaciones, periodos: e.periodos.length, saldoFinal: e.saldoFinal, resumenDias: e.resumenDias })),
    omitidos: plan.omitidos,
    decisiones: plan.decisiones,
    evidencias: { total: plan.resumen.evidenciasARelinkear, relinkeables: plan.resumen.evidenciasRelinkeables, errores: plan.evidencias.errores },
  };
}
export type DryRunReconstruccion = ReturnType<typeof resumenParaDryRun>;
