import { OutboxDispatcher, DEFAULT_OUTBOX_POLICY, type OutboxLogEntry, type OutboxPolicy, type OutboxRunSummary, type OutboxStore } from './outbox';
import { createSyntheticAdaptationHandler } from './outbox-adaptation-handler';
import { createTmsAdaptation } from './tms-adaptation';
import { AdaptationError, type AdaptationRepository, type CandidateResolutionPort, type SourceOrderPort } from './tms-adaptation-contracts';

// PRICESMART API-08 — composición ÚNICA del puente orden recibida → outbox → despachador → adaptación TMS SINTÉTICA.
// Une las piezas de API-05 (adaptación), API-07 (outbox/despachador) y API-08 (lectura de órdenes) con una sola superficie: `runOnce()`.
//
// MODO: SIMULATED. Garantías que esta composición NO puede romper (están en las piezas, y los tests las fijan aquí):
//  · el candidato logístico es `materializable:false` / `CONTRACT_PENDING`; no existe camino que cree una solicitud, viaje o entrega operativos del TMS;
//  · una garantía distinta de SIMULATED en la adaptación manda el evento a REVIEW (UNEXPECTED_ASSURANCE);
//  · no hay temporizadores, workers ni HTTP: cada ejecución es una llamada explícita;
//  · el estado de PriceSmart hacia afuera nunca cambia (`externalPriceSmartStatus` queda nulo).
// Materializar de verdad requiere D05 (entregas), D06 (diccionario de campos), D08 (estados) y D09 (cancelación), y un AdaptationRepository durable (hoy sólo existe un doble de pruebas).

export const BRIDGE_MODE = 'SIMULATED' as const;

export type SimulatedBridgeDeps = {
  outbox: OutboxStore;
  source: SourceOrderPort;
  resolver: CandidateResolutionPort;
  repository: AdaptationRepository;
  nowMs: () => number;
  policy?: OutboxPolicy;
  log?: (entry: OutboxLogEntry) => void;
};

export function createSimulatedOrderBridge(deps: SimulatedBridgeDeps) {
  const policy = deps.policy ?? DEFAULT_OUTBOX_POLICY;
  // La lease del trabajo de adaptación cubre con holgura el plazo del handler (leaseMs): un intento colgado no bloquea su recuperación más allá de eso.
  const adaptation = createTmsAdaptation({ source: deps.source, resolver: deps.resolver, repository: deps.repository, nowMs: deps.nowMs }, policy.leaseMs * 2);
  let dispatcher: OutboxDispatcher;
  try { dispatcher = new OutboxDispatcher(deps.outbox, createSyntheticAdaptationHandler(adaptation), policy, deps.log); }
  catch { throw new AdaptationError('INVALID_INPUT'); }   // política inválida: se rechaza al componer, no al ejecutar
  let running = false;
  return Object.freeze({
    mode: BRIDGE_MODE,
    /** Procesa un lote de la outbox. No reentrante: una segunda llamada concurrente se rechaza para no solapar lotes de la misma instancia. */
    async runOnce(): Promise<OutboxRunSummary> {
      if (running) throw new AdaptationError('CONFLICT');
      running = true;
      try { return await dispatcher.runOnce(); } finally { running = false; }
    },
  });
}
