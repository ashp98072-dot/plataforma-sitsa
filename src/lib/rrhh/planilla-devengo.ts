import { redondearQ } from "./contratos-pago";
import type { DevengoSnapshot } from "./planilla-conceptos";

/**
 * RRHH PLANILLAS — DEVENGO PROPORCIONAL por fecha de ingreso/egreso. Lógica PURA (sin BD), documentada.
 *
 * FECHAS LABORALES (decisión documentada):
 *  - inicioLaboral = `fecha_inicio_laboral` ("Fecha entrada laboral — cuando empieza a trabajar") y, si no existe,
 *    `fecha_alta` ("Fecha ingreso / contratación", base de vacaciones). Se paga desde que se EMPIEZA a trabajar; la
 *    contratación es el respaldo (misma fecha que ya usa el módulo de faltas).
 *  - finLaboral = `fecha_egreso` (si existe); sin egreso la relación continúa.
 *
 * CONVENCIÓN SALARIAL BASE 30 (mensual): el mes tiene SIEMPRE 30 días de sueldo, sea de 28, 29, 30 o 31 días calendario:
 *   valor diario = sueldoMensual / 30, y las fechas se cuentan con calendario comercial 30/360:
 *   el ÚLTIMO día del mes calendario (28/29/30/31) vale día 30 y el día 31 no suma un día extra. Así:
 *   Q1 (1–15) = 15 días · Q2 (16–fin de mes) = 15 días en TODOS los meses · Q1 + Q2 = 30 días = sueldo mensual exacto.
 *   Un empleado que ingresa el 07 de un mes de 30/31 días cobra 9 días en Q1 y 15 en Q2; en febrero (28 días), una
 *   persona que trabaja del 16 al 28 cobra 15 días (el mes completo sigue valiendo 30 días).
 *
 * `diasDevengados` = días de la base 30 dentro de la INTERSECCIÓN entre el período y la relación laboral.
 * Solo se prorratean los períodos QUINCENA_1 / QUINCENA_2 / MENSUAL; ESPECIAL e históricos (sin tipo) mantienen su
 * regla anterior (valor mensual completo) — no se tocan.
 */

export const BASE_DIAS_MES = 30;
export const DIAS_QUINCENA = 15;

export type TipoPeriodoDevengo = "QUINCENA_1" | "QUINCENA_2" | "MENSUAL" | "ESPECIAL" | null;

/** Ordinal comercial 30/360 de una fecha ISO (YYYY-MM-DD). El último día del mes calendario vale 30; el 31 vale 30. */
export function ordinalComercial(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Fecha inválida: ${iso}`);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const diaComercial = d >= ultimo ? 30 : Math.min(d, 30);
  return y * 360 + (m - 1) * 30 + diaComercial;
}

/** Días de la base 30 entre dos fechas ISO, ambas inclusivas (0 si desde > hasta). */
export function diasBase30(desde: string, hasta: string): number {
  if (desde > hasta) return 0;
  return ordinalComercial(hasta) - ordinalComercial(desde) + 1;
}

export type VigenciaLaboral = { inicioLaboral: string | null; finLaboral: string | null };
const dia = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);

/** ¿La relación laboral se solapa con el período? (inicio <= fin del período y (sin egreso o egreso >= inicio del período)). */
export function relacionSolapaPeriodo(v: VigenciaLaboral, periodoInicio: string, periodoFin: string): boolean {
  const ini = dia(v.inicioLaboral);
  const fin = dia(v.finLaboral);
  return (ini == null || ini <= periodoFin) && (fin == null || fin >= periodoInicio);
}

/**
 * ¿Entra en la planilla? Períodos prorrateables: Activo con relación solapada, o Baja CON fecha de egreso dentro/después del
 * inicio del período (trabajó parte). Baja sin fecha de egreso no entra (no se puede saber cuánto trabajó). Otros períodos
 * (ESPECIAL / históricos): solo Activos, como siempre.
 */
export function empleadoEntraEnPeriodo(
  e: { estado: string } & VigenciaLaboral,
  periodo: { tipoPeriodo: TipoPeriodoDevengo; fechaInicio: string; fechaFin: string },
): boolean {
  if (!periodoProrrateable(periodo.tipoPeriodo)) return e.estado === "Activo";
  if (e.estado === "Baja" && !dia(e.finLaboral)) return false;
  if (e.estado !== "Activo" && e.estado !== "Baja") return false;
  return relacionSolapaPeriodo(e, periodo.fechaInicio, periodo.fechaFin);
}

export const periodoProrrateable = (t: TipoPeriodoDevengo) => t === "QUINCENA_1" || t === "QUINCENA_2" || t === "MENSUAL";

export type DevengoPeriodo = {
  inicioLaboral: string | null;
  finLaboral: string | null;
  inicioDevengo: string | null;
  finDevengo: string | null;
  /** Días nominales del período en base 30: 15 por quincena, 30 por mes completo. */
  diasPeriodoNominales: number;
  diasDevengados: number;
  baseDiasMensual: 30;
  prorrateado: boolean;
};

/** Intersección relación laboral ∩ período y sus días en base 30. */
export function calcularDevengoPeriodo(
  periodo: { tipoPeriodo: TipoPeriodoDevengo; fechaInicio: string; fechaFin: string },
  vigencia: VigenciaLaboral,
): DevengoPeriodo {
  const ini = dia(vigencia.inicioLaboral);
  const fin = dia(vigencia.finLaboral);
  const prorrateable = periodoProrrateable(periodo.tipoPeriodo);
  const diasComercialesPeriodo = diasBase30(periodo.fechaInicio, periodo.fechaFin);
  // Nominales: 15 por quincena, 30 por mes. Con un corte quincenal distinto de 15 se re-escala para que Q1+Q2 = 30.
  const nominales = periodo.tipoPeriodo === "MENSUAL" ? BASE_DIAS_MES : DIAS_QUINCENA;
  if (!prorrateable) {
    return { inicioLaboral: ini, finLaboral: fin, inicioDevengo: periodo.fechaInicio, finDevengo: periodo.fechaFin, diasPeriodoNominales: nominales, diasDevengados: nominales, baseDiasMensual: 30, prorrateado: false };
  }
  const inicioDevengo = ini && ini > periodo.fechaInicio ? ini : periodo.fechaInicio;
  const finDevengo = fin && fin < periodo.fechaFin ? fin : periodo.fechaFin;
  const comerciales = diasBase30(inicioDevengo, finDevengo);
  const dias = comerciales <= 0 || diasComercialesPeriodo <= 0
    ? 0
    : Math.round(Math.min(nominales, (nominales * comerciales) / diasComercialesPeriodo) * 100) / 100;
  return {
    inicioLaboral: ini, finLaboral: fin,
    inicioDevengo: dias > 0 ? inicioDevengo : null, finDevengo: dias > 0 ? finDevengo : null,
    diasPeriodoNominales: nominales, diasDevengados: dias, baseDiasMensual: 30, prorrateado: true,
  };
}

/** Importe mensual contractual × días / 30 (redondeo monetario del sistema). */
export const importePorDias = (mensual: number, dias: number): number => redondearQ((mensual * dias) / BASE_DIAS_MES);

/**
 * Reparto de un concepto mensual entre las dos quincenas, sin que Q1 + Q2 supere el mes real devengado:
 *  - total del mes = mensual × (dQ1 + dQ2) / 30 (redondeado una sola vez)
 *  - Q1 = total × dQ1 / (dQ1 + dQ2)  (mes completo: exactamente la mitad, igual que siempre)
 *  - Q2 = total − lo que Q1 REALMENTE tiene persistido (si Q1 existe) → Q1 + Q2 cuadra exacto con el mes;
 *         si Q1 no existe para esa persona: total × dQ2 / (dQ1 + dQ2).
 * `mensualBase` es el importe mensual (para IGSS: sueldo × porcentaje SIN redondear antes).
 */
export function repartirConceptoMensual(args: {
  mensualBase: number;
  diasQ1: number;
  diasQ2: number;
  quincena: 1 | 2;
  q1Persistido?: number | null;
}): number {
  const { mensualBase, diasQ1, diasQ2, quincena, q1Persistido } = args;
  const diasMes = diasQ1 + diasQ2;
  if (diasMes <= 0) return 0;
  const totalMes = importePorDias(mensualBase, diasMes);
  if (quincena === 1) return redondearQ((totalMes * diasQ1) / diasMes);
  if (q1Persistido != null) return redondearQ(totalMes - q1Persistido);
  return redondearQ((totalMes * diasQ2) / diasMes);
}

/** Días base 30 que la relación laboral devenga dentro de UN mes calendario (para proyecciones fiscales). */
export function diasBase30EnMes(anio: number, mes: number, v: VigenciaLaboral): number {
  const mm = String(mes).padStart(2, "0");
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desdeMes = `${anio}-${mm}-01`;
  const hastaMes = `${anio}-${mm}-${String(ultimo).padStart(2, "0")}`;
  const ini = dia(v.inicioLaboral);
  const fin = dia(v.finLaboral);
  const desde = ini && ini > desdeMes ? ini : desdeMes;
  const hasta = fin && fin < hastaMes ? fin : hastaMes;
  return Math.min(BASE_DIAS_MES, diasBase30(desde, hasta));
}

/**
 * Bloque `conceptos_snapshot.devengo` de UNA línea. Se usa TANTO al generar como al autorizar (misma función, mismos redondeos),
 * para que al autorizar se pueda recalcular con los datos ACTUALES del empleado y detectar cualquier cambio.
 */
export function construirDevengoSnapshot(a: {
  periodo: { tipoPeriodo: TipoPeriodoDevengo; fechaInicio: string; fechaFin: string };
  vigencia: VigenciaLaboral;
  estadoEmpleado: string;
  sueldoMensual: number;
  bonoIncentivoMensual: number;
  bonoHerramientasMensual: number;
  sueldoPeriodo: number;
  bonoIncentivoPeriodo: number;
  bonoHerramientasPeriodo: number;
}): DevengoSnapshot {
  const d = calcularDevengoPeriodo(a.periodo, a.vigencia);
  return {
    estadoEmpleado: a.estadoEmpleado,
    fechaInicioLaboral: d.inicioLaboral,
    fechaEgreso: d.finLaboral,
    inicioDevengo: d.inicioDevengo,
    finDevengo: d.finDevengo,
    diasPeriodoNominales: d.diasPeriodoNominales,
    diasDevengados: d.prorrateado ? d.diasDevengados : d.diasPeriodoNominales,
    baseDiasMensual: BASE_DIAS_MES,
    prorrateado: d.prorrateado,
    sueldoMensual: a.sueldoMensual,
    salarioDiario: Math.round((a.sueldoMensual / BASE_DIAS_MES) * 10000) / 10000,
    sueldoPeriodo: a.sueldoPeriodo,
    bonoIncentivoMensual: a.bonoIncentivoMensual,
    bonoIncentivoPeriodo: a.bonoIncentivoPeriodo,
    bonoHerramientasMensual: a.bonoHerramientasMensual,
    bonoHerramientasPeriodo: a.bonoHerramientasPeriodo,
  };
}

export const MSG_DEVENGO_CAMBIO = "La relación laboral o el cálculo de devengo cambió. Regenera la planilla antes de autorizar.";

const CAMPOS_DEVENGO: (keyof DevengoSnapshot)[] = [
  "estadoEmpleado", "fechaInicioLaboral", "fechaEgreso", "inicioDevengo", "finDevengo", "diasPeriodoNominales", "diasDevengados",
  "baseDiasMensual", "prorrateado", "sueldoMensual", "salarioDiario", "sueldoPeriodo", "bonoIncentivoMensual", "bonoIncentivoPeriodo",
  "bonoHerramientasMensual", "bonoHerramientasPeriodo",
];

/** Campos del devengo guardado que ya no coinciden con el recalculado con los datos actuales (vacío = sin cambios). */
export function camposDevengoCambiados(guardado: DevengoSnapshot, actual: DevengoSnapshot): string[] {
  return CAMPOS_DEVENGO.filter((c) => guardado[c] !== actual[c]) as string[];
}

export type DevengoVisible = {
  fechaInicioLaboral: string | null;
  fechaEgreso: string | null;
  diasDevengados: number;
  diasPeriodoNominales: number;
  prorrateado: boolean;
};
const dma = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Texto para la tabla de planillas: días pagados y badges "Ingreso dd/mm/aaaa" / "Baja dd/mm/aaaa" (solo si caen en el período). */
export function resumenDevengoUi(d: DevengoVisible | null | undefined, periodo: { fechaInicio: string; fechaFin: string }) {
  if (!d) return { dias: "—", ingreso: null as string | null, baja: null as string | null, titulo: "" };
  const ingreso = d.fechaInicioLaboral && d.fechaInicioLaboral > periodo.fechaInicio && d.fechaInicioLaboral <= periodo.fechaFin ? `Ingreso ${dma(d.fechaInicioLaboral)}` : null;
  const baja = d.fechaEgreso && d.fechaEgreso >= periodo.fechaInicio && d.fechaEgreso <= periodo.fechaFin ? `Baja ${dma(d.fechaEgreso)}` : null;
  const dias = Number.isInteger(d.diasDevengados) ? String(d.diasDevengados) : d.diasDevengados.toFixed(2);
  return {
    dias,
    ingreso,
    baja,
    titulo: d.prorrateado ? `${dias} de ${d.diasPeriodoNominales} días del período (base 30 días/mes)` : "Período sin prorrateo (valor mensual completo)",
  };
}

const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Rangos de las DOS quincenas del mes de un período de quincena, derivados de sus propias fechas (respeta un corte
 * quincenal distinto de 15): Q1 = día 1 → corte, Q2 = corte+1 → fin de mes.
 */
export function quincenasDelMes(periodo: { tipoPeriodo: "QUINCENA_1" | "QUINCENA_2"; fechaInicio: string; fechaFin: string }): {
  q1: { fechaInicio: string; fechaFin: string };
  q2: { fechaInicio: string; fechaFin: string };
} {
  if (periodo.tipoPeriodo === "QUINCENA_1") {
    const [y, m] = periodo.fechaInicio.split("-").map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      q1: { fechaInicio: periodo.fechaInicio, fechaFin: periodo.fechaFin },
      q2: { fechaInicio: sumarDias(periodo.fechaFin, 1), fechaFin: `${y}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}` },
    };
  }
  const [y, m] = periodo.fechaInicio.split("-").map(Number);
  return {
    q1: { fechaInicio: `${y}-${String(m).padStart(2, "0")}-01`, fechaFin: sumarDias(periodo.fechaInicio, -1) },
    q2: { fechaInicio: periodo.fechaInicio, fechaFin: periodo.fechaFin },
  };
}

/** Días devengados por quincena (Q1 y Q2 del mes) de una relación laboral. */
export function diasDevengadosQuincenas(
  periodo: { tipoPeriodo: "QUINCENA_1" | "QUINCENA_2"; fechaInicio: string; fechaFin: string },
  vigencia: VigenciaLaboral,
): { diasQ1: number; diasQ2: number } {
  const { q1, q2 } = quincenasDelMes(periodo);
  return {
    diasQ1: calcularDevengoPeriodo({ tipoPeriodo: "QUINCENA_1", ...q1 }, vigencia).diasDevengados,
    diasQ2: calcularDevengoPeriodo({ tipoPeriodo: "QUINCENA_2", ...q2 }, vigencia).diasDevengados,
  };
}
