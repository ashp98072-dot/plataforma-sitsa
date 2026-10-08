import { differenceInYears } from "date-fns";
import { MAX_PERIODOS_VIGENTES, aIso, deIso, fechaLaboralSospechosa, periodoLaboral } from "./vacaciones-periodos";
import { planificarConsumoHistorico, type PeriodoBD } from "./vacaciones-historico";
import { avanzarPeriodos, type EstadoPeriodo } from "./vacaciones-reconstruccion";

/**
 * RRHH VACACIONES — REBASE de la serie de períodos al cambiar `empleados.fecha_alta` (módulo PURO: sin BD, sin red).
 *
 * Modificar `fecha_alta` cambia la BASE de los períodos: NO se agregan períodos nuevos encima de la serie vieja ni los días ya consumidos pueden
 * reaparecer como disponibles. La fuente de verdad son los HECHOS (incidencias Vacaciones / A cuenta de Vacaciones con sus fechas y los días que
 * realmente consumieron según el detalle FIFO), no la serie guardada (que puede estar traslapada, duplicada o calculada desde otra base).
 *
 * El plan construye EN MEMORIA la serie completa desde la fecha nueva y reaplica CRONOLÓGICAMENTE cada consumo con las mismas reglas del registro
 * histórico (#421: `planificarConsumoHistorico`: períodos ya iniciados a la fecha, vencimiento y tope de esa fecha, FIFO por año laboral, tramos al
 * cruzar un aniversario, eventos cronológicos). Después recalcula el estado ACTUAL (Vigente/Vencido, proporcional, disponible, tope de 30) con el
 * mismo motor (`avanzarPeriodos`). Cualquier inconsistencia se informa como BLOQUEO (el cambio no debe aplicarse).
 */

export type HechoVacacion = {
  incidenciaId: number;
  tipo: string;
  inicio: string;
  fin: string;
  /** dias_habiles de la incidencia (informativo). */
  dias: number;
  /** Días REALMENTE consumidos (suma del detalle FIFO actual de esta incidencia): es lo que se preserva. */
  consumido: number;
};
export type SaldoPrevio = { id: number; anioLaboral: number | null; inicio: string; fin: string; otorgados: number; disponibles: number; estado: string };

export type CodigoBloqueoRebase =
  | "FECHA_NUEVA_INVALIDA"
  | "FECHA_NUEVA_SOSPECHOSA"
  | "FECHA_NUEVA_FUTURA"
  | "VACACION_ANTERIOR_A_NUEVA_ALTA"
  | "DEFICIT_AL_REBASAR"
  | "DETALLE_AJENO"
  | "DETALLE_SALDO_AJENO";
export type BloqueoRebase = { codigo: CodigoBloqueoRebase; mensaje: string };

export type PeriodoRebase = { anioLaboral: number; inicio: string; fin: string; otorgados: number; consumidos: number; disponibles: number; estado: "Vigente" | "Vencido" };
export type LineaDetalleRebase = { incidenciaId: number; anioLaboral: number; dias: number };

export type PlanRebase = {
  /** false = no hay nada que rebasar (misma fecha, o el empleado no tiene saldos ni vacaciones). */
  aplica: boolean;
  fechaAnterior: string | null;
  fechaNueva: string;
  bloqueos: BloqueoRebase[];
  advertencias: string[];
  periodosAntes: number;
  periodos: PeriodoRebase[];
  lineas: LineaDetalleRebase[];
  vacaciones: number;
  /** Total consumido preservado: Σ detalle antes = Σ detalle después. */
  consumidoPreservado: number;
  saldoAntes: number;
  saldoDespues: number;
  reasignaciones: { incidenciaId: number; inicio: string; fin: string; dias: number; tramos: { anioLaboral: number; dias: number }[] }[];
};

/** Error que revierte TODA la transacción de `actualizarEmpleado` cuando el rebase de vacaciones está bloqueado: la ficha conserva su fecha_alta. */
export class RebaseBloqueadoError extends Error {
  constructor(message: string, public plan: PlanRebase) {
    super(message);
    this.name = "RebaseBloqueadoError";
  }
}

export const MENSAJE_ANTERIOR_A_ALTA =
  "La nueva fecha de contratación dejaría vacaciones registradas antes de la fecha de alta. Corrija/revise el historial antes de continuar.";

const r2 = (n: number) => Math.round(n * 100) / 100;
const cero = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type EntradaRebase = {
  fechaAnterior: string | null;
  fechaNueva: string;
  hoy: Date;
  hechos: readonly HechoVacacion[];
  saldos: readonly SaldoPrevio[];
  feriados: ReadonlySet<string>;
};

export function planificarRebase(e: EntradaRebase): PlanRebase {
  const hoy = cero(e.hoy);
  const saldoAntes = r2(e.saldos.filter((s) => s.estado === "Vigente").reduce((t, s) => t + s.disponibles, 0));
  const base: PlanRebase = {
    aplica: false, fechaAnterior: e.fechaAnterior, fechaNueva: e.fechaNueva, bloqueos: [], advertencias: [], periodosAntes: e.saldos.length, periodos: [], lineas: [],
    vacaciones: e.hechos.length, consumidoPreservado: r2(e.hechos.reduce((t, h) => t + h.consumido, 0)), saldoAntes, saldoDespues: saldoAntes, reasignaciones: [],
  };
  if (e.fechaAnterior === e.fechaNueva) return base; // la fecha no cambia: comportamiento actual idéntico
  // A) sin vacaciones Y sin saldos: no existe historia ni serie de vacaciones que dependa de fecha_alta ⇒ nada que rebasar (no-op).
  // B) con saldos, aunque no haya vacaciones tomadas: existe una serie CALCULADA desde fecha_alta; jamás puede quedar con la base anterior.
  if (e.hechos.length === 0 && e.saldos.length === 0) return base;

  base.aplica = true;
  const bloquear = (codigo: CodigoBloqueoRebase, mensaje: string) => { base.bloqueos.push({ codigo, mensaje }); return base; };
  if (!FECHA.test(e.fechaNueva)) return bloquear("FECHA_NUEVA_INVALIDA", `La nueva fecha de contratación no es válida (${e.fechaNueva}).`);
  const nueva = deIso(e.fechaNueva);
  if (Number.isNaN(nueva.getTime())) return bloquear("FECHA_NUEVA_INVALIDA", `La nueva fecha de contratación no es válida (${e.fechaNueva}).`);
  // Con saldos (aunque el consumo sea 0) o con vacaciones, una fecha nueva sospechosa o futura NO se puede aplicar: dejaría la serie calculada con la base anterior.
  const que = e.hechos.length ? "vacaciones registradas" : "períodos de vacaciones ya generados";
  if (fechaLaboralSospechosa(nueva)) {
    return bloquear("FECHA_NUEVA_SOSPECHOSA", `La nueva fecha de contratación es inválida o anterior a 1980: no se pueden recalcular los períodos con ${que}.`);
  }
  if (nueva > hoy) {
    return bloquear("FECHA_NUEVA_FUTURA", `La nueva fecha de contratación es posterior a hoy y hay ${que}: no se pueden recalcular los períodos.`);
  }

  const hechos = [...e.hechos].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.incidenciaId - b.incidenciaId);
  const anteriores = hechos.filter((h) => h.inicio < e.fechaNueva);
  if (anteriores.length) {
    return bloquear("VACACION_ANTERIOR_A_NUEVA_ALTA", `${MENSAJE_ANTERIOR_A_ALTA} (${anteriores.slice(0, 5).map((h) => `${h.tipo} ${h.inicio} → ${h.fin}`).join("; ")}${anteriores.length > 5 ? "…" : ""})`);
  }

  // Serie NUEVA, derivada de UNA sola fecha base
  const hoyN = differenceInYears(hoy, nueva) + 1;
  const serie = Array.from({ length: hoyN }, (_, i) => ({ ...periodoLaboral(nueva, i + 1), anioLaboral: i + 1 }));
  const completos = hoyN - 1;
  const filas: PeriodoBD[] = serie.map((p) => ({
    id: p.anioLaboral, anioLaboral: p.anioLaboral, inicio: aIso(p.inicio), fin: aIso(p.fin), otorgados: 15, disponibles: 15,
    estado: p.anioLaboral <= completos - MAX_PERIODOS_VIGENTES ? "Vencido" : "Vigente", consumidoDetalle: 0, consumos: [],
  }));
  const porAnio = new Map(filas.map((f) => [f.anioLaboral as number, f]));

  // Reaplicación CRONOLÓGICA de cada consumo (hecho histórico) con las reglas del registro histórico
  const acumulado = new Map<string, number>();
  for (const h of hechos) {
    if (!(h.consumido > 0)) { base.advertencias.push(`La ${h.tipo} ${h.inicio} → ${h.fin} no tiene detalle de consumo FIFO: se conserva sin consumir saldo.`); continue; }
    const plan = planificarConsumoHistorico({ base: nueva, hoy, inicio: h.inicio, fin: h.fin, dias: h.consumido, feriados: e.feriados, periodos: filas });
    if (plan.bloqueos.length) { base.bloqueos.push({ codigo: "DEFICIT_AL_REBASAR", mensaje: `La ${h.tipo} ${h.inicio} → ${h.fin} no se puede reubicar en la nueva serie: ${plan.bloqueos.map((b) => b.mensaje).join(" ")}` }); continue; }
    if (plan.deficit > 0) {
      base.bloqueos.push({ codigo: "DEFICIT_AL_REBASAR", mensaje: `Con la nueva fecha de contratación la ${h.tipo} ${h.inicio} → ${h.fin} (${h.consumido} día(s) consumidos) no tiene saldo suficiente en su fecha: faltan ${plan.deficit} día(s). Revise el historial antes de continuar.` });
      continue;
    }
    const tramos: { anioLaboral: number; dias: number }[] = [];
    for (const t of plan.tramos) for (const a of t.asignaciones) {
      const fila = porAnio.get(a.anioLaboral)!;
      fila.consumos.push({ incidenciaId: h.incidenciaId, fechaInicio: h.inicio, fechaFin: h.fin, dias: a.dias });
      fila.consumidoDetalle = r2(fila.consumidoDetalle + a.dias);
      const k = `${h.incidenciaId}|${a.anioLaboral}`;
      acumulado.set(k, r2((acumulado.get(k) ?? 0) + a.dias));
      tramos.push({ anioLaboral: a.anioLaboral, dias: a.dias });
    }
    if (plan.cruzaAniversario) base.advertencias.push(`La ${h.tipo} ${h.inicio} → ${h.fin} cruza un aniversario de la nueva serie (${plan.aniversarios.join(", ")}): se reparte por tramos con la lógica existente.`);
    base.reasignaciones.push({ incidenciaId: h.incidenciaId, inicio: h.inicio, fin: h.fin, dias: h.consumido, tramos });
  }
  if (base.bloqueos.length) return base;

  base.lineas = [...acumulado].map(([k, dias]) => { const [inc, anio] = k.split("|").map(Number); return { incidenciaId: inc, anioLaboral: anio, dias }; });

  // Estado ACTUAL de la serie nueva (proporcional, vencimiento y tope de 30) con el mismo motor, descontando TODO lo consumido
  const estados: EstadoPeriodo[] = serie.map((p) => ({ anioLaboral: p.anioLaboral, inicio: p.inicio, fin: p.fin, otorgados: 0, disponibles: 0, consumidos: 0, recortados: 0, perdidos: 0, vencido: false }));
  avanzarPeriodos(estados, hoy, (ps) => {
    for (const p of ps) p.disponibles = Math.max(0, r2(p.disponibles - (porAnio.get(p.anioLaboral)?.consumidoDetalle ?? 0)));
  });
  base.periodos = estados
    .filter((p) => p.otorgados > 0 || (porAnio.get(p.anioLaboral)?.consumidoDetalle ?? 0) > 0)
    .map((p) => ({
      anioLaboral: p.anioLaboral, inicio: aIso(p.inicio), fin: aIso(p.fin), otorgados: p.otorgados, consumidos: porAnio.get(p.anioLaboral)?.consumidoDetalle ?? 0,
      disponibles: p.disponibles, estado: p.vencido ? "Vencido" : "Vigente",
    }));
  base.saldoDespues = r2(base.periodos.filter((p) => p.estado === "Vigente").reduce((t, p) => t + p.disponibles, 0));
  return base;
}
