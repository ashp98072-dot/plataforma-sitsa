// PRICESMART API-21 — contrato y CONFIGURACIÓN del KMS, en un módulo PURO y sin dependencias (extraído de kms-adapter.ts de API-20 para que el diagnóstico de readiness pueda usarlo sin arrastrar el cifrado
// ni la base de datos). Contiene: el puerto neutral `KmsClient`, la configuración validada (`parseKmsConfig`) y, desde API-21, la SELECCIÓN del proveedor y la IDENTIDAD DE SERVICIO como referencias NO secretas.
// Nada de lo que contiene es una credencial: la autenticación hacia el KMS la resuelve el cliente inyectado (identidad de la carga de trabajo/plataforma), y cualquier variable con aspecto de secreto se rechaza.
// No define ni ratifica proveedor alguno: la selección del KMS es una decisión pendiente (ver kms-provider-selection.ts).
export type KmsTarget = 'LAB' | 'PRODUCTION';
export interface KmsClient {
  /** Cifra `plaintext` con la clave `alias`, ligando el resultado al `context` de cifrado (debe fallar al descifrar con otro contexto). */
  encrypt(input: { alias: string; plaintext: Uint8Array; context: string; signal?: AbortSignal }): Promise<Uint8Array>;
  decrypt(input: { alias: string; ciphertext: Uint8Array; context: string; signal?: AbortSignal }): Promise<Uint8Array>;
  /** Comprobación de salud de SOLO LECTURA (no crea, rota ni usa claves). Opcional: sin ella no se puede verificar el proveedor. */
  health?(signal?: AbortSignal): Promise<boolean>;
}
export type KmsConfig = Readonly<{
  target: KmsTarget; currentAlias: string; allowedAliases: readonly string[]; maxConcurrent: number; maxRetries: number; retryBackoffMs: number; callTimeoutMs: number;
  /** Identificador del adaptador de proveedor elegido (referencia, no secreto) o null si aún no se ha seleccionado. */
  providerId: string | null;
  /** Referencia NO secreta a la identidad de servicio (p. ej. el nombre de una identidad de carga de trabajo) o null. */
  serviceIdentityRef: string | null;
}>;
export type KmsConfigResult = { ok: true; config: KmsConfig } | { ok: false; issues: string[] };

const ALIAS = /^(lab|prod)\.[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,31}$/;
const SERVICE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const KMS_ENV_VARIABLES = ['PRICESMART_KMS_TARGET', 'PRICESMART_KMS_CURRENT_ALIAS', 'PRICESMART_KMS_ALLOWED_ALIASES', 'PRICESMART_KMS_MAX_CONCURRENT', 'PRICESMART_KMS_MAX_RETRIES', 'PRICESMART_KMS_RETRY_BACKOFF_MS', 'PRICESMART_KMS_CALL_TIMEOUT_MS', 'PRICESMART_KMS_PROVIDER', 'PRICESMART_KMS_SERVICE_IDENTITY'] as const;
export const SECRETISH_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|ACCESS_?KEY|API_?KEY|KEY_?MATERIAL|CERT|PEM)/i;
const prefixOf = (t: KmsTarget) => (t === 'LAB' ? 'lab.' : 'prod.');
const intIn = (raw: string | undefined, def: number, min: number, max: number): number | null => { if (raw === undefined || raw === '') return def; if (!/^\d{1,9}$/.test(raw)) return null; const n = Number(raw); return n >= min && n <= max ? n : null; };

/** Configuración validada y SEGURA por defecto. Los mensajes citan nombres de variables, nunca valores. Cualquier variable `PRICESMART_KMS_*` desconocida o con aspecto de credencial invalida la configuración. */
export function parseKmsConfig(env: Record<string, string | undefined>): KmsConfigResult {
  const issues: string[] = [];
  for (const name of Object.keys(env)) if (name.startsWith('PRICESMART_KMS_') && env[name] !== undefined && env[name] !== '') {
    if (SECRETISH_NAME.test(name)) issues.push(`${name}: variable con aspecto de credencial NO permitida (la autenticación pertenece al cliente KMS inyectado)`);
    else if (!(KMS_ENV_VARIABLES as readonly string[]).includes(name)) issues.push(`${name}: variable desconocida`);
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
  const providerRaw = env.PRICESMART_KMS_PROVIDER; const identityRaw = env.PRICESMART_KMS_SERVICE_IDENTITY;
  const providerId = providerRaw === undefined || providerRaw === '' ? null : providerRaw; const serviceIdentityRef = identityRaw === undefined || identityRaw === '' ? null : identityRaw;
  if (providerId !== null && !PROVIDER_ID.test(providerId)) issues.push('PRICESMART_KMS_PROVIDER: formato inválido');
  if (serviceIdentityRef !== null && !SERVICE_IDENTITY.test(serviceIdentityRef)) issues.push('PRICESMART_KMS_SERVICE_IDENTITY: formato inválido (solo una referencia, nunca una credencial)');
  const maxConcurrent = intIn(env.PRICESMART_KMS_MAX_CONCURRENT, 8, 1, 64); const maxRetries = intIn(env.PRICESMART_KMS_MAX_RETRIES, 1, 0, 3);
  const retryBackoffMs = intIn(env.PRICESMART_KMS_RETRY_BACKOFF_MS, 50, 0, 2000); const callTimeoutMs = intIn(env.PRICESMART_KMS_CALL_TIMEOUT_MS, 5000, 100, 30_000);
  if (maxConcurrent === null) issues.push('PRICESMART_KMS_MAX_CONCURRENT: fuera de rango'); if (maxRetries === null) issues.push('PRICESMART_KMS_MAX_RETRIES: fuera de rango');
  if (retryBackoffMs === null) issues.push('PRICESMART_KMS_RETRY_BACKOFF_MS: fuera de rango'); if (callTimeoutMs === null) issues.push('PRICESMART_KMS_CALL_TIMEOUT_MS: fuera de rango');
  if (issues.length || !t || maxConcurrent === null || maxRetries === null || retryBackoffMs === null || callTimeoutMs === null) return { ok: false, issues: [...new Set(issues)] };
  return { ok: true, config: Object.freeze({ target: t, currentAlias: current, allowedAliases: Object.freeze([...allowed]), maxConcurrent, maxRetries, retryBackoffMs, callTimeoutMs, providerId, serviceIdentityRef }) };
}
