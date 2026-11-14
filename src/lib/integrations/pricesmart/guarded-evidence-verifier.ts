import { assertionSchema, type EvidenceVerifier } from './security-contracts';
import { DEFAULT_ENVIRONMENT, environmentSchema, type Environment } from './environment';

// PRICESMART API-19 — componentes NEUTRALES del verificador de evidencia. El mecanismo criptográfico real (formato de la evidencia, ancla de confianza, audiencia, algoritmos) es D02 y sigue PENDIENTE:
// aquí NO se implementa ni se supone ninguno. Lo que sí es independiente de D02 es el CONTRATO que cualquier verificador debe cumplir y que hoy solo se comprueba de forma dispersa:
//   · `denyAllEvidenceVerifier`: verificador por defecto que deniega siempre (estado seguro hasta que D02 se ratifique);
//   · `guardEvidenceVerifier(inner)`: envoltura de cierre por defecto para CUALQUIER verificador futuro: valida la entrada (bytes, tamaño acotado, entorno), copia los datos antes de entregarlos, impone un tiempo
//     límite, nunca lanza, nunca devuelve algo distinto de una aserción que cumpla `assertionSchema` (copia congelada) y convierte cualquier fallo en «denegado» (null) sin filtrar detalles.
// No lee el entorno, no abre conexiones, no instala nada; nada en la aplicación lo importa.
export const DEFAULT_MAX_EVIDENCE_BYTES = 4096; export const DEFAULT_VERIFY_TIMEOUT_MS = 3000;

export const denyAllEvidenceVerifier: EvidenceVerifier = Object.freeze({ async verify() { return null; } });

export function guardEvidenceVerifier(inner: EvidenceVerifier | null | undefined, options: { maxEvidenceBytes?: number; timeoutMs?: number; /** API-22: entorno para el que se configura (por omisión `sandbox`). */ environment?: Environment } = {}): EvidenceVerifier {
  const parsedEnvironment = environmentSchema.safeParse(options.environment === undefined ? DEFAULT_ENVIRONMENT : options.environment); if (!parsedEnvironment.success) throw new Error('UNAVAILABLE');
  const environment = parsedEnvironment.data;
  const maxBytes = options.maxEvidenceBytes ?? DEFAULT_MAX_EVIDENCE_BYTES; const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000) throw new Error('UNAVAILABLE');
  if (!inner || typeof inner.verify !== 'function') return denyAllEvidenceVerifier;
  return Object.freeze({
    async verify(evidence: Uint8Array, context: { environment: Environment }): Promise<unknown | null> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!(evidence instanceof Uint8Array) || evidence.byteLength < 1 || evidence.byteLength > maxBytes || context?.environment !== environment) return null;   // el entorno pedido debe ser EXACTAMENTE aquel para el que se configuró
        const copy = new Uint8Array(evidence);   // el verificador interior no puede alterar los bytes del llamador
        const result = await Promise.race([inner.verify(copy, { environment }), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
        const parsed = assertionSchema.safeParse(result);
        return parsed.success && parsed.data.environment === environment ? Object.freeze(structuredClone(parsed.data)) : null;   // una aserción de otro entorno nunca se entrega
      } catch { return null; } finally { if (timer) clearTimeout(timer); }
    },
  });
}
