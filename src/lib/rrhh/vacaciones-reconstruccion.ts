import {
  DIAS_POR_PERIODO,
  MAX_PERIODOS_VIGENTES,
  aIso,
  calcularDiasAcumuladosProporcional,
  deIso,
  diasSuperposicion,
  fechaLaboralSospechosa,
  periodoLaboral,
} from "./vacaciones-periodos";
import { differenceInYears } from "date-fns";

/**
 * RRHH VACACIONES — RECONSTRUCCIÓN EN MEMORIA DESDE EL HISTORIAL OFICIAL (módulo PURO: sin BD, sin red, sin escrituras).
 *
 * Recibe un empleado (con su fecha base = `fecha_alta`) y TODO su historial de vacaciones y produce, sin depender de las filas viejas
 * (ni de `saldos_vacaciones`, ni de `detalle_consumo_vacaciones`, ni de las incidencias actuales):
 *   - los períodos laborales correctos (sin traslape), con los días otorgados;
 *   - la reaplicación CRONOLÓGICA de cada vacación con FIFO (qué saldo consume cada una);
 *   - vencimiento (solo los 2 períodos completos más recientes son utilizables) y tope de 30 días, con las MISMAS reglas del motor actual;
 *   - saldo final, períodos vencidos y advertencias.
 *
 * Supuestos explícitos (documentados en docs/RRHH-VACACIONES-RECONSTRUCCION.md):
 *   - Cada vacación consume saldo en su `fecha_inicio`: la disponibilidad se evalúa a esa fecha
 *     (períodos ya iniciados, acumulación proporcional del período en curso, vencimiento y tope vigentes a esa fecha).
 *   - VACACIÓN QUE CRUZA UN ANIVERSARIO: se reparte por TRAMOS con las fechas reales. Cada tramo (desde el inicio de la vacación hasta el
 *     día anterior al aniversario, y desde el aniversario en adelante) consume con FIFO (`anio_laboral` ASC) sobre los períodos que
 *     EXISTEN en la fecha de inicio del tramo; los días hábiles de cada tramo se cuentan con la misma regla del módulo (sin domingos ni
 *     feriados). El reparto es PROVISIONAL: se emite VACACION_CRUZA_ANIVERSARIO (DECISION) con el detalle para que RRHH lo confirme.
 *   - Orden: `fecha_inicio` ASC y, como desempate, el orden de origen (fila del archivo) ASC.
 *   - El archivo oficial contiene SOLO vacaciones YA TOMADAS: una vacación con `fecha_inicio` > hoy es un ERROR (VACACION_FUTURA); NO consume
 *     saldo, no genera FIFO y no reduce el saldo simulado (queda visible en el reporte con `excluida = "VACACION_FUTURA"`).
 *   - VACACIONES SUPERPUESTAS: el estado interno de la simulación solo avanza hacia adelante, así que con filas superpuestas el FIFO no
 *     representaría fielmente la cronología. Se detectan ANTES de reaplicar; el empleado queda `bloqueado = "VACACIONES_SUPERPUESTAS"`
 *     (sin simulación ni saldo) y cada par es un ERROR. No se inventa ninguna prioridad entre vacaciones superpuestas.
 *   - Si no hay saldo suficiente a esa fecha, la vacación NO se descarta (el historial oficial es la verdad): consume lo disponible,
 *     el faltante queda como `deficit` y se emite la advertencia SALDO_INSUFICIENTE que requiere decisión de RRHH.
 *   - Una vacación histórica nunca se descarta porque su período hoy esté vencido: se explica cronológicamente (consumió cuando estaba vigente).
 */

export { DIAS_POR_PERIODO, MAX_PERIODOS_VIGENTES };

export type EmpleadoReconstruccion = {
  id: number;
  codigo: string;
  nombre: string;
  /** Base de vacaciones (regla vigente): `empleados.fecha_alta`, "YYYY-MM-DD" o null. */
  fechaAlta: string | null;
  /** Solo informativo: NO se usa para vacaciones; si difiere de `fechaAlta` se advierte. */
  fechaInicioLaboral: string | null;
};

export type VacacionReconstruccion = {
  /** Orden/fila de origen (desempate cronológico y referencia en el reporte). */
  origen: number;
  inicio: string;
  fin: string;
  dias: number;
  tipo: string;
  observacion?: string | null;
};

export type SeveridadReconstruccion = "BLOQUEANTE" | "ERROR" | "DECISION" | "ADVERTENCIA" | "INFO";
export type CodigoReconstruccion =
  | "SIN_FECHA_BASE"
  | "FECHA_SOSPECHOSA"
  | "FECHA_FUTURA"
  | "FECHA_INICIO_LABORAL_DISTINTA"
  | "VACACION_ANTERIOR_A_FECHA_BASE"
  | "VACACION_FUTURA"
  | "VACACION_CRUZA_ANIVERSARIO"
  | "VACACIONES_SUPERPUESTAS"
  | "REPARTO_MANUAL_APLICADO"
  | "SALDO_INSUFICIENTE";

export type AdvertenciaReconstruccion = { codigo: CodigoReconstruccion; severidad: SeveridadReconstruccion; mensaje: string; origen?: number; dias?: number };

export type PeriodoReconstruido = {
  anioLaboral: number;
  inicio: string;
  fin: string;
  otorgados: number;
  consumidos: number;
  /** Días recortados por el tope de 30 (se descuentan del período completo más viejo). */
  recortadosPorTope: number;
  /** Días sin tomar que se perdieron al vencer el período (solo los 2 períodos completos más recientes son utilizables). */
  perdidosPorVencimiento: number;
  disponibles: number;
  estado: "Vigente" | "Vencido";
  enCurso: boolean;
};

/** `fecha` = fecha a la que se evaluó la disponibilidad para ese consumo (inicio del tramo, o hoy si es futura). */
export type ConsumoReconstruido = { origen: number; anioLaboral: number; dias: number; fecha: string };

/** Desglose entre lo OTORGADO, lo CONSUMIDO, lo perdido y el saldo UTILIZABLE: otorgado = consumido + recortado + perdido + utilizable. */
export type ResumenDiasReconstruccion = { otorgado: number; consumido: number; recortadoPorTope: number; perdidoPorVencimiento: number; saldoUtilizable: number };

export type VacacionReconstruida = VacacionReconstruccion & {
  /** null = procesada; si no, motivo por el que no consume saldo. */
  excluida: "ANTERIOR_A_FECHA_BASE" | "VACACION_FUTURA" | "EMPLEADO_BLOQUEADO" | null;
  consumido: number;
  deficit: number;
};

export type ResultadoReconstruccion = {
  empleadoId: number;
  bloqueado: "SIN_FECHA_BASE" | "FECHA_SOSPECHOSA" | "FECHA_FUTURA" | "VACACIONES_SUPERPUESTAS" | null;
  periodos: PeriodoReconstruido[];
  consumos: ConsumoReconstruido[];
  vacaciones: VacacionReconstruida[];
  /** Σ de días de las vacaciones del historial (todas las válidas, hayan consumido saldo o no). */
  totalDiasHistorial: number;
  saldoFinal: number;
  resumenDias: ResumenDiasReconstruccion;
  advertencias: AdvertenciaReconstruccion[];
};

type Estado = {
  anioLaboral: number;
  inicio: Date;
  fin: Date;
  otorgados: number;
  disponibles: number;
  consumidos: number;
  recortados: number;
  perdidos: number;
  vencido: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const hoyCero = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Misma regla que `contarDiasHabiles` de vacaciones.ts: excluye domingos y feriados. Versión pura (feriados ya cargados). */
export function contarDiasHabilesPuro(inicio: string, fin: string, feriados: ReadonlySet<string>): number {
  const a = deIso(inicio), b = deIso(fin);
  if (a > b) return 0;
  let dias = 0;
  for (let d = new Date(a); d <= b; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (d.getDay() !== 0 && !feriados.has(aIso(d))) dias += 1;
  }
  return dias;
}

/** Avanza el estado de los períodos a `fecha`: acumulación proporcional, vencimiento (2 completos vigentes) y tope de 30. */
function avanzar(periodos: Estado[], fecha: Date): void {
  for (const p of periodos) {
    if (fecha < p.inicio) continue;
    const nuevo = fecha > p.fin ? DIAS_POR_PERIODO : calcularDiasAcumuladosProporcional(p.inicio, p.fin, fecha, DIAS_POR_PERIODO);
    if (nuevo > p.otorgados) {
      const delta = r2(nuevo - p.otorgados);
      p.otorgados = nuevo;
      if (!p.vencido) p.disponibles = r2(p.disponibles + delta);
    }
  }
  const iniciados = periodos.filter((p) => fecha >= p.inicio);
  const completados = iniciados.filter((p) => fecha > p.fin).sort((a, b) => b.anioLaboral - a.anioLaboral);
  completados.forEach((p, idx) => {
    if (idx >= MAX_PERIODOS_VIGENTES && !p.vencido) {
      p.perdidos = r2(p.perdidos + p.disponibles);
      p.disponibles = 0;
      p.vencido = true;
    }
  });
  const vigentes = completados.filter((p, idx) => idx < MAX_PERIODOS_VIGENTES && !p.vencido).sort((a, b) => a.anioLaboral - b.anioLaboral);
  // Tope de 30: solo con 2 períodos completos vigentes (misma condición que el motor actual).
  if (vigentes.length >= MAX_PERIODOS_VIGENTES) {
    const enCurso = iniciados.find((p) => !(fecha > p.fin));
    const capTotal = vigentes.reduce((s, p) => s + p.otorgados, 0);
    const total = vigentes.reduce((s, p) => s + p.disponibles, 0) + (enCurso && !enCurso.vencido ? enCurso.disponibles : 0);
    let exceso = r2(total - capTotal);
    for (const p of vigentes) {
      if (exceso <= 0) break;
      const recorte = Math.min(p.disponibles, exceso);
      if (recorte <= 0) continue;
      p.disponibles = r2(p.disponibles - recorte);
      p.recortados = r2(p.recortados + recorte);
      exceso = r2(exceso - recorte);
    }
  }
}

/** Opciones del motor. `repartoManual`: decisión EXPLÍCITA de RRHH para una vacación (por `origen`): días a tomar de cada año laboral. */
export type OpcionesReconstruccion = {
  repartoManual?: ReadonlyMap<number, readonly { anioLaboral: number; dias: number }[]>;
};

export function reconstruirEmpleado(
  emp: EmpleadoReconstruccion,
  historial: readonly VacacionReconstruccion[],
  hoyEntrada: Date,
  /** Feriados ("YYYY-MM-DD") para contar los días hábiles de cada tramo cuando una vacación cruza un aniversario. */
  feriados: ReadonlySet<string> = new Set(),
  opciones: OpcionesReconstruccion = {},
): ResultadoReconstruccion {
  const hoy = hoyCero(hoyEntrada);
  const advertencias: AdvertenciaReconstruccion[] = [];
  const orden = [...historial].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.origen - b.origen);
  const vacaciones: VacacionReconstruida[] = orden.map((v) => ({ ...v, excluida: null, consumido: 0, deficit: 0 }));
  const totalDiasHistorial = r2(orden.reduce((s, v) => s + v.dias, 0));

  const resultado = (bloqueado: ResultadoReconstruccion["bloqueado"], periodos: PeriodoReconstruido[], consumos: ConsumoReconstruido[], saldoFinal: number): ResultadoReconstruccion => ({
    empleadoId: emp.id, bloqueado, periodos, consumos, vacaciones, totalDiasHistorial, saldoFinal, advertencias,
    resumenDias: {
      otorgado: r2(periodos.reduce((t, p) => t + p.otorgados, 0)),
      consumido: r2(consumos.reduce((t, c) => t + c.dias, 0)),
      recortadoPorTope: r2(periodos.reduce((t, p) => t + p.recortadosPorTope, 0)),
      perdidoPorVencimiento: r2(periodos.reduce((t, p) => t + p.perdidosPorVencimiento, 0)),
      saldoUtilizable: saldoFinal,
    },
  });
  const bloquear = (motivo: NonNullable<ResultadoReconstruccion["bloqueado"]>, codigo: CodigoReconstruccion, mensaje: string) => {
    advertencias.push({ codigo, severidad: "BLOQUEANTE", mensaje });
    for (const v of vacaciones) v.excluida = "EMPLEADO_BLOQUEADO";
    return resultado(motivo, [], [], 0);
  };

  if (!emp.fechaAlta) return bloquear("SIN_FECHA_BASE", "SIN_FECHA_BASE", "El empleado no tiene fecha de alta: no hay base para generar períodos.");
  const base = deIso(emp.fechaAlta);
  if (fechaLaboralSospechosa(base)) {
    return bloquear("FECHA_SOSPECHOSA", "FECHA_SOSPECHOSA", `Fecha de alta inválida o anterior a 1980 (${emp.fechaAlta}): BLOQUEANTE, requiere el dato real de RRHH antes de reconstruir.`);
  }
  if (base > hoy) return bloquear("FECHA_FUTURA", "FECHA_FUTURA", `La fecha de alta (${emp.fechaAlta}) es posterior a hoy: no hay períodos que generar.`);

  if (emp.fechaInicioLaboral && emp.fechaInicioLaboral !== emp.fechaAlta) {
    advertencias.push({
      codigo: "FECHA_INICIO_LABORAL_DISTINTA", severidad: "INFO",
      mensaje: `Diferencia entre fecha entrada laboral y base de vacaciones: fecha_inicio_laboral ${emp.fechaInicioLaboral} ≠ fecha_alta ${emp.fechaAlta}. Se reconstruye según fecha_alta (regla vigente).`,
    });
  }

  // Períodos laborales: 1..aniosCompletos+1, siempre desde la fecha base (sin traslape por construcción).
  const aniosCompletos = differenceInYears(hoy, base);
  const periodos: Estado[] = Array.from({ length: aniosCompletos + 1 }, (_, i) => {
    const p = periodoLaboral(base, i + 1);
    return { anioLaboral: i + 1, inicio: p.inicio, fin: p.fin, otorgados: 0, disponibles: 0, consumidos: 0, recortados: 0, perdidos: 0, vencido: false };
  });

  // Clasificación previa por fila (se reporta aunque el empleado quede bloqueado por superposición después).
  for (const v of vacaciones) {
    const inicio = deIso(v.inicio);
    if (inicio < base) {
      v.excluida = "ANTERIOR_A_FECHA_BASE";
      advertencias.push({ codigo: "VACACION_ANTERIOR_A_FECHA_BASE", severidad: "DECISION", origen: v.origen, dias: v.dias, mensaje: `La fila ${v.origen} (${v.inicio}) es anterior a la fecha base ${emp.fechaAlta}: no consume saldo.` });
    } else if (inicio > hoy) {
      v.excluida = "VACACION_FUTURA";
      advertencias.push({
        codigo: "VACACION_FUTURA", severidad: "ERROR", origen: v.origen, dias: v.dias,
        mensaje: `La fila ${v.origen} (${v.inicio} → ${v.fin}) corresponde a una vacación futura. El archivo de reconstrucción debe contener únicamente vacaciones ya tomadas. No se incluyó en el saldo simulado.`,
      });
    }
  }

  // Superposiciones: se detectan ANTES de reaplicar. Con filas superpuestas la cronología no es confiable (el estado de la simulación
  // no retrocede), así que el empleado queda bloqueado: se informan las filas, fechas y días de traslape, pero NO se simula.
  let haySuperpuestas = false;
  for (let i = 0; i < orden.length; i++) {
    for (let j = i + 1; j < orden.length; j++) {
      const dias = diasSuperposicion({ inicio: deIso(orden[i].inicio), fin: deIso(orden[i].fin) }, { inicio: deIso(orden[j].inicio), fin: deIso(orden[j].fin) });
      if (dias > 0) {
        haySuperpuestas = true;
        advertencias.push({
          codigo: "VACACIONES_SUPERPUESTAS", severidad: "ERROR", origen: orden[j].origen, dias,
          mensaje: `Las vacaciones de las filas ${orden[i].origen} (${orden[i].inicio} → ${orden[i].fin}) y ${orden[j].origen} (${orden[j].inicio} → ${orden[j].fin}) se superponen ${dias} día(s). La reconstrucción de este empleado no es confiable hasta corregir el archivo; no se simuló su saldo.`,
        });
      }
    }
  }
  if (haySuperpuestas) {
    for (const v of vacaciones) v.excluida = v.excluida ?? "EMPLEADO_BLOQUEADO";
    return resultado("VACACIONES_SUPERPUESTAS", [], [], 0);
  }

  // Reaplicación cronológica con FIFO
  const consumos: ConsumoReconstruido[] = [];
  for (const v of vacaciones) {
    if (v.excluida) continue; // anterior a la fecha base o futura: se reportan, no consumen saldo
    const inicio = deIso(v.inicio);
    const fin = deIso(v.fin);
    // Tramos: se parte la vacación en cada inicio de período (aniversario) que cae DENTRO del rango (después del primer día).
    const cortes = periodos.map((p) => p.inicio).filter((i) => i > inicio && i <= fin).sort((x, y) => x.getTime() - y.getTime());
    const tramos: { desde: Date; hasta: Date; dias: number }[] = [];
    let desde = inicio;
    for (const corte of [...cortes, null]) {
      const hasta = corte ? new Date(corte.getFullYear(), corte.getMonth(), corte.getDate() - 1) : fin;
      tramos.push({ desde, hasta, dias: contarDiasHabilesPuro(aIso(desde), aIso(hasta), feriados) });
      if (corte) desde = corte;
    }
    // Días de la vacación (los informados por RRHH) repartidos por tramo en orden cronológico, hasta los hábiles reales de cada tramo;
    // el remanente (si el archivo informa más días que los hábiles calculados) cae en el último tramo.
    let porAsignar = v.dias;
    type Paso = { desde: Date; hasta: Date; asignados: number; anio: number | null };
    const manual = opciones.repartoManual?.get(v.origen);
    const pasos: Paso[] = manual
      ? manual.map((m) => {
          const periodo = periodos.find((p) => p.anioLaboral === m.anioLaboral);
          return { desde: periodo && periodo.inicio > inicio ? periodo.inicio : inicio, hasta: fin, asignados: r2(m.dias), anio: m.anioLaboral };
        })
      : tramos.map((t, i) => {
          const dias = i === tramos.length - 1 ? porAsignar : Math.min(t.dias, porAsignar);
          porAsignar = r2(porAsignar - dias);
          return { desde: t.desde, hasta: t.hasta, asignados: dias, anio: null };
        });
    const detalleTramos: string[] = [];
    let deficitTotal = 0;
    for (const t of pasos) {
      if (t.asignados <= 0) continue;
      const fecha = t.desde > hoy ? hoy : t.desde; // un tramo posterior a hoy (vacación en curso) se evalúa a hoy
      avanzar(periodos, fecha);
      let resto = t.asignados;
      const tomadoPorAnio: string[] = [];
      const utilizables = periodos
        .filter((p) => !p.vencido && fecha >= p.inicio && p.disponibles > 0 && (t.anio == null || p.anioLaboral === t.anio))
        .sort((a, b) => a.anioLaboral - b.anioLaboral);
      for (const p of utilizables) {
        if (resto <= 0) break;
        const tomar = r2(Math.min(p.disponibles, resto));
        if (tomar <= 0) continue;
        p.disponibles = r2(p.disponibles - tomar);
        p.consumidos = r2(p.consumidos + tomar);
        consumos.push({ origen: v.origen, anioLaboral: p.anioLaboral, dias: tomar, fecha: aIso(fecha) });
        v.consumido = r2(v.consumido + tomar);
        resto = r2(resto - tomar);
        tomadoPorAnio.push(`año ${p.anioLaboral}: ${tomar}`);
      }
      if (resto > 0) deficitTotal = r2(deficitTotal + resto);
      detalleTramos.push(`${aIso(t.desde)}→${aIso(t.hasta)} (${t.asignados} d.) ${tomadoPorAnio.length ? tomadoPorAnio.join(", ") : "sin saldo"}${resto > 0 ? ` [faltan ${resto}]` : ""}`);
    }
    if (manual) {
      advertencias.push({
        codigo: "REPARTO_MANUAL_APLICADO", severidad: "INFO", origen: v.origen, dias: v.dias,
        mensaje: `La fila ${v.origen} (${v.inicio} → ${v.fin}, ${v.dias} días) usa el reparto MANUAL aprobado por RRHH: ${detalleTramos.join(" | ")}.`,
      });
    } else if (cortes.length > 0) {
      advertencias.push({
        codigo: "VACACION_CRUZA_ANIVERSARIO", severidad: "DECISION", origen: v.origen, dias: v.dias,
        mensaje: `La fila ${v.origen} (${v.inicio} → ${v.fin}, ${v.dias} días) cruza ${cortes.length === 1 ? "un aniversario" : `${cortes.length} aniversarios`} (${cortes.map(aIso).join(", ")}). Reparto PROVISIONAL por fechas reales con FIFO sobre los períodos existentes en cada tramo: ${detalleTramos.join(" | ")}. RRHH debe confirmar esta distribución.`,
      });
    }
    if (deficitTotal > 0) {
      v.deficit = deficitTotal;
      advertencias.push({
        codigo: "SALDO_INSUFICIENTE", severidad: "DECISION", origen: v.origen, dias: deficitTotal,
        mensaje: `La fila ${v.origen} (${v.inicio}, ${v.dias} días) no tiene saldo suficiente a esa fecha: faltan ${deficitTotal} día(s). Requiere decisión de RRHH.`,
      });
    }
  }
  avanzar(periodos, hoy);

  const saldoFinal = r2(periodos.filter((p) => !p.vencido).reduce((s, p) => s + p.disponibles, 0));
  const salida: PeriodoReconstruido[] = periodos.map((p) => ({
    anioLaboral: p.anioLaboral, inicio: aIso(p.inicio), fin: aIso(p.fin), otorgados: p.otorgados, consumidos: p.consumidos,
    recortadosPorTope: p.recortados, perdidosPorVencimiento: p.perdidos, disponibles: p.disponibles,
    estado: p.vencido ? "Vencido" : "Vigente", enCurso: hoy >= p.inicio && hoy <= p.fin,
  }));
  return resultado(null, salida, consumos, saldoFinal);
}
