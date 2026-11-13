import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PayloadCipher } from './mariadb-repository';

// PRICESMART API-19 — adaptador de CIFRADO DE CARGAS con un PROVEEDOR EXTERNO DE CLAVES (KMS/HSM). Cifrado de sobre (envelope): cada carga se cifra con una clave de datos (DEK) aleatoria de un solo
// uso (AES-256-GCM); la DEK se envuelve con el proveedor externo y SOLO la DEK envuelta se guarda junto al texto cifrado. La clave maestra nunca sale del proveedor y este módulo no lee el entorno, no
// guarda secretos, no abre conexiones propias y no define ningún proveedor real (eso es infraestructura pendiente): recibe el proveedor por inyección. No es el contrato de PriceSmart ni ratifica
// D02/D06/D08/D09/D12; nada en la aplicación lo importa.
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
  /** Referencia de la clave vigente para sellar (cambia al rotar). */
  currentKeyReference(): Promise<string>;
  /** Envuelve la DEK con la clave `keyReference`; `aad` es el contexto de cifrado que el proveedor debe ligar al envoltorio. */
  wrapKey(input: { keyReference: string; dataKey: Uint8Array; aad: Uint8Array }): Promise<Uint8Array>;
  /** Desenvuelve la DEK; debe fallar si la referencia es desconocida/retirada o si `aad` no coincide. */
  unwrapKey(input: { keyReference: string; wrappedKey: Uint8Array; aad: Uint8Array }): Promise<Uint8Array>;
}

const PREFIX: Record<KeyTarget, string> = { LAB: 'lab.', PRODUCTION: 'prod.' };
const REF = /^(lab|prod)\.[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const VERSION = 1; const IV_LEN = 12; const TAG_LEN = 16; const DEK_LEN = 32; const MAX_WRAPPED = 4096; const MAX_PAYLOAD = 1_048_576;
const aadOf = (target: KeyTarget, context: string) => Buffer.from(`pricesmart-api19-v1|${target}|${context}`, 'utf8');
const zero = (b: Uint8Array | undefined) => { if (b) b.fill(0); };

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

  /** Llama al proveedor con tiempo límite; cualquier fallo, demora o respuesta ajena = PROVIDER_UNAVAILABLE (sin detalles). */
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([fn(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]); }
    catch { throw new CipherError('PROVIDER_UNAVAILABLE'); } finally { if (timer) clearTimeout(timer); }
  }
  async function currentRef(): Promise<string> { const ref = await call(() => provider.currentKeyReference()); if (!refOk(ref)) throw new CipherError('PROVIDER_UNAVAILABLE'); return ref; }
  const pack = (wrapped: Uint8Array, iv: Buffer, tag: Buffer, ct: Buffer) => {
    if (wrapped.length < 1 || wrapped.length > MAX_WRAPPED) throw new CipherError('PROVIDER_UNAVAILABLE');
    const head = Buffer.alloc(3); head[0] = VERSION; head.writeUInt16BE(wrapped.length, 1);
    return Buffer.concat([head, Buffer.from(wrapped), iv, tag, ct]);
  };
  function unpack(buf: unknown): { wrapped: Buffer; iv: Buffer; tag: Buffer; ct: Buffer } {
    if (!Buffer.isBuffer(buf) || buf.length < 3 + 1 + IV_LEN + TAG_LEN || buf.length > MAX_PAYLOAD + MAX_WRAPPED + 64 || buf[0] !== VERSION) throw new CipherError('INTEGRITY');
    const wl = buf.readUInt16BE(1); const start = 3;
    if (wl < 1 || wl > MAX_WRAPPED || buf.length < start + wl + IV_LEN + TAG_LEN) throw new CipherError('INTEGRITY');
    return { wrapped: buf.subarray(start, start + wl), iv: buf.subarray(start + wl, start + wl + IV_LEN), tag: buf.subarray(start + wl + IV_LEN, start + wl + IV_LEN + TAG_LEN), ct: buf.subarray(start + wl + IV_LEN + TAG_LEN) };
  }
  async function dataKeyOf(keyReference: unknown, wrapped: Buffer, aad: Buffer): Promise<Buffer> {
    if (!refOk(keyReference)) throw new CipherError('INTEGRITY');   // referencia de otro destino o mal formada
    const dek = await call(() => provider.unwrapKey({ keyReference, wrappedKey: Uint8Array.from(wrapped), aad: Uint8Array.from(aad) }));
    if (!(dek instanceof Uint8Array) || dek.length !== DEK_LEN) { zero(dek instanceof Uint8Array ? dek : undefined); throw new CipherError('PROVIDER_UNAVAILABLE'); }
    const own = Buffer.from(dek); zero(dek); return own;   // copia propia; se borra la que entregó el proveedor
  }

  return {
    async seal(input, context) {
      if (typeof context !== 'string' || context.length === 0 || context.length > 512) throw new CipherError('INVALID');
      let plaintext: Buffer; try { plaintext = Buffer.from(JSON.stringify(input), 'utf8'); } catch { throw new CipherError('INVALID'); }
      if (plaintext.length === 0 || plaintext.length > MAX_PAYLOAD) throw new CipherError('INVALID');
      const keyReference = await currentRef(); const aad = aadOf(target, context); const dek = randomBytes(DEK_LEN);
      try {
        const iv = randomBytes(IV_LEN); const c = createCipheriv('aes-256-gcm', dek, iv); c.setAAD(aad);
        const ct = Buffer.concat([c.update(plaintext), c.final()]); const tag = c.getAuthTag();
        const wrapped = await call(() => provider.wrapKey({ keyReference, dataKey: Uint8Array.from(dek), aad: Uint8Array.from(aad) }));
        if (!(wrapped instanceof Uint8Array)) throw new CipherError('PROVIDER_UNAVAILABLE');
        return { ciphertext: pack(wrapped, iv, tag, ct), keyReference };
      } finally { zero(dek); zero(plaintext); }
    },
    async open(ciphertext, keyReference, context) {
      if (typeof context !== 'string' || context.length === 0 || context.length > 512) throw new CipherError('INVALID');
      const { wrapped, iv, tag, ct } = unpack(ciphertext); const aad = aadOf(target, context);
      const dek = await dataKeyOf(keyReference, wrapped, aad);
      try {
        const d = createDecipheriv('aes-256-gcm', dek, iv); d.setAAD(aad); d.setAuthTag(tag);
        let plain: Buffer; try { plain = Buffer.concat([d.update(ct), d.final()]); } catch { throw new CipherError('INTEGRITY'); }
        try { return JSON.parse(plain.toString('utf8')); } catch { throw new CipherError('INTEGRITY'); } finally { zero(plain); }
      } finally { zero(dek); }
    },
    async rewrap(ciphertext, keyReference, context) {
      if (typeof context !== 'string' || context.length === 0 || context.length > 512) throw new CipherError('INVALID');
      const { wrapped, iv, tag, ct } = unpack(ciphertext); const aad = aadOf(target, context);
      const dek = await dataKeyOf(keyReference, wrapped, aad);
      try {
        const verify = createDecipheriv('aes-256-gcm', dek, iv); verify.setAAD(aad); verify.setAuthTag(tag);
        try { zero(Buffer.concat([verify.update(ct), verify.final()])); } catch { throw new CipherError('INTEGRITY'); }   // no se re-envuelve una carga alterada
        const nextRef = await currentRef();
        const next = await call(() => provider.wrapKey({ keyReference: nextRef, dataKey: Uint8Array.from(dek), aad: Uint8Array.from(aad) }));
        if (!(next instanceof Uint8Array)) throw new CipherError('PROVIDER_UNAVAILABLE');
        return { ciphertext: pack(next, iv, tag, ct), keyReference: nextRef };
      } finally { zero(dek); }
    },
  };
}
