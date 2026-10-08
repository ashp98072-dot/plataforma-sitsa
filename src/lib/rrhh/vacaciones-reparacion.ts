import { differenceInYears } from "date-fns";
import {
  aIso, clasificarTraslape, deIso, diasSuperposicion, fechaLaboralSospechosa, periodoLaboral, planificarSincronizacion, type FilaSaldo,
} from "./vacaciones-periodos";
import { planificarRebase, planificarReconstruccion, type EntradaRebase, type PlanRebase, type SaldoPrevio } from "./vacaciones-rebase";

/**
 * RRHH VACACIONES — REPARACIÓN ADMINISTRADA de series de períodos inconsistentes (módulo PURO: sin BD, sin red).
 *
 * Hay colaboradores cuya serie de `saldos_vacaciones` se creó ANTES del rebase de #421 con otra base (o quedó traslapada/duplicada) aunque su
 * `empleados.fecha_alta` actual ya es la correcta; guardar la misma fecha no la reconstruye (el rebase no hace nada si la fecha no cambia).
 *
 * - `diagnosticarSerie` decide si la serie guardada NO coincide estructuralmente con `fecha_alta` (solo lectura; reutiliza `planificarSincronizacion`,
 *   el análisis de congelación de #417, y le suma la comprobación fila por fila contra `periodoLaboral(fecha_alta, anio_laboral)`).
 * - `planificarReparacion` reutiliza el MOTOR del rebase (`planificarReconstruccion`) con la fecha de alta ACTUAL como única base: la serie guardada
 *   no es fuente de verdad; las fuentes son `fecha_alta`, las incidencias de vacaciones y los días realmente consumidos según el detalle FIFO.
 * No es el rebase de `actualizarEmpleado`: esta ruta es explícita y nunca se ejecuta sola.
 */

export type CodigoDefectoSerie =
  | "FECHA_ALTA_SOSPECHOSA"
  | "FECHA_ALTA_FUTURA"
  | "ANIO_LABORAL_DUPLICADO"
  | "TRASLAPE_REAL"
  | "PERIODO_FUERA_DE_BASE"
  | "ANIO_FUERA_DE_SERIE"
  | "ANIO_LABORAL_NULO_EN_SERIE"
  | "ESTRUCTURA_CONGELADA";
export type DefectoSerie = { codigo: CodigoDefectoSerie; mensaje: string; saldoId?: number; anioLaboral?: number | null };

export type DiagnosticoSerie = {
  /** true = los saldos guardados no coinciden estructuralmente con la fecha de alta (o quedan congelados por #417). */
  requiereReparacion: boolean;
  /** true = la sincronización normal NO escribe nada para este colaborador (#417). */
  congelada: boolean;
  defectos: DefectoSerie[];
  /** Pares de saldos que se superponen más de un día. */
  traslapesReales: number;
  aniosDuplicados: number[];
  /** IDs de saldos cuyo inicio/fin no es `periodoLaboral(fecha_alta, anio_laboral)` (o cuyo año excede la serie esperada). */
  fueraDeBase: number[];
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const cero = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const r2 = (n: number) => Math.round(n * 100) / 100;

export function diagnosticarSerie(e: { fechaAlta: string | null; hoy: Date; filas: readonly FilaSaldo[] }): DiagnosticoSerie {
  const d: DiagnosticoSerie = { requiereReparacion: false, congelada: false, defectos: [], traslapesReales: 0, aniosDuplicados: [], fueraDeBase: [] };
  if (e.filas.length === 0 || !e.fechaAlta) return d; // sin saldos (o sin fecha) no hay serie que no coincida
  const hoy = cero(e.hoy);
  const marcar = (x: DefectoSerie) => { d.defectos.push(x); d.requiereReparacion = true; };

  const base = FECHA.test(e.fechaAlta) ? deIso(e.fechaAlta) : null;
  if (!base || fechaLaboralSospechosa(base)) {
    marcar({ codigo: "FECHA_ALTA_SOSPECHOSA", mensaje: "La fecha de contratación es inválida o anterior a 1980: los períodos guardados no pueden derivarse de ella." });
    return d;
  }
  if (base > hoy) {
    marcar({ codigo: "FECHA_ALTA_FUTURA", mensaje: "La fecha de contratación es posterior a hoy pero el colaborador ya tiene períodos de vacaciones." });
    return d;
  }

  const maxAnio = differenceInYears(hoy, base) + 1;
  const filas = [...e.filas];
  const rango = (f: FilaSaldo) => ({ inicio: deIso(f.inicio), fin: deIso(f.fin) });

  // 1) cada fila con año laboral debe ser EXACTAMENTE el período de ese año calculado desde la fecha de alta
  for (const f of filas) {
    if (f.anioLaboral == null) continue;
    if (f.anioLaboral < 1 || f.anioLaboral > maxAnio) {
      d.fueraDeBase.push(f.id);
      marcar({ codigo: "ANIO_FUERA_DE_SERIE", mensaje: `El saldo #${f.id} tiene el año laboral ${f.anioLaboral}, fuera de la serie esperada (1 a ${maxAnio}).`, saldoId: f.id, anioLaboral: f.anioLaboral });
      continue;
    }
    const esp = periodoLaboral(base, f.anioLaboral);
    if (f.inicio !== aIso(esp.inicio) || f.fin !== aIso(esp.fin)) {
      d.fueraDeBase.push(f.id);
      marcar({
        codigo: "PERIODO_FUERA_DE_BASE",
        mensaje: `El saldo #${f.id} (año ${f.anioLaboral}: ${f.inicio} → ${f.fin}) no corresponde a la fecha de contratación; debería ser ${aIso(esp.inicio)} → ${aIso(esp.fin)}.`,
        saldoId: f.id, anioLaboral: f.anioLaboral,
      });
    }
  }
  // 2) año laboral duplicado
  const porAnio = new Map<number, FilaSaldo[]>();
  for (const f of filas) if (f.anioLaboral != null) porAnio.set(f.anioLaboral, [...(porAnio.get(f.anioLaboral) ?? []), f]);
  for (const [anio, fs] of porAnio) {
    if (fs.length > 1) {
      d.aniosDuplicados.push(anio);
      marcar({ codigo: "ANIO_LABORAL_DUPLICADO", mensaje: `El año laboral ${anio} tiene ${fs.length} saldos (#${fs.map((x) => x.id).join(", #")}).`, anioLaboral: anio });
    }
  }
  // 3) filas sin año laboral que se superponen con la serie esperada (como #417); las que quedan fuera y sin consumo no participan en nada
  const serieEsperada = Array.from({ length: maxAnio }, (_, i) => periodoLaboral(base, i + 1));
  for (const f of filas) {
    if (f.anioLaboral != null) continue;
    if (f.conConsumo || serieEsperada.some((s) => diasSuperposicion(s, rango(f)) > 0)) {
      marcar({ codigo: "ANIO_LABORAL_NULO_EN_SERIE", mensaje: `El saldo #${f.id} no tiene año laboral y ${f.conConsumo ? "tiene consumo" : "se superpone con la serie esperada"}.`, saldoId: f.id });
    }
  }
  // 4) traslapes REALES (más de un día); el borde de un día es normal
  const ordenadas = [...filas].sort((x, y) => x.inicio.localeCompare(y.inicio) || x.id - y.id);
  for (let i = 0; i < ordenadas.length; i++) {
    for (let j = i + 1; j < ordenadas.length; j++) {
      const t = clasificarTraslape(rango(ordenadas[i]), rango(ordenadas[j]));
      if (t.tipo !== "REAL") continue;
      d.traslapesReales++;
      marcar({ codigo: "TRASLAPE_REAL", mensaje: `Los saldos #${ordenadas[i].id} y #${ordenadas[j].id} se superponen ${t.dias} días.`, saldoId: ordenadas[j].id });
    }
  }
  // 5) lo que la sincronización normal ya congela (#417): se reutiliza su análisis para que nunca difieran
  const sync = planificarSincronizacion(base, hoy, [...filas]);
  d.congelada = sync.requiereReparacion;
  if (sync.requiereReparacion && !d.requiereReparacion) marcar({ codigo: "ESTRUCTURA_CONGELADA", mensaje: "La sincronización de períodos está congelada para este colaborador (estructura inconsistente)." });
  return d;
}

export type PeriodoActualReparacion = { id: number; anioLaboral: number | null; inicio: string; fin: string; otorgados: number; consumidos: number; disponibles: number; estado: string };

export type PlanReparacion = PlanRebase & {
  /** false = la serie ya coincide con la fecha de alta (o no hay nada que reparar): no se escribe NADA. */
  requiereReparacion: boolean;
  fechaAltaActual: string | null;
  diagnostico: DiagnosticoSerie;
  periodosActuales: PeriodoActualReparacion[];
  /** Líneas FIFO que existían antes (todas las que apuntan a saldos del colaborador). */
  lineasAntes: number;
  /** Total consumido por período cargado en `periodosActuales` (informativo). */
  consumidoAntes: number;
};

export type EntradaReparacion = {
  fechaAlta: string | null;
  hoy: Date;
  hechos: EntradaRebase["hechos"];
  saldos: readonly SaldoPrevio[];
  feriados: ReadonlySet<string>;
  lineasAntes?: number;
};

const aFila = (s: SaldoPrevio): FilaSaldo => ({
  id: s.id, anioLaboral: s.anioLaboral, inicio: s.inicio, fin: s.fin, otorgados: s.otorgados, disponibles: s.disponibles, estado: s.estado,
  conConsumo: s.conDetalle ?? (s.consumidos ?? 0) > 0,
});

/** Plan de reparación: diagnóstico + (si corresponde) reconstrucción completa desde `fecha_alta` con el motor del rebase. */
export function planificarReparacion(e: EntradaReparacion): PlanReparacion {
  const diagnostico = diagnosticarSerie({ fechaAlta: e.fechaAlta, hoy: e.hoy, filas: e.saldos.map(aFila) });
  const entrada: EntradaRebase = {
    fechaAnterior: e.fechaAlta, fechaNueva: e.fechaAlta ?? "", hoy: e.hoy, hechos: e.hechos, saldos: e.saldos, feriados: e.feriados, modo: "reparacion",
  };
  const periodosActuales: PeriodoActualReparacion[] = e.saldos.map((s) => ({
    id: s.id, anioLaboral: s.anioLaboral, inicio: s.inicio, fin: s.fin, otorgados: s.otorgados, consumidos: r2(s.consumidos ?? 0), disponibles: s.disponibles, estado: s.estado,
  }));
  const consumidoAntes = r2(periodosActuales.reduce((t, p) => t + p.consumidos, 0));
  const extra = { requiereReparacion: diagnostico.requiereReparacion, fechaAltaActual: e.fechaAlta, diagnostico, periodosActuales, lineasAntes: e.lineasAntes ?? 0, consumidoAntes };
  if (!diagnostico.requiereReparacion || !e.fechaAlta) {
    // Serie correcta (o sin saldos): no hay nada que reparar → plan vacío, ni siquiera se construye la reconstrucción.
    return { ...planificarRebase(entrada), ...extra }; // misma fecha ⇒ plan sin cambios (aplica=false) con el saldo actual
  }
  const plan = planificarReconstruccion(entrada);
  return { ...plan, ...extra };
}
