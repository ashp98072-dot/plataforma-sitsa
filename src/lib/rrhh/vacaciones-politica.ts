import { MAX_PERIODOS_VIGENTES } from "./vacaciones-periodos";

/**
 * RRHH VACACIONES — POLÍTICA DE VENCIMIENTO / TOPE (módulo PURO, ÚNICA fuente de verdad del modo).
 *
 * Hay dos modos, por EMPRESA, y un único motor que recibe la política (no hay dos motores):
 *  - NORMAL (por defecto): solo los `MAX_PERIODOS_VIGENTES` (= 2) períodos completos más recientes son utilizables, el resto vence y el saldo
 *    utilizable tiene tope de 30 días (2 períodos × 15).
 *  - CARGA HISTÓRICA (TEMPORAL): mientras RRHH completa el historial desde la fecha de ingreso, TODOS los períodos desde `fecha_alta` siguen siendo utilizables por
 *    lo que no se haya consumido (sin vencimiento por antigüedad y sin tope global). El período en curso sigue siendo proporcional, los completos otorgan 15 y la
 *    FIFO cronológica no cambia.
 * Activar o desactivar el modo NUNCA borra ni inventa historia: solo cambia cómo se calcula el estado utilizable, el vencimiento y el saldo disponible.
 */
export type ModoVacaciones = "NORMAL" | "CARGA_HISTORICA";

export type PoliticaVacaciones = {
  modo: ModoVacaciones;
  /** Cantidad de períodos completos más recientes que siguen utilizables; `null` = ilimitado (sin vencimiento por antigüedad). */
  maxPeriodosVigentes: number | null;
  /** true = el saldo utilizable está topado (2 períodos completos × 15). */
  aplicarTope: boolean;
};

export const POLITICA_NORMAL: PoliticaVacaciones = { modo: "NORMAL", maxPeriodosVigentes: MAX_PERIODOS_VIGENTES, aplicarTope: true };
export const POLITICA_CARGA_HISTORICA: PoliticaVacaciones = { modo: "CARGA_HISTORICA", maxPeriodosVigentes: null, aplicarTope: false };

export const politicaPorModo = (cargaHistorica: boolean): PoliticaVacaciones => (cargaHistorica ? POLITICA_CARGA_HISTORICA : POLITICA_NORMAL);

/** Clave del almacén genérico por empresa `configuracion(empresa_id, parametro, valor)`. Ausente o distinto de «1» ⇒ modo NORMAL. */
export const PARAMETRO_MODO_CARGA_HISTORICA = "vacaciones_modo_carga_historica";
export const valorEsCargaHistorica = (valor: unknown): boolean => String(valor ?? "").trim() === "1";

/** ¿Este período (posición `idx`, 0 = el completo más reciente) vence con la política? */
export const venceConPolitica = (p: PoliticaVacaciones, idx: number): boolean => p.maxPeriodosVigentes != null && idx >= p.maxPeriodosVigentes;
