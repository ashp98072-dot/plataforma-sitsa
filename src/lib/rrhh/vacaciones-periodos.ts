import { addYears, differenceInCalendarDays, differenceInYears, format, parseISO, subDays } from "date-fns";

/**
 * RRHH VACACIONES — HISTORIAL COMPLETO Y PERÍODOS SIN TRASLAPE (módulo PURO: sin BD ni red).
 *
 * Reglas de fechas (INCLUSIVAS en ambos extremos):
 *   período n  = [ base + (n-1) años , base + n años − 1 día ]
 *   inicio(n+1) = fin(n) + 1 día        → un período empieza EXACTAMENTE el día después de que termina el anterior.
 * Cada límite se calcula DESDE LA FECHA BASE (nunca encadenando el anterior), así no hay deriva. Ejemplos:
 *   base 2024-10-31 → 2024-10-31 → 2025-10-30 · 2025-10-31 → 2026-10-30
 *   base 2020-02-29 (bisiesto) → 2020-02-29 → 2021-02-27 · 2021-02-28 → 2022-02-27 · … · 2024-02-29 → 2025-02-27
 *   (date-fns lleva el 29 de febrero al 28 en años no bisiestos; la regla `inicio(n+1) = fin(n)+1` se mantiene siempre.)
 */

export const DIAS_POR_PERIODO = 15;
/** Tope legal vigente: como máximo 2 períodos completos utilizables (30 días). Es el saldo UTILIZABLE, no el historial. */
export const MAX_PERIODOS_VIGENTES = 2;
/** Una fecha laboral anterior a esta se considera sospechosa (error de captura): el motor NO genera períodos; solo se reporta. */
export const FECHA_LABORAL_MINIMA_PLAUSIBLE = "1980-01-01";

export const aIso = (d: Date): string => format(d, "yyyy-MM-dd");
export const deIso = (s: string): Date => parseISO(String(s).slice(0, 10));

export type RangoPeriodo = { inicio: Date; fin: Date };
export type PeriodoLaboral = RangoPeriodo & { anioLaboral: number };

export function periodoLaboral(base: Date, anioLaboral: number): PeriodoLaboral {
  return { anioLaboral, inicio: addYears(base, anioLaboral - 1), fin: subDays(addYears(base, anioLaboral), 1) };
}

export function fechaLaboralSospechosa(base: Date | null | undefined): boolean {
  if (!base || Number.isNaN(base.getTime())) return true;
  return base < deIso(FECHA_LABORAL_MINIMA_PLAUSIBLE);
}

/** Días calendario compartidos entre dos rangos inclusivos (0 si no se tocan). */
export function diasSuperposicion(a: RangoPeriodo, b: RangoPeriodo): number {
  const inicio = a.inicio > b.inicio ? a.inicio : b.inicio;
  const fin = a.fin < b.fin ? a.fin : b.fin;
  return Math.max(0, differenceInCalendarDays(fin, inicio) + 1);
}

export type TipoTraslape = "NINGUNO" | "BORDE" | "REAL";
/**
 * BORDE = se tocan únicamente por compartir la fecha límite (1 día: el fin de uno es el inicio del otro).
 * REAL  = se superponen más de un día.
 */
export function clasificarTraslape(a: RangoPeriodo, b: RangoPeriodo): { tipo: TipoTraslape; dias: number } {
  const dias = diasSuperposicion(a, b);
  if (dias === 0) return { tipo: "NINGUNO", dias };
  const soloLimite = dias === 1 && (aIso(a.fin) === aIso(b.inicio) || aIso(b.fin) === aIso(a.inicio));
  return { tipo: soloLimite ? "BORDE" : "REAL", dias };
}

export type FilaSaldo = {
  id: number;
  anioLaboral: number | null;
  inicio: string;
  fin: string;
  otorgados: number;
  disponibles: number;
  estado: string;
  /** true si algún detalle FIFO (detalle_consumo_vacaciones) apunta a este saldo. */
  conConsumo: boolean;
};

export type CodigoAdvertencia =
  // BLOQUEANTES: el empleado queda congelado (REQUIERE_REPARACION_ADMINISTRADA): el motor no escribe NADA.
  | "FECHA_LABORAL_SOSPECHOSA"
  | "SERIE_HISTORICA_CON_CONSUMO"
  | "ANIO_LABORAL_DUPLICADO"
  | "ANIO_LABORAL_NULO_EN_SERIE"
  | "TRASLAPE_REAL_EXISTENTE"
  // INFORMATIVAS: no impiden sincronizar.
  | "ANIO_LABORAL_NULO"
  | "REALINEACION_OMITIDA_POR_TRASLAPE"
  | "NUEVO_PERIODO_OMITIDO_POR_TRASLAPE"
  | "TRASLAPE_BORDE"
  | "TRASLAPE_REAL";

export type AdvertenciaPeriodos = {
  codigo: CodigoAdvertencia;
  mensaje: string;
  saldoId?: number;
  anioLaboral?: number | null;
  dias?: number;
  /** true = la advertencia impide toda escritura de sincronización para este empleado (requiere reparación administrada). */
  bloqueante?: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function contarDomingosEnRango(fechaInicio: Date, fechaFin: Date): number {
  if (fechaInicio > fechaFin) return 0;
  const weekdayPy = (fechaInicio.getDay() + 6) % 7;
  const diasHastaPrimerDomingo = (6 - weekdayPy) % 7;
  const primerDomingo = new Date(fechaInicio);
  primerDomingo.setDate(primerDomingo.getDate() + diasHastaPrimerDomingo);
  if (primerDomingo > fechaFin) return 0;
  const days = Math.floor((fechaFin.getTime() - primerDomingo.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(days / 7) + 1;
}

function diasLaborablesEnRango(fechaInicio: Date, fechaFin: Date): number {
  if (fechaInicio > fechaFin) return 0;
  const diasTotales = Math.floor((fechaFin.getTime() - fechaInicio.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return diasTotales - contarDomingosEnRango(fechaInicio, fechaFin);
}

/** Acumulación proporcional dentro del período en curso: MISMA fórmula histórica (movida aquí sin cambios; vacaciones.ts la re-exporta). */
export function calcularDiasAcumuladosProporcional(periodoInicio: Date, periodoFinTeorico: Date, hoy: Date, diasMeta: number): number {
  if (hoy < periodoInicio) return 0;
  const finTranscurrido = hoy < periodoFinTeorico ? hoy : periodoFinTeorico;
  const laborablesTranscurridos = diasLaborablesEnRango(periodoInicio, finTranscurrido);
  const laborablesCompleto = diasLaborablesEnRango(periodoInicio, periodoFinTeorico);
  if (laborablesCompleto <= 0) return 0;
  const acumulados = (diasMeta * laborablesTranscurridos) / laborablesCompleto;
  return Math.round(Math.min(acumulados, diasMeta) * 100) / 100;
}

/** Motivo por el que NO se sincroniza nada para un empleado. */
export type MotivoOmision = "FECHA_SOSPECHOSA" | "FECHA_FUTURA" | "SERIE_HISTORICA_CON_CONSUMO" | "ESTRUCTURA_INCONSISTENTE";

export type PlanSincronizacion = {
  omitido: MotivoOmision | null;
  /** true si el empleado queda en REQUIERE_REPARACION_ADMINISTRADA (fecha sospechosa, serie histórica con consumo o estructura inconsistente). */
  requiereReparacion: boolean;
  inserts: { anioLaboral: number; inicio: string; fin: string; otorgados: number }[];
  updates: { id: number; anioLaboral: number; inicio: string; fin: string; otorgados: number; disponibles: number; realineado: boolean }[];
  advertencias: AdvertenciaPeriodos[];
};

function plan0(): PlanSincronizacion {
  return { omitido: null, requiereReparacion: false, inserts: [], updates: [], advertencias: [] };
}

/**
 * Decide qué escribir para sincronizar los períodos de UN empleado, SIN tocar la BD. Es TODO O NADA: o se sincroniza la serie
 * completa con seguridad, o el empleado queda congelado (sin inserts, updates, vencimientos ni tope) hasta una reparación administrada.
 *
 * CONGELA (omitido + requiereReparacion + advertencias bloqueantes) cuando:
 *  1. La fecha laboral es sospechosa (< 1980 o inválida).
 *  2. SERIE HISTÓRICA CON CONSUMO: existe al menos un saldo con consumo FIFO cuyas fechas NO coinciden con las esperadas para su
 *     año laboral (o que no tiene año laboral, o cuyo año excede la serie esperada). Es la evidencia de que la fecha laboral cambió
 *     / la serie es incompatible: no se realinea nada, no se crean períodos, no se vence ni se aplica tope.
 *  3. Estructura que impide determinar UNA serie segura: año laboral duplicado, fila sin año que se superpone con la serie esperada,
 *     o traslape REAL (> 1 día) ya existente entre filas.
 *
 * NO congela: tener consumo con las fechas YA coincidentes con la serie esperada (crecimiento normal del historial), filas sin año
 * fuera de la serie (solo advertencia informativa) ni traslapes de BORDE de un día.
 *
 * Cuando NO congela:
 *  - Los períodos esperados salen siempre de la fecha base (sin traslape por construcción).
 *  - Un período NUEVO nunca se inserta si se superpone con cualquier fila existente.
 *  - Una fila SIN consumo se realinea solo si el rango nuevo no se superpone con otra fila. Filas Vencidas no se modifican.
 *  - Idempotente: sincronizar dos veces seguidas no produce escrituras nuevas (una fila sin cambios no genera UPDATE).
 */
export function planificarSincronizacion(
  base: Date,
  hoy: Date,
  existentes: FilaSaldo[],
  diasPorPeriodo = DIAS_POR_PERIODO,
): PlanSincronizacion {
  const plan = plan0();
  const congelar = (motivo: MotivoOmision, avisos: AdvertenciaPeriodos[]): PlanSincronizacion => {
    plan.omitido = motivo;
    plan.requiereReparacion = true;
    plan.inserts = [];
    plan.updates = [];
    plan.advertencias.push(...avisos.map((a) => ({ ...a, bloqueante: true })));
    return plan;
  };
  if (fechaLaboralSospechosa(base)) {
    return congelar("FECHA_SOSPECHOSA", [{ codigo: "FECHA_LABORAL_SOSPECHOSA", mensaje: "Fecha laboral inválida o anterior a 1980: no se generan períodos; requiere el dato real de RRHH." }]);
  }
  if (base > hoy) {
    plan.omitido = "FECHA_FUTURA";
    return plan;
  }

  const aniosCompletos = differenceInYears(hoy, base);
  const maxAnio = aniosCompletos + 1;
  const esperado = (n: number): PeriodoLaboral | null => (n >= 1 && n <= maxAnio ? periodoLaboral(base, n) : null);
  const coincide = (f: FilaSaldo): boolean => {
    if (f.anioLaboral == null) return false;
    const e = esperado(f.anioLaboral);
    return e != null && f.inicio === aIso(e.inicio) && f.fin === aIso(e.fin);
  };
  const rango = (f: FilaSaldo): RangoPeriodo => ({ inicio: deIso(f.inicio), fin: deIso(f.fin) });

  // 2) SERIE HISTÓRICA CON CONSUMO (cualquier estado, también Vencido): congelación total.
  const conflictos = existentes.filter((f) => f.conConsumo && !coincide(f));
  if (conflictos.length) {
    return congelar("SERIE_HISTORICA_CON_CONSUMO", [
      {
        codigo: "SERIE_HISTORICA_CON_CONSUMO",
        mensaje: "Los períodos históricos con consumo no coinciden con la fecha laboral actual. No se modificó ningún saldo; requiere reparación administrada.",
      },
      ...conflictos.map((f) => ({
        codigo: "SERIE_HISTORICA_CON_CONSUMO" as const,
        mensaje: `El saldo #${f.id} (año laboral ${f.anioLaboral ?? "sin año"}, ${f.inicio} → ${f.fin}) tiene consumo y no coincide con la serie esperada.`,
        saldoId: f.id, anioLaboral: f.anioLaboral,
      })),
    ]);
  }

  // 3) ESTRUCTURA que impide determinar una única serie segura
  const estructura: AdvertenciaPeriodos[] = [];
  const porAnio = new Map<number, FilaSaldo[]>();
  for (const f of existentes) if (f.anioLaboral != null) porAnio.set(f.anioLaboral, [...(porAnio.get(f.anioLaboral) ?? []), f]);
  for (const [anio, filas] of porAnio) {
    if (filas.length > 1) estructura.push({ codigo: "ANIO_LABORAL_DUPLICADO", mensaje: `El año laboral ${anio} tiene ${filas.length} saldos (#${filas.map((x) => x.id).join(", #")}).`, anioLaboral: anio });
  }
  const serieEsperada = Array.from({ length: maxAnio }, (_, i) => periodoLaboral(base, i + 1));
  for (const f of existentes) {
    if (f.anioLaboral != null) continue;
    if (serieEsperada.some((e) => diasSuperposicion(e, rango(f)) > 0)) {
      estructura.push({ codigo: "ANIO_LABORAL_NULO_EN_SERIE", mensaje: `El saldo #${f.id} no tiene año laboral y se superpone con la serie esperada.`, saldoId: f.id });
    } else {
      plan.advertencias.push({ codigo: "ANIO_LABORAL_NULO", mensaje: `El saldo #${f.id} no tiene año laboral y no participa en la sincronización.`, saldoId: f.id });
    }
  }
  const ordenadas = [...existentes].sort((x, y) => x.inicio.localeCompare(y.inicio) || x.id - y.id);
  for (let i = 0; i < ordenadas.length; i++) {
    for (let j = i + 1; j < ordenadas.length; j++) {
      const t = clasificarTraslape(rango(ordenadas[i]), rango(ordenadas[j]));
      if (t.tipo === "REAL") {
        estructura.push({ codigo: "TRASLAPE_REAL_EXISTENTE", mensaje: `Los saldos #${ordenadas[i].id} y #${ordenadas[j].id} se superponen ${t.dias} días.`, saldoId: ordenadas[j].id, dias: t.dias });
      }
    }
  }
  if (estructura.length) return congelar("ESTRUCTURA_INCONSISTENTE", estructura);

  // --- Serie segura: se sincroniza ---
  const seSuperpone = (r: RangoPeriodo, ignorarId: number | null) =>
    existentes.some((f) => f.id !== ignorarId && diasSuperposicion(r, rango(f)) > 0);

  for (let n = 1; n <= maxAnio; n++) {
    const esp = periodoLaboral(base, n);
    const esCompleto = n <= aniosCompletos;
    const otorgados = esCompleto ? diasPorPeriodo : calcularDiasAcumuladosProporcional(esp.inicio, esp.fin, hoy, diasPorPeriodo);
    const fila = porAnio.get(n)?.[0];
    if (!fila) {
      if (otorgados <= 0) continue;
      if (seSuperpone(esp, null)) {
        plan.advertencias.push({ codigo: "NUEVO_PERIODO_OMITIDO_POR_TRASLAPE", mensaje: `El período ${n} (${aIso(esp.inicio)} → ${aIso(esp.fin)}) se superpone con uno existente y no se creó.`, anioLaboral: n });
        continue;
      }
      plan.inserts.push({ anioLaboral: n, inicio: aIso(esp.inicio), fin: aIso(esp.fin), otorgados });
      continue;
    }
    if (fila.estado === "Vencido") continue;
    const igual = fila.inicio === aIso(esp.inicio) && fila.fin === aIso(esp.fin);
    // (Una fila con consumo y fechas distintas ya congeló todo arriba: aquí solo llegan filas sin consumo o coincidentes.)
    if (!igual && seSuperpone(esp, fila.id)) {
      plan.advertencias.push({ codigo: "REALINEACION_OMITIDA_POR_TRASLAPE", mensaje: `Realinear el período ${n} lo superpondría con otro: no se modificó.`, saldoId: fila.id, anioLaboral: n });
      continue;
    }
    const consumido = r2(fila.otorgados - fila.disponibles);
    const disponibles = r2(Math.max(otorgados - consumido, 0));
    // Idempotencia real: si nada cambia no se escribe (sincronizar dos veces seguidas no genera escrituras).
    if (igual && fila.otorgados === otorgados && fila.disponibles === disponibles) continue;
    plan.updates.push({ id: fila.id, anioLaboral: n, inicio: aIso(esp.inicio), fin: aIso(esp.fin), otorgados, disponibles, realineado: !igual });
  }
  return plan;
}

/** Traslapes entre TODAS las filas de un empleado (historial): pares con su tipo y días. Pura. */
export function analizarTraslapes(filas: FilaSaldo[]): AdvertenciaPeriodos[] {
  const salida: AdvertenciaPeriodos[] = [];
  const orden = [...filas].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id - b.id);
  for (let i = 0; i < orden.length; i++) {
    for (let j = i + 1; j < orden.length; j++) {
      const { tipo, dias } = clasificarTraslape({ inicio: deIso(orden[i].inicio), fin: deIso(orden[i].fin) }, { inicio: deIso(orden[j].inicio), fin: deIso(orden[j].fin) });
      if (tipo === "NINGUNO") continue;
      salida.push({
        codigo: tipo === "BORDE" ? "TRASLAPE_BORDE" : "TRASLAPE_REAL",
        mensaje: `Los saldos #${orden[i].id} y #${orden[j].id} se ${tipo === "BORDE" ? "tocan solo en la fecha límite" : `superponen ${dias} días`}.`,
        saldoId: orden[j].id, dias,
      });
    }
  }
  return salida;
}

/** Estado visible de un período en el historial. */
export type EstadoVisualPeriodo = "En curso" | "Vigente" | "Consumido" | "Vencido";
export function estadoVisualPeriodo(p: { estado: string; anioLaboral: number | null; disponibles: number; consumidos: number }, anioEnCurso: number | null): EstadoVisualPeriodo {
  if (p.estado === "Vencido") return "Vencido";
  if (anioEnCurso != null && p.anioLaboral === anioEnCurso) return "En curso";
  if (p.disponibles <= 0 && p.consumidos > 0) return "Consumido";
  return "Vigente";
}
