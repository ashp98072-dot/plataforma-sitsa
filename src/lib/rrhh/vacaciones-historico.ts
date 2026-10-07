import { createHash } from "node:crypto";
import { differenceInYears } from "date-fns";
import { MAX_PERIODOS_VIGENTES, aIso, deIso, fechaLaboralSospechosa, periodoLaboral } from "./vacaciones-periodos";
import { avanzarPeriodos, repartirDiasEnTramos, type EstadoPeriodo } from "./vacaciones-reconstruccion";

/**
 * RRHH VACACIONES — REGISTRO HISTÓRICO (módulo PURO: sin BD, sin red).
 *
 * Problema que resuelve: el registro FIFO normal (`registrarVacacionesFifoEnConexion`) solo consume períodos con `estado = 'Vigente'` y
 * `dias_disponibles > 0` AL DÍA DE HOY, así que una vacación de años anteriores (cuyo período hoy está Vencido, con 0 disponibles) no se
 * podía registrar. La regla del SALDO UTILIZABLE actual NO cambia (2 períodos completos + el en curso, tope de 30): esto solo permite
 * registrar el consumo de un período CONTRA EL SALDO QUE TENÍA EN LA FECHA DE LA VACACIÓN.
 *
 * Cómo se calcula la disponibilidad EN LA FECHA HISTÓRICA (sin segundo motor: reutiliza las primitivas del motor cronológico):
 *   1. Los períodos salen de `fecha_alta` (`periodoLaboral`), 15 días/año, proporcional del en curso (`calcularDiasAcumuladosProporcional`).
 *   2. `avanzarPeriodos(estados, fecha)` deja el estado de los períodos a esa fecha: solo los 2 períodos completos más recientes a esa fecha
 *      (+ el en curso) son utilizables (vencimiento) y se aplica el tope de 30 — ANTES del tope se descuenta lo ya consumido (detalle FIFO).
 *   3. Lo ya consumido contra cada período es la suma de `detalle_consumo_vacaciones` (histórico real), de manera conservadora (todo lo
 *      registrado contra ese período), y para un período que HOY sigue Vigente el libre nunca excede su `dias_disponibles` actual.
 *   4. FIFO por `anio_laboral` ascendente SOLO entre períodos ya iniciados a esa fecha: nunca se descuenta de períodos futuros.
 *   5. Si la vacación cruza un aniversario se parte en TRAMOS con la misma función de la reconstrucción (`repartirDiasEnTramos`) y cada
 *      tramo se evalúa a su propia fecha; eso queda como DECISION visible (no se inventan reglas nuevas).
 *   6. Si en la fecha no había saldo suficiente: déficit (nada se inventa) y DECISION explícita de RRHH para poder guardarlo.
 */

export type PeriodoBD = {
  id: number;
  anioLaboral: number | null;
  inicio: string;
  fin: string;
  otorgados: number;
  disponibles: number;
  estado: string;
  /** Suma de detalle_consumo_vacaciones contra este período. */
  consumidoDetalle: number;
};

export type CodigoBloqueoHistorico =
  | "FECHA_ALTA_AUSENTE"
  | "FECHA_ALTA_SOSPECHOSA"
  | "FECHA_ALTA_FUTURA"
  | "ANTERIOR_A_FECHA_ALTA"
  | "DATOS_INVALIDOS"
  | "PERIODO_INEXISTENTE"
  | "ESTRUCTURA_CONGELADA"
  | "SUPERPOSICION";
export type BloqueoHistorico = { codigo: CodigoBloqueoHistorico; mensaje: string };

export type CodigoDecisionHistorica = "VACACION_CRUZA_ANIVERSARIO" | "SALDO_INSUFICIENTE_HISTORICO";
export type DecisionHistorica = { codigo: CodigoDecisionHistorica; mensaje: string };

export type AsignacionHistorica = {
  /** null solo en la vista previa cuando el período aún no existe en BD (se genera al guardar). */
  saldoId: number | null;
  anioLaboral: number;
  periodoInicio: string;
  periodoFin: string;
  dias: number;
  /** Estado del período HOY (Vigente | Vencido). */
  estadoHoy: string;
  /** Saldo libre del período en la fecha del tramo, antes de este consumo. */
  libreAntes: number;
};

export type TramoHistorico = {
  desde: string;
  hasta: string;
  /** Fecha a la que se evaluó la disponibilidad (inicio del tramo, acotada a hoy). */
  fechaEvaluacion: string;
  dias: number;
  asignaciones: AsignacionHistorica[];
  deficit: number;
  /** Saldo libre de cada período utilizable a esa fecha (para mostrar «saldo histórico disponible», no el de hoy). */
  disponiblePorPeriodo: { anioLaboral: number; periodoInicio: string; periodoFin: string; estadoHoy: string; libre: number }[];
};

export type PlanHistorico = {
  esHistorico: boolean;
  /** Período laboral al que pertenece la fecha de inicio y su estado HOY. */
  periodoInicio: { anioLaboral: number; inicio: string; fin: string; estadoHoy: string } | null;
  bloqueos: BloqueoHistorico[];
  tramos: TramoHistorico[];
  cruzaAniversario: boolean;
  aniversarios: string[];
  dias: number;
  diasAsignados: number;
  deficit: number;
  decisiones: DecisionHistorica[];
  requiereDecision: boolean;
  /** SHA-256 de la propuesta exacta (tramos, períodos y días): la decisión de RRHH queda atada a ella. */
  huella: string;
  advertencias: string[];
  /** Años laborales que deberían existir en saldos_vacaciones y no existen. */
  faltantes: number[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const cero = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Estado de un período HOY: el de la BD si existe; si no, el que el vencimiento le daría (solo los 2 completos más recientes son Vigentes). */
function estadoHoyDe(n: number, hoyN: number, fila: PeriodoBD | undefined): string {
  if (fila) return fila.estado;
  const completos = hoyN - 1;
  return n <= completos - MAX_PERIODOS_VIGENTES ? "Vencido" : "Vigente";
}

/** ¿La fecha de inicio cae en un período que HOY está Vencido? (= «Registro histórico»). Las fechas futuras o anteriores a la fecha base no lo son. */
export function clasificarRegistro(base: Date, hoyEntrada: Date, inicioIso: string, periodos: readonly PeriodoBD[]): { esHistorico: boolean; anioLaboral: number | null; estadoHoy: string | null } {
  const hoy = cero(hoyEntrada);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicioIso)) return { esHistorico: false, anioLaboral: null, estadoHoy: null };
  const inicio = deIso(inicioIso);
  if (Number.isNaN(inicio.getTime()) || inicio < base || inicio > hoy) return { esHistorico: false, anioLaboral: null, estadoHoy: null };
  const n = differenceInYears(inicio, base) + 1;
  const hoyN = differenceInYears(hoy, base) + 1;
  const estadoHoy = estadoHoyDe(n, hoyN, periodos.find((p) => p.anioLaboral === n));
  return { esHistorico: estadoHoy === "Vencido", anioLaboral: n, estadoHoy };
}

export type EntradaHistorica = {
  base: Date | null;
  hoy: Date;
  inicio: string;
  fin: string;
  dias: number;
  feriados: ReadonlySet<string>;
  periodos: readonly PeriodoBD[];
};

export function planificarConsumoHistorico(e: EntradaHistorica): PlanHistorico {
  const hoy = cero(e.hoy);
  const vacio = (bloqueos: BloqueoHistorico[]): PlanHistorico => ({
    esHistorico: false, periodoInicio: null, bloqueos, tramos: [], cruzaAniversario: false, aniversarios: [], dias: e.dias, diasAsignados: 0, deficit: 0,
    decisiones: [], requiereDecision: false, huella: sha(JSON.stringify([e.inicio, e.fin, e.dias, bloqueos.map((b) => b.codigo)])), advertencias: [], faltantes: [],
  });
  const f = /^\d{4}-\d{2}-\d{2}$/;
  if (!f.test(e.inicio) || !f.test(e.fin) || e.fin < e.inicio || !(e.dias > 0)) return vacio([{ codigo: "DATOS_INVALIDOS", mensaje: "Fechas o días inválidos (el fin no puede ser anterior al inicio y los días deben ser mayores que cero)." }]);
  if (!e.base) return vacio([{ codigo: "FECHA_ALTA_AUSENTE", mensaje: "El colaborador no tiene fecha de alta: no hay base para calcular sus períodos." }]);
  const base = cero(e.base);
  if (fechaLaboralSospechosa(base)) return vacio([{ codigo: "FECHA_ALTA_SOSPECHOSA", mensaje: "La fecha de alta es inválida o anterior a 1980: RRHH debe corregirla antes de registrar vacaciones históricas." }]);
  if (base > hoy) return vacio([{ codigo: "FECHA_ALTA_FUTURA", mensaje: "La fecha de alta es posterior a hoy: no hay períodos que consumir." }]);
  const inicio = deIso(e.inicio), fin = deIso(e.fin);
  if (inicio < base) return vacio([{ codigo: "ANTERIOR_A_FECHA_ALTA", mensaje: `La vacación empieza (${e.inicio}) antes de la fecha de alta (${aIso(base)}): no se puede registrar.` }]);

  const aniosCompletos = differenceInYears(hoy, base);
  const hoyN = aniosCompletos + 1;
  const serie = Array.from({ length: hoyN }, (_, i) => ({ ...periodoLaboral(base, i + 1), anioLaboral: i + 1 }));
  const filas = new Map(e.periodos.filter((p) => p.anioLaboral != null).map((p) => [p.anioLaboral as number, p]));
  const cls = clasificarRegistro(base, hoy, e.inicio, e.periodos);
  const anioIni = differenceInYears(inicio, base) + 1;
  const pIni = serie.find((p) => p.anioLaboral === anioIni);
  const periodoInicio = pIni ? { anioLaboral: anioIni, inicio: aIso(pIni.inicio), fin: aIso(pIni.fin), estadoHoy: estadoHoyDe(anioIni, hoyN, filas.get(anioIni)) } : null;

  const { cortes, tramos: repartidos } = repartirDiasEnTramos(serie.map((p) => p.inicio), inicio, fin, e.dias, e.feriados);
  const consumidoExtra = new Map<number, number>();
  const advertencias: string[] = [];
  const faltantes = new Set<number>();
  const tramos: TramoHistorico[] = [];
  let deficitTotal = 0, asignadoTotal = 0;

  for (const t of repartidos) {
    if (t.asignados <= 0) continue;
    const fecha = t.desde > hoy ? hoy : t.desde;
    const estados: EstadoPeriodo[] = serie.map((p) => ({ anioLaboral: p.anioLaboral, inicio: p.inicio, fin: p.fin, otorgados: 0, disponibles: 0, consumidos: 0, recortados: 0, perdidos: 0, vencido: false }));
    // Estado de los períodos a ESA fecha (acumulación, vencimiento y tope); lo ya consumido se descuenta antes del tope.
    avanzarPeriodos(estados, fecha, (ps) => {
      for (const p of ps) {
        const gastado = (filas.get(p.anioLaboral)?.consumidoDetalle ?? 0) + (consumidoExtra.get(p.anioLaboral) ?? 0);
        p.disponibles = Math.max(0, r2(p.disponibles - gastado));
      }
    });
    const libre = (p: EstadoPeriodo): number => {
      const fila = filas.get(p.anioLaboral);
      // Un período que HOY sigue Vigente nunca puede dar más de lo que tiene hoy (tope/recortes ya aplicados); uno Vencido hoy se evalúa a la fecha.
      if (fila && fila.estado === "Vigente") return Math.min(p.disponibles, Math.max(0, r2(fila.disponibles - (consumidoExtra.get(p.anioLaboral) ?? 0))));
      return p.disponibles;
    };
    const usables = estados.filter((p) => !p.vencido && fecha >= p.inicio).sort((a, b) => a.anioLaboral - b.anioLaboral);
    const disponiblePorPeriodo = usables.map((p) => ({ anioLaboral: p.anioLaboral, periodoInicio: aIso(p.inicio), periodoFin: aIso(p.fin), estadoHoy: estadoHoyDe(p.anioLaboral, hoyN, filas.get(p.anioLaboral)), libre: r2(libre(p)) }));
    let resto = t.asignados;
    const asignaciones: AsignacionHistorica[] = [];
    for (const p of usables) {
      if (resto <= 0) break;
      const l = libre(p);
      const tomar = r2(Math.min(l, resto));
      if (tomar <= 0) continue;
      const fila = filas.get(p.anioLaboral);
      if (!fila) faltantes.add(p.anioLaboral);
      asignaciones.push({ saldoId: fila?.id ?? null, anioLaboral: p.anioLaboral, periodoInicio: aIso(p.inicio), periodoFin: aIso(p.fin), dias: tomar, estadoHoy: estadoHoyDe(p.anioLaboral, hoyN, fila), libreAntes: r2(l) });
      consumidoExtra.set(p.anioLaboral, r2((consumidoExtra.get(p.anioLaboral) ?? 0) + tomar));
      resto = r2(resto - tomar);
    }
    deficitTotal = r2(deficitTotal + resto);
    asignadoTotal = r2(asignadoTotal + (t.asignados - resto));
    tramos.push({ desde: aIso(t.desde), hasta: aIso(t.hasta), fechaEvaluacion: aIso(fecha), dias: t.asignados, asignaciones, deficit: resto, disponiblePorPeriodo });
  }

  const decisiones: DecisionHistorica[] = [];
  const detalle = tramos.map((t) => `${t.desde}→${t.hasta} (${t.dias} d.): ${t.asignaciones.length ? t.asignaciones.map((a) => `año ${a.anioLaboral}: ${a.dias}`).join(", ") : "sin saldo"}${t.deficit > 0 ? ` [faltan ${t.deficit}]` : ""}`).join(" | ");
  if (cortes.length > 0) {
    decisiones.push({
      codigo: "VACACION_CRUZA_ANIVERSARIO",
      mensaje: `La vacación (${e.inicio} → ${e.fin}, ${e.dias} días) cruza ${cortes.length === 1 ? "un aniversario" : `${cortes.length} aniversarios`} (${cortes.map(aIso).join(", ")}). Reparto por fechas reales con FIFO sobre los períodos existentes en cada tramo: ${detalle}. RRHH debe confirmar esta distribución.`,
    });
  }
  if (deficitTotal > 0) {
    decisiones.push({
      codigo: "SALDO_INSUFICIENTE_HISTORICO",
      mensaje: `En la fecha de la vacación no había saldo suficiente: faltan ${deficitTotal} día(s) de ${e.dias}. No se descuenta de períodos que todavía no existían. Registrarla con déficit exige una decisión explícita de RRHH.`,
    });
  }
  if (cls.esHistorico && periodoInicio) {
    advertencias.push(`Registro histórico: el período ${periodoInicio.anioLaboral} (${periodoInicio.inicio} → ${periodoInicio.fin}) está ${periodoInicio.estadoHoy} hoy; se consume el saldo que tenía en la fecha de la vacación, no el saldo de hoy.`);
  }
  if (faltantes.size) advertencias.push(`Los períodos ${[...faltantes].join(", ")} aún no existen en el sistema y se generarán desde la fecha de alta al guardar.`);

  const huella = sha(JSON.stringify({ inicio: e.inicio, fin: e.fin, dias: e.dias, tramos: tramos.map((t) => [t.desde, t.hasta, t.dias, t.asignaciones.map((a) => [a.anioLaboral, a.dias])]), deficit: deficitTotal }));
  return {
    esHistorico: cls.esHistorico, periodoInicio, bloqueos: [], tramos, cruzaAniversario: cortes.length > 0, aniversarios: cortes.map(aIso), dias: e.dias,
    diasAsignados: asignadoTotal, deficit: deficitTotal, decisiones, requiereDecision: decisiones.length > 0, huella, advertencias, faltantes: [...faltantes].sort((a, b) => a - b),
  };
}
