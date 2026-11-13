import type { ExternalKeyProvider, KeyTarget } from './provider-cipher';

// PRICESMART API-20 — infraestructura de ADAPTACIÓN para un proveedor real de claves KMS/HSM. NO incluye ningún proveedor concreto, credenciales ni SDK: define (1) un puerto mínimo y neutral `KmsClient`
// (cifrar/descifrar la DEK con una clave nombrada por alias, con contexto de cifrado, y una comprobación de salud de solo lectura) que la composición administrativa implementará con el proveedor real que se
// decida; (2) la CONFIGURACIÓN segura y validada (`parseKmsConfig`, función pura: solo alias, destino y límites; jamás credenciales: cualquier variable con aspecto de secreto se rechaza); y (3)
// `createKmsKeyProvider`, que convierte un `KmsClient` en el `ExternalKeyProvider` de API-19 con: lista cerrada de alias por destino (prefijo `lab.`/`prod.`), alias vigente (rotación), aislamiento de concurrencia
// (mamparo: demasiadas llamadas simultáneas se rechazan sin hacer cola), reintentos acotados solo para errores que el cliente marque como transitorios, respeto del `AbortSignal` y validación de las respuestas.
// La autenticación hacia el proveedor (identidad de servicio, mTLS, etc.) es asunto del cliente inyectado y no pasa por este módulo. No lee el entorno por sí mismo, no registra nada y no está importado por la
// aplicación. No define ni ratifica D02/D06/D08/D09/D12.
export interface KmsClient {
  /** Cifra `plaintext` con la clave `alias`, ligando el resultado al `context` de cifrado (debe fallar al descifrar con otro contexto). */
  encrypt(input: { alias: string; plaintext: Uint8Array; context: string; signal?: AbortSignal }): Promise<Uint8Array>;
  decrypt(input: { alias: string; ciphertext: Uint8Array; context: string; signal?: AbortSignal }): Promise<Uint8Array>;
  /** Comprobación de salud de SOLO LECTURA (no crea, rota ni usa claves). Opcional: sin ella no se puede verificar el proveedor. */
  health?(signal?: AbortSignal): Promise<boolean>;
}
export type KmsConfig = Readonly<{ target: KeyTarget; currentAlias: string; allowedAliases: readonly string[]; maxConcurrent: number; maxRetries: number; retryBackoffMs: number; callTimeoutMs: number }>;
export type KmsConfigResult = { ok: true; config: KmsConfig } | { ok: false; issues: string[] };

const ALIAS = /^(lab|prod)\.[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const KNOWN = ['PRICESMART_KMS_TARGET', 'PRICESMART_KMS_CURRENT_ALIAS', 'PRICESMART_KMS_ALLOWED_ALIASES', 'PRICESMART_KMS_MAX_CONCURRENT', 'PRICESMART_KMS_MAX_RETRIES', 'PRICESMART_KMS_RETRY_BACKOFF_MS', 'PRICESMART_KMS_CALL_TIMEOUT_MS'];
const SECRETISH = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|ACCESS_?KEY|API_?KEY|KEY_?MATERIAL|CERT|PEM)/i;
const prefixOf = (t: KeyTarget) => (t === 'LAB' ? 'lab.' : 'prod.');
const intIn = (raw: string | undefined, def: number, min: number, max: number): number | null => { if (raw === undefined || raw === '') return def; if (!/^\d{1,9}$/.test(raw)) return null; const n = Number(raw); return n >= min && n <= max ? n : null; };

/** Configuración validada y SEGURA por defecto. Los mensajes citan nombres de variables, nunca valores. Cualquier variable `PRICESMART_KMS_*` desconocida o con aspecto de credencial invalida la configuración. */
export function parseKmsConfig(env: Record<string, string | undefined>): KmsConfigResult {
  const issues: string[] = [];
  for (const name of Object.keys(env)) if (name.startsWith('PRICESMART_KMS_') && env[name] !== undefined && env[name] !== '') {
    if (SECRETISH.test(name)) issues.push(`${name}: variable con aspecto de credencial NO permitida (la autenticación pertenece al cliente KMS inyectado)`);
    else if (!KNOWN.includes(name)) issues.push(`${name}: variable desconocida`);
  }
  const target = env.PRICESMART_KMS_TARGET;
  if (target !== 'LAB' && target !== 'PRODUCTION') issues.push('PRICESMART_KMS_TARGET: debe ser LAB o PRODUCTION');
  const current = env.PRICESMART_KMS_CURRENT_ALIAS ?? '';
  const allowed = (env.PRICESMART_KMS_ALLOWED_ALIASES ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const t = target === 'LAB' || target === 'PRODUCTION' ? target : null;
  if (!ALIAS.test(current)) issues.push('PRICESMART_KMS_CURRENT_ALIAS: formato inválido');
  if (allowed.length === 0 || allowed.length > 32) issues.push('PRICESMART_KMS_ALLOWED_ALIASES: debe tener entre 1 y 32 alias');
  if (allowed.some(a => !ALIAS.test(a)) || new Set(allowed).size !== allowed.length) issues.push('PRICESMART_KMS_ALLOWED_ALIASES: alias inválidos o repetidos');
  if (t) {
    if (ALIAS.test(current) && !current.startsWith(prefixOf(t))) issues.push('PRICESMART_KMS_CURRENT_ALIAS: no corresponde al destino');
    if (allowed.some(a => ALIAS.test(a) && !a.startsWith(prefixOf(t)))) issues.push('PRICESMART_KMS_ALLOWED_ALIASES: hay alias de otro destino');
  }
  if (ALIAS.test(current) && allowed.length && !allowed.includes(current)) issues.push('PRICESMART_KMS_CURRENT_ALIAS: debe figurar entre los permitidos');
  const maxConcurrent = intIn(env.PRICESMART_KMS_MAX_CONCURRENT, 8, 1, 64); const maxRetries = intIn(env.PRICESMART_KMS_MAX_RETRIES, 1, 0, 3);
  const retryBackoffMs = intIn(env.PRICESMART_KMS_RETRY_BACKOFF_MS, 50, 0, 2000); const callTimeoutMs = intIn(env.PRICESMART_KMS_CALL_TIMEOUT_MS, 5000, 100, 30_000);
  if (maxConcurrent === null) issues.push('PRICESMART_KMS_MAX_CONCURRENT: fuera de rango'); if (maxRetries === null) issues.push('PRICESMART_KMS_MAX_RETRIES: fuera de rango');
  if (retryBackoffMs === null) issues.push('PRICESMART_KMS_RETRY_BACKOFF_MS: fuera de rango'); if (callTimeoutMs === null) issues.push('PRICESMART_KMS_CALL_TIMEOUT_MS: fuera de rango');
  if (issues.length || !t || maxConcurrent === null || maxRetries === null || retryBackoffMs === null || callTimeoutMs === null) return { ok: false, issues: [...new Set(issues)] };
  return { ok: true, config: Object.freeze({ target: t, currentAlias: current, allowedAliases: Object.freeze([...allowed]), maxConcurrent, maxRetries, retryBackoffMs, callTimeoutMs }) };
}

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
