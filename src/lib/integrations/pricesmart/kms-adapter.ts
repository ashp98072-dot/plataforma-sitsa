import type { ExternalKeyProvider } from './provider-cipher';
import { parseKmsConfig, type KmsClient, type KmsConfig, type KmsConfigResult } from './kms-config';
export { parseKmsConfig };
export type { KmsClient, KmsConfig, KmsConfigResult };
// API-21: el contrato (`KmsClient`) y la configuración (`parseKmsConfig`) viven ahora en `kms-config.ts` (módulo puro); se re-exportan aquí para no cambiar a los consumidores.

// PRICESMART API-20 — infraestructura de ADAPTACIÓN para un proveedor real de claves KMS/HSM. NO incluye ningún proveedor concreto, credenciales ni SDK: define (1) un puerto mínimo y neutral `KmsClient`
// (cifrar/descifrar la DEK con una clave nombrada por alias, con contexto de cifrado, y una comprobación de salud de solo lectura) que la composición administrativa implementará con el proveedor real que se
// decida; (2) la CONFIGURACIÓN segura y validada (`parseKmsConfig`, función pura: solo alias, destino y límites; jamás credenciales: cualquier variable con aspecto de secreto se rechaza); y (3)
// `createKmsKeyProvider`, que convierte un `KmsClient` en el `ExternalKeyProvider` de API-19 con: lista cerrada de alias por destino (prefijo `lab.`/`prod.`), alias vigente (rotación), aislamiento de concurrencia
// (mamparo: demasiadas llamadas simultáneas se rechazan sin hacer cola), reintentos acotados solo para errores que el cliente marque como transitorios, respeto del `AbortSignal` y validación de las respuestas.
// La autenticación hacia el proveedor (identidad de servicio, mTLS, etc.) es asunto del cliente inyectado y no pasa por este módulo. No lee el entorno por sí mismo, no registra nada y no está importado por la
// aplicación. No define ni ratifica D02/D06/D08/D09/D12.
export class KmsAdapterError extends Error { constructor(readonly code: 'BUSY' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NOT_ALLOWED') { super(code); this.name = 'KmsAdapterError'; } }
const allZero = (b: Uint8Array) => b.length > 0 && b.every(x => x === 0);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => { if (ms <= 0 || signal?.aborted) return resolve(); const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });

export type KmsKeyProvider = ExternalKeyProvider & { health(): Promise<boolean>; readonly inFlight: () => number };
export function createKmsKeyProvider(options: { client: KmsClient; config: KmsConfig }): KmsKeyProvider {
  const { client, config } = options;
  if (typeof client?.encrypt !== 'function' || typeof client?.decrypt !== 'function' || !config || !config.allowedAliases.includes(config.currentAlias)) throw new KmsAdapterError('INVALID_RESPONSE');
  let inFlight = 0;
  const contextOf = (aad: Uint8Array) => Buffer.from(aad).toString('base64url');   // contexto de cifrado del KMS = AAD de API-19 (incluye destino y contexto de la carga)
  const allowed = (alias: unknown): alias is string => typeof alias === 'string' && config.allowedAliases.includes(alias);

  /** Mamparo + reintentos acotados. `secret` es el arreglo con material sensible que se reenvía en cada intento: si ya está borrado (el llamador terminó) no se reintenta. */
  async function guarded<T>(run: () => Promise<T>, signal: AbortSignal | undefined, secret?: Uint8Array): Promise<T> {
    if (inFlight >= config.maxConcurrent) throw new KmsAdapterError('BUSY');   // sin cola: se rechaza de inmediato
    inFlight++;
    try {
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted || (secret && allZero(secret))) throw new KmsAdapterError('UNAVAILABLE');   // el llamador ya desistió (o borró el material): no se reenvía nada
        try { return await run(); }
        catch (error) {
          if (error instanceof KmsAdapterError) throw error;   // validación de la respuesta: código cerrado propio, sin reintento
          const transient = typeof error === 'object' && error !== null && (error as { retryable?: unknown }).retryable === true;
          if (!transient || attempt >= config.maxRetries) throw new KmsAdapterError('UNAVAILABLE');   // jamás se propaga el error del proveedor
          await sleep(config.retryBackoffMs * (attempt + 1), signal);
        }
      }
    } finally { inFlight--; }
  }
  const validOut = (v: unknown, min: number, max: number): Uint8Array => { if (!(v instanceof Uint8Array) || v.length < min || v.length > max) throw new KmsAdapterError('INVALID_RESPONSE'); return v; };

  return {
    target: config.target,
    inFlight: () => inFlight,
    async currentKeyReference() { return config.currentAlias; },
    async wrapKey({ keyReference, dataKey, aad, signal }) {
      if (!allowed(keyReference)) throw new KmsAdapterError('NOT_ALLOWED');
      if (!(dataKey instanceof Uint8Array) || dataKey.length !== 32 || !(aad instanceof Uint8Array)) throw new KmsAdapterError('INVALID_RESPONSE');
      const context = contextOf(aad);
      return guarded(async () => validOut(await client.encrypt({ alias: keyReference, plaintext: dataKey, context, signal }), 1, 4096), signal, dataKey);
    },
    async unwrapKey({ keyReference, wrappedKey, aad, signal }) {
      if (!allowed(keyReference)) throw new KmsAdapterError('NOT_ALLOWED');   // alias retirado de la lista = ya no se puede abrir con él
      if (!(wrappedKey instanceof Uint8Array) || wrappedKey.length < 1 || wrappedKey.length > 4096 || !(aad instanceof Uint8Array)) throw new KmsAdapterError('INVALID_RESPONSE');
      const context = contextOf(aad);
      return guarded(async () => validOut(await client.decrypt({ alias: keyReference, ciphertext: wrappedKey, context, signal }), 32, 32), signal, wrappedKey);
    },
    /** Salud de solo lectura: false si el cliente no la ofrece, falla o tarda más que el tiempo límite. */
    async health() {
      if (typeof client.health !== 'function') return false;
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try { return (await Promise.race([client.health(controller.signal), new Promise<boolean>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, config.callTimeoutMs); })])) === true; }
      catch { return false; } finally { if (timer) clearTimeout(timer); }
    },
  };
}
