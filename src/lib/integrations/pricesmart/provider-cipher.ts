import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PayloadCipher } from './mariadb-repository';

// PRICESMART API-19 — adaptador de CIFRADO DE CARGAS con un PROVEEDOR EXTERNO DE CLAVES (KMS/HSM). Cifrado de sobre (envelope): cada carga se cifra con una clave de datos (DEK) aleatoria de un solo
// uso (AES-256-GCM); la DEK se envuelve con el proveedor externo y SOLO la DEK envuelta se guarda junto al texto cifrado. La clave maestra nunca sale del proveedor y este módulo no lee el entorno, no
// guarda secretos, no abre conexiones propias y no define ningún proveedor real (eso es infraestructura pendiente): recibe el proveedor por inyección. No es el contrato de PriceSmart ni ratifica
// D02/D06/D08/D09/D12; nada en la aplicación lo importa.
//
// CICLO DE VIDA DEL MATERIAL DE CLAVE (propiedad explícita)
//  · DEK propia del adaptador (`randomBytes` al sellar, o la copia propia de la DEK desenvuelta al abrir/re-envolver): la crea y la POSEE el adaptador y se borra en `finally` (éxito o error).
//  · COPIAS ENTREGADAS AL PROVEEDOR (`dataKey`, `wrappedKey`, `aad`): son copias independientes, también propiedad del adaptador. Se borran cuando la llamada termina por CUALQUIER vía: éxito, excepción
//    o tiempo límite (en el tiempo límite se borran de inmediato aunque el proveedor siga trabajando: su resultado ya no se acepta).
//  · Arreglo devuelto por el proveedor (DEK desenvuelta): el adaptador hace una copia propia y borra el arreglo recibido en el acto; si llega TARDE (después del tiempo límite) nunca se usa y se borra.
//  · Límites que NO se pueden garantizar en JavaScript: las cadenas (el JSON de la carga, p. ej.) son inmutables y no se pueden borrar; el recolector de basura y el motor pueden dejar copias que el código no controla.
// TIEMPO LÍMITE: `Promise.race` NO cancela la operación del proveedor. El adaptador pasa un `AbortSignal` (de mejor esfuerzo) y lo activa al vencer, pero NO afirma que la operación externa quedó cancelada:
// puede seguir ejecutándose y completarse. Lo único que se garantiza es que su respuesta tardía se descarta (jamás se acepta ni se usa) y que el material que controla el adaptador se borra.
// RESPONSABILIDAD DEL PROVEEDOR: un proveedor externo confiable debe garantizar por sí mismo el manejo seguro del material que recibe (no registrarlo, no conservarlo más de lo necesario, borrarlo, honrar el
// `signal` cuando pueda). Este adaptador no puede verificarlo ni sustituirlo.
//
// Separación LAB / PRODUCTION (en capas): (1) el proveedor declara su destino y debe coincidir con el del adaptador (si no, no se construye); (2) las referencias de clave llevan un prefijo por destino
// (`lab.` / `prod.`) que se exige al sellar y al abrir; (3) el destino va dentro de los datos autenticados (AAD) del texto cifrado y del envoltorio de la DEK: un texto de un destino no se abre con el otro
// aunque ambos compartieran material de clave. Rotación: se sella con la referencia vigente del proveedor; las anteriores siguen abriendo mientras el proveedor las conserve; `rewrap` vuelve a envolver la
// DEK con la clave vigente sin tocar la carga. Los fallos del proveedor y de integridad producen errores con código cerrado y mensaje genérico (nunca detalles del proveedor ni de la carga).
export type KeyTarget = 'LAB' | 'PRODUCTION';
export type CipherFailureCode = 'PROVIDER_UNAVAILABLE' | 'INTEGRITY' | 'INVALID';
export class CipherError extends Error {
  constructor(readonly code: CipherFailureCode) { super(code); this.name = 'CipherError'; }
}
export interface ExternalKeyProvider {
  /** Destino al que pertenecen TODAS las claves del proveedor. */
  readonly target: KeyTarget;
  /** Referencia de la clave vigente para sellar (cambia al rotar). `signal` es de mejor esfuerzo (ver «TIEMPO LÍMITE»). */
  currentKeyReference(signal?: AbortSignal): Promise<string>;
  /** Envuelve la DEK con la clave `keyReference`; `aad` es el contexto de cifrado que el proveedor debe ligar al envoltorio. Los arreglos recibidos son copias que el adaptador borrará al terminar. */
  wrapKey(input: { keyReference: string; dataKey: Uint8Array; aad: Uint8Array; signal?: AbortSignal }): Promise<Uint8Array>;
  /** Desenvuelve la DEK; debe fallar si la referencia es desconocida/retirada o si `aad` no coincide. El arreglo devuelto pasa a ser del adaptador, que lo borra. */
  unwrapKey(input: { keyReference: string; wrappedKey: Uint8Array; aad: Uint8Array; signal?: AbortSignal }): Promise<Uint8Array>;
}

const PREFIX: Record<KeyTarget, string> = { LAB: 'lab.', PRODUCTION: 'prod.' };
const REF = /^(lab|prod)\.[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const VERSION = 1; const IV_LEN = 12; const TAG_LEN = 16; const DEK_LEN = 32; const MAX_WRAPPED = 4096; const MAX_PAYLOAD = 1_048_576;
const MAX_DEPTH = 32; const MAX_NODES = 100_000;
const aadOf = (target: KeyTarget, context: string) => Buffer.from(`pricesmart-api19-v1|${target}|${context}`, 'utf8');
const zero = (b: Uint8Array | undefined | null) => { if (b instanceof Uint8Array) b.fill(0); };

/** ¿Es `value` JSON simple y fiel (se serializa y se recupera igual)? Rechaza undefined, funciones, símbolos, BigInt, NaN/Infinity, Map/Set/Date/clases, ciclos, getters y estructuras desmesuradas. */
export function isPlainJson(value: unknown): boolean {
  let nodes = 0; const path = new Set<object>();
  const walk = (v: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v !== 'object') return false;   // undefined, function, symbol, bigint
    if (path.has(v)) return false;   // ciclo
    const proto = Object.getPrototypeOf(v);
    const isArray = Array.isArray(v);
    if (isArray ? proto !== Array.prototype : (proto !== Object.prototype && proto !== null)) return false;   // subclases de Array, Map, Set, Date, instancias de clases, etc.
    if ('toJSON' in v) return false;   // ni propio ni heredado: un toJSON cambiaría lo que se serializa
    path.add(v);
    try {
      if (isArray) {
        const arr = v as unknown[]; const n = arr.length;
        // Propiedades propias EXACTAMENTE: los índices 0..n-1 y `length`; nada más (ni extras, ni ocultas, ni símbolos).
        const names = Object.getOwnPropertyNames(arr);
        if (names.length !== n + 1 || Object.getOwnPropertySymbols(arr).length !== 0) return false;
        const expected = new Set<string>(['length']); for (let i = 0; i < n; i++) expected.add(String(i));
        if (!names.every(k => expected.has(k))) return false;
        for (let i = 0; i < n; i++) {
          const d = Object.getOwnPropertyDescriptor(arr, String(i));
          if (!d || !('value' in d) || !d.enumerable || !walk(d.value, depth + 1)) return false;   // dispersos, getters/setters y no enumerables no
        }
        return true;
      }
      for (const k of Object.getOwnPropertyNames(v)) {
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d || !('value' in d) || !d.enumerable || !walk(d.value, depth + 1)) return false;   // getters/setters y propiedades ocultas no
      }
      return Object.getOwnPropertySymbols(v).length === 0;
    } finally { path.delete(v); }
  };
  try { return walk(value, 0); } catch { return false; }
}

export type ProviderCipher = PayloadCipher & {
  /** Vuelve a envolver la DEK con la clave vigente (rotación) SIN descifrar ni modificar la carga. El texto cifrado y la referencia devueltos reemplazan a los anteriores. */
  rewrap(ciphertext: Buffer, keyReference: string, context: string): Promise<{ ciphertext: Buffer; keyReference: string }>;
};

export function createProviderCipher(config: { provider: ExternalKeyProvider; target: KeyTarget; timeoutMs?: number }): ProviderCipher {
  const { provider, target } = config;
  if ((target !== 'LAB' && target !== 'PRODUCTION') || typeof provider !== 'object' || provider === null || provider.target !== target
    || typeof provider.currentKeyReference !== 'function' || typeof provider.wrapKey !== 'function' || typeof provider.unwrapKey !== 'function') throw new CipherError('INVALID');
  const timeoutMs = config.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new CipherError('INVALID');
  const prefix = PREFIX[target];
  const refOk = (ref: unknown): ref is string => typeof ref === 'string' && REF.test(ref) && ref.startsWith(prefix);
  const contextOk = (c: unknown): c is string => typeof c === 'string' && c.length > 0 && c.length <= 512;

  /** Llama al proveedor con tiempo límite. `owned` son las copias que el adaptador entregó: se borran siempre al terminar (éxito, error o tiempo límite). Al vencer se activa el `signal` (sin afirmar
   *  cancelación) y la respuesta tardía se descarta y, si es un arreglo, se borra. Cualquier fallo, demora o excepción = PROVIDER_UNAVAILABLE, sin detalles. */
  async function call<T>(fn: (signal: AbortSignal) => Promise<T>, owned: Uint8Array[] = []): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
    const op = Promise.resolve().then(() => fn(controller.signal));   // una excepción síncrona del proveedor se vuelve un rechazo
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('timeout')); }, timeoutMs); });
    try { return await Promise.race([op, timeout]); }
    catch { throw new CipherError('PROVIDER_UNAVAILABLE'); }
    finally {
      if (timer) clearTimeout(timer);
      for (const b of owned) zero(b);
      if (timedOut) {
        try { controller.abort(); } catch { /* mejor esfuerzo */ }
        op.then(late => { if (late instanceof Uint8Array) zero(late); }, () => undefined);   // la respuesta tardía no se acepta jamás; si trae material, se borra
      } else op.catch(() => undefined);
    }
  }
  async function currentRef(): Promise<string> { const ref = await call(signal => provider.currentKeyReference(signal)); if (!refOk(ref)) throw new CipherError('PROVIDER_UNAVAILABLE'); return ref; }
  /** Envuelve `dek` entregando copias propias que se borran al terminar. Devuelve el envoltorio (copia del adaptador). */
  async function wrap(keyReference: string, dek: Buffer, aad: Buffer): Promise<Buffer> {
    const dataKey = Uint8Array.from(dek); const aadCopy = Uint8Array.from(aad);
    const wrapped = await call(signal => provider.wrapKey({ keyReference, dataKey, aad: aadCopy, signal }), [dataKey, aadCopy]);
    if (!(wrapped instanceof Uint8Array) || wrapped.length < 1 || wrapped.length > MAX_WRAPPED) throw new CipherError('PROVIDER_UNAVAILABLE');
    return Buffer.from(wrapped);
  }
  const pack = (wrapped: Buffer, iv: Buffer, tag: Buffer, ct: Buffer) => {
    const head = Buffer.alloc(3); head[0] = VERSION; head.writeUInt16BE(wrapped.length, 1);
    return Buffer.concat([head, wrapped, iv, tag, ct]);
  };
  function unpack(buf: unknown): { wrapped: Buffer; iv: Buffer; tag: Buffer; ct: Buffer } {
    if (!Buffer.isBuffer(buf) || buf.length < 3 + 1 + IV_LEN + TAG_LEN || buf.length > MAX_PAYLOAD + MAX_WRAPPED + 64 || buf[0] !== VERSION) throw new CipherError('INTEGRITY');
    const wl = buf.readUInt16BE(1); const start = 3;
    if (wl < 1 || wl > MAX_WRAPPED || buf.length < start + wl + IV_LEN + TAG_LEN) throw new CipherError('INTEGRITY');
    return { wrapped: buf.subarray(start, start + wl), iv: buf.subarray(start + wl, start + wl + IV_LEN), tag: buf.subarray(start + wl + IV_LEN, start + wl + IV_LEN + TAG_LEN), ct: buf.subarray(start + wl + IV_LEN + TAG_LEN) };
  }
  /** Obtiene la DEK desenvuelta como copia PROPIA del adaptador y borra el arreglo que entregó el proveedor. */
  async function dataKeyOf(keyReference: unknown, wrapped: Buffer, aad: Buffer): Promise<Buffer> {
    if (!refOk(keyReference)) throw new CipherError('INTEGRITY');   // referencia de otro destino o mal formada
    const wrappedCopy = Uint8Array.from(wrapped); const aadCopy = Uint8Array.from(aad);
    const dek = await call(signal => provider.unwrapKey({ keyReference, wrappedKey: wrappedCopy, aad: aadCopy, signal }), [wrappedCopy, aadCopy]);
    if (!(dek instanceof Uint8Array) || dek.length !== DEK_LEN) { zero(dek); throw new CipherError('PROVIDER_UNAVAILABLE'); }
    const own = Buffer.from(dek); zero(dek); return own;
  }
  /** Cualquier excepción nativa inesperada se convierte en un error cerrado (nunca se propaga un TypeError/RangeError con detalles). */
  async function closed<T>(fallback: CipherFailureCode, fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) { throw e instanceof CipherError ? e : new CipherError(fallback); }
  }

  return {
    seal: (input, context) => closed('INVALID', async () => {
      if (!contextOk(context) || !isPlainJson(input)) throw new CipherError('INVALID');   // entradas no serializables o no fieles → error cerrado, sin tocar al proveedor
      const text = JSON.stringify(input); if (typeof text !== 'string') throw new CipherError('INVALID');
      const plaintext = Buffer.from(text, 'utf8'); if (plaintext.length === 0 || plaintext.length > MAX_PAYLOAD) { zero(plaintext); throw new CipherError('INVALID'); }
      const aad = aadOf(target, context); const dek = randomBytes(DEK_LEN);
      try {
        const keyReference = await currentRef(); const iv = randomBytes(IV_LEN);
        const c = createCipheriv('aes-256-gcm', dek, iv); c.setAAD(aad);
        const ct = Buffer.concat([c.update(plaintext), c.final()]); const tag = c.getAuthTag();
        const wrapped = await wrap(keyReference, dek, aad);
        return { ciphertext: pack(wrapped, iv, tag, ct), keyReference };
      } finally { zero(dek); zero(plaintext); }
    }),
    open: (ciphertext, keyReference, context) => closed('INTEGRITY', async () => {
      if (!contextOk(context)) throw new CipherError('INVALID');
      const { wrapped, iv, tag, ct } = unpack(ciphertext); const aad = aadOf(target, context);
      const dek = await dataKeyOf(keyReference, wrapped, aad);
      try {
        const d = createDecipheriv('aes-256-gcm', dek, iv); d.setAAD(aad); d.setAuthTag(tag);
        let plain: Buffer; try { plain = Buffer.concat([d.update(ct), d.final()]); } catch { throw new CipherError('INTEGRITY'); }
        try { return JSON.parse(plain.toString('utf8')); } catch { throw new CipherError('INTEGRITY'); } finally { zero(plain); }
      } finally { zero(dek); }
    }),
    rewrap: (ciphertext, keyReference, context) => closed('INTEGRITY', async () => {
      if (!contextOk(context)) throw new CipherError('INVALID');
      const { wrapped, iv, tag, ct } = unpack(ciphertext); const aad = aadOf(target, context);
      const dek = await dataKeyOf(keyReference, wrapped, aad);
      try {
        const verify = createDecipheriv('aes-256-gcm', dek, iv); verify.setAAD(aad); verify.setAuthTag(tag);
        try { zero(Buffer.concat([verify.update(ct), verify.final()])); } catch { throw new CipherError('INTEGRITY'); }   // no se re-envuelve una carga alterada
        const nextRef = await currentRef(); const next = await wrap(nextRef, dek, aad);
        return { ciphertext: pack(next, iv, tag, ct), keyReference: nextRef };
      } finally { zero(dek); }
    }),
  };
}
