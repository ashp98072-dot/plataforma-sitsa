import type { HechoVacacion } from "./vacaciones-rebase";

/**
 * RRHH VACACIONES — PREFLIGHT del MODO DE CARGA HISTÓRICA (módulo PURO). En modo carga el saldo de cada período se reconstruye como
 * `dias_otorgados − Σ detalle FIFO`; eso solo es correcto si TODO consumo real está respaldado por detalle FIFO verificable. Si existe consumo que no se puede verificar,
 * recalcular así podría INVENTAR días disponibles. Este módulo decide, con los hechos ya cargados, si el consumo de un colaborador es verificable. No infiere consumo perdido
 * desde `dias_disponibles` (también baja por vencimiento y tope).
 */
export type CodigoConsumoNoVerificable =
  | "SIN_DETALLE"
  | "DETALLE_PARCIAL"
  | "DETALLE_SALDO_AJENO"
  | "DETALLE_AJENO"
  | "DETALLE_HUERFANO"
  | "VACACION_SIN_INCIDENCIA";

export type MotivoNoVerificable = { codigo: CodigoConsumoNoVerificable; mensaje: string };

export type EntradaConsumo = {
  /** Incidencias Vacaciones / A cuenta de Vacaciones del colaborador con lo realmente consumido según el detalle FIFO. */
  hechos: readonly HechoVacacion[];
  /** Líneas de detalle de sus vacaciones cuyo saldo es de otro colaborador / otra empresa / inexistente. */
  cruzados: readonly { incidenciaId: number; saldoId: number }[];
  /** Líneas de detalle sobre SUS saldos que no pertenecen a sus vacaciones: `existeIncidencia=false` ⇒ huérfano (la incidencia no existe). */
  ajenos: readonly { detalleId: number; incidenciaId: number | null; existeIncidencia: boolean }[];
  /** Filas «Aprobado» de la tabla simple `vacaciones` del colaborador. */
  espejos: readonly { inicio: string; fin: string; dias: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const EJEMPLOS = 3;
const dma = (iso: string) => { const p = iso.split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };
const lista = (xs: string[]) => `${xs.slice(0, EJEMPLOS).join("; ")}${xs.length > EJEMPLOS ? `; … (+${xs.length - EJEMPLOS})` : ""}`;

export function evaluarConsumoVerificable(e: EntradaConsumo): MotivoNoVerificable[] {
  const motivos: MotivoNoVerificable[] = [];
  const sin = e.hechos.filter((h) => h.dias > 0 && h.consumido <= 0.004);
  const parcial = e.hechos.filter((h) => h.dias > 0 && h.consumido > 0.004 && h.consumido < r2(h.dias) - 0.004);
  if (sin.length) {
    motivos.push({ codigo: "SIN_DETALLE", mensaje: `${sin.length} vacación(es) con días tomados y SIN detalle de consumo FIFO (${lista(sin.map((h) => `${dma(h.inicio)} → ${dma(h.fin)}, ${h.dias} día(s)`))}).` });
  }
  if (parcial.length) {
    motivos.push({ codigo: "DETALLE_PARCIAL", mensaje: `${parcial.length} vacación(es) cuyo detalle FIFO suma menos que los días tomados (${lista(parcial.map((h) => `${dma(h.inicio)} → ${dma(h.fin)}: ${h.consumido} de ${h.dias}`))}).` });
  }
  if (e.cruzados.length) {
    motivos.push({ codigo: "DETALLE_SALDO_AJENO", mensaje: `${e.cruzados.length} línea(s) de consumo de sus vacaciones apuntan a un saldo de otro colaborador, de otra empresa o inexistente.` });
  }
  const huerfanos = e.ajenos.filter((a) => !a.existeIncidencia);
  const ajenos = e.ajenos.filter((a) => a.existeIncidencia);
  if (ajenos.length) motivos.push({ codigo: "DETALLE_AJENO", mensaje: `${ajenos.length} línea(s) de consumo sobre sus saldos provienen de vacaciones que no son suyas.` });
  if (huerfanos.length) motivos.push({ codigo: "DETALLE_HUERFANO", mensaje: `${huerfanos.length} línea(s) de consumo sobre sus saldos no tienen incidencia asociada.` });

  // Cada fila «Aprobado» del historial simple debe estar respaldada por una incidencia de vacaciones igual (fechas y días); si no, hay días tomados sin respaldo.
  const disponibles = new Map<string, number>();
  for (const h of e.hechos) { const k = `${h.inicio}|${h.fin}|${r2(h.dias)}`; disponibles.set(k, (disponibles.get(k) ?? 0) + 1); }
  const sinRespaldo: string[] = [];
  for (const s of e.espejos) {
    const k = `${s.inicio}|${s.fin}|${r2(s.dias)}`;
    const n = disponibles.get(k) ?? 0;
    if (n > 0) disponibles.set(k, n - 1);
    else sinRespaldo.push(`${dma(s.inicio)} → ${dma(s.fin)}, ${s.dias} día(s)`);
  }
  if (sinRespaldo.length) {
    motivos.push({ codigo: "VACACION_SIN_INCIDENCIA", mensaje: `${sinRespaldo.length} vacación(es) en el historial simple sin incidencia ni detalle FIFO que la respalde (${lista(sinRespaldo)}).` });
  }
  return motivos;
}

export type EmpleadoNoVerificable = { empleadoId: number; codigo: string; nombre: string; motivos: MotivoNoVerificable[] };

export type ResultadoPreflight = {
  /** true = ningún colaborador tiene consumo no verificable: se puede activar el modo. */
  puedeActivar: boolean;
  revisados: number;
  aptos: number;
  bloqueados: number;
  /** Solo los colaboradores bloqueados, con su motivo (mensajes seguros, sin detalles internos). */
  motivos: EmpleadoNoVerificable[];
};

export const MENSAJE_PREFLIGHT_BLOQUEADO = "No se puede activar el modo histórico todavía. Hay colaboradores con consumo que no puede reconstruirse de forma verificable.";
