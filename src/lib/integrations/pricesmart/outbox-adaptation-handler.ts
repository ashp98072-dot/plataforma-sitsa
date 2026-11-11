import { AdaptationError, type AdaptationCommand, type AdaptationLink, type AdaptationScope } from './tms-adaptation-contracts';
import type { OutboxEvent, OutboxHandler, OutboxOutcome } from './outbox';

// PRICESMART API-07 — puente SINTÉTICO outbox → adaptación TMS (API-05). Traduce cada evento de la outbox en el comando de adaptación correspondiente.
// Solo ACEPTA adaptaciones SIMULATED: la adaptación actual produce un candidato NO materializable (`materializable:false`, `readiness:'CONTRACT_PENDING'`) y su repositorio es un doble.
// Por eso este handler NO crea ninguna solicitud operativa del TMS ni debe cablearse a un worker de producción: la materialización real depende de D05/D06/D08 (pendientes).
// Cuando exista una adaptación durable/real, se sustituye el handler; el despachador no cambia.

export function commandFor(event: OutboxEvent): AdaptationCommand {
  if (event.type === 'RECEIVED') return { kind: 'RECEIVE', orderId: event.orderId, sourceVersion: 1, correlationId: event.correlationId };
  if (event.reason === null) throw new AdaptationError('INVALID_INPUT');
  return { kind: 'CANCEL', orderId: event.orderId, sourceVersion: event.version, reason: event.reason, correlationId: event.correlationId };
}

type Adaptation = { process(scope: AdaptationScope, command: AdaptationCommand): Promise<{ value: AdaptationLink; assurance: 'SIMULATED'; replayed: boolean }> };
export function createSyntheticAdaptationHandler(adaptation: Adaptation): OutboxHandler {
  return {
    async handle(event): Promise<OutboxOutcome> {
      try {
        const result = await adaptation.process({ ...event.scope }, commandFor(event));
        // Cualquier garantía distinta de SIMULATED (p. ej. un futuro 'DURABLE') exige revisión humana de este puente antes de usarlo: no se asume nada.
        if (result?.assurance !== 'SIMULATED') return { kind: 'REVIEW', reason: 'UNEXPECTED_ASSURANCE' };
        return { kind: 'DONE' };
      } catch (error) {
        if (error instanceof AdaptationError) {
          // UNAVAILABLE = fallo temporal de la dependencia → reintento con backoff. CONFLICT/NOT_FOUND/INVALID_INPUT no se arreglan reintentando → revisión durable.
          return error.code === 'UNAVAILABLE' ? { kind: 'RETRY', reason: 'ADAPTATION_UNAVAILABLE' } : { kind: 'REVIEW', reason: `ADAPTATION_${error.code}` };
        }
        return { kind: 'RETRY', reason: 'UNEXPECTED_ERROR' };
      }
    },
  };
}
