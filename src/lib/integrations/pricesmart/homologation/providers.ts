import type { HttpEvidencePort } from '../http-transport';
import type { OrderContractOptions } from '../contracts';
import type { EvidenceVerifier } from '../security-contracts';
import type { PayloadCipher } from '../mariadb-repository';

// PRICESMART — PROVEEDORES del runtime de homologación: lo que NO decide Mónaco y llega inyectado (verificador D02, extractor de evidencia, cifrado con KMS aprobado, contrato D06).
// HOY NO EXISTE ningún proveedor definitivo: `REVIEWED_ADAPTERS` está vacío a propósito. Un adaptador revisado (verificador acordado con PriceSmart + KMS revisado + contrato ratificado) se añade AQUÍ, en un cambio
// propio y auditado; mientras no exista, el arranque real del runtime queda CERRADO (503 DISABLED) aunque todo lo demás esté configurado.
// Los proveedores SINTÉTICOS (verificador HMAC de laboratorio, clave de prueba) solo pueden usarse en una prueba local: se rechazan en un proceso `NODE_ENV=production` (es decir, en cualquier `next start`),
// sin la frase explícita, sin un identificador de sandbox `homolog-test*` o sin una clave de prueba. Nunca se usan en un entorno externo.
export type HomologationProviders = { evidence: HttpEvidencePort; verifier: EvidenceVerifier; cipher: PayloadCipher; contract: OrderContractOptions };
export type ProviderSource = 'REVIEWED_ADAPTER' | 'SYNTHETIC_TEST_ONLY';
export type ProviderResolution = { ok: true; source: ProviderSource; providers: HomologationProviders } | { ok: false; code: 'PROVIDERS_NOT_AVAILABLE' | 'SYNTHETIC_PROVIDERS_REFUSED' | 'ADAPTER_INVALID'; detail: string };
export type ProviderAdapter = (env: Record<string, string | undefined>) => Promise<HomologationProviders | null>;

/** Adaptadores REVISADOS (vacío hoy: D02, KMS y D06 siguen pendientes). */
export const REVIEWED_ADAPTERS: readonly ProviderAdapter[] = Object.freeze([]);

export const SYNTHETIC_PROVIDERS_ACK = 'SINTETICO-LOCAL-SIN-PRODUCCION';
export function syntheticProvidersDecision(env: Record<string, string | undefined>): { ok: true } | { ok: false; reason: string } {
  if (env.PS_HOMOLOG_SYNTHETIC_PROVIDERS === undefined || env.PS_HOMOLOG_SYNTHETIC_PROVIDERS === '') return { ok: false, reason: 'NOT_REQUESTED' };
  if (env.PS_HOMOLOG_SYNTHETIC_PROVIDERS !== SYNTHETIC_PROVIDERS_ACK) return { ok: false, reason: 'ACK_INVALID' };
  if (env.NODE_ENV === 'production') return { ok: false, reason: 'PRODUCTION_PROCESS' };
  if (!/^homolog-test[a-z0-9]{0,10}$/.test(env.SANDBOX_ID ?? '')) return { ok: false, reason: 'SANDBOX_ID_NOT_TEST' };
  if (env.NOVALVION_ENV !== 'sandbox' || env.DB_HOST !== '127.0.0.1') return { ok: false, reason: 'NOT_LOCAL_SANDBOX' };
  if (!/^[a-f0-9]{64}$/.test(env.PS_HOMOLOG_SYNTHETIC_KEY ?? '')) return { ok: false, reason: 'KEY_INVALID' };
  return { ok: true };
}
const validShape = (p: unknown): p is HomologationProviders => {
  const x = p as Partial<HomologationProviders> | null;
  return !!x && typeof x.evidence?.extract === 'function' && typeof (x.verifier as { verify?: unknown } | undefined)?.verify === 'function' && typeof x.cipher?.seal === 'function' && typeof x.cipher?.open === 'function' && !!x.contract && typeof x.contract === 'object';
};

export async function resolveHomologationProviders(env: Record<string, string | undefined>, options: { adapters?: readonly ProviderAdapter[]; loadSynthetic?: () => Promise<{ createSyntheticProviders(key: string): HomologationProviders }> } = {}): Promise<ProviderResolution> {
  for (const adapter of options.adapters ?? REVIEWED_ADAPTERS) {
    let p: HomologationProviders | null; try { p = await adapter(env); } catch { return { ok: false, code: 'ADAPTER_INVALID', detail: 'el adaptador revisado falló al construirse' }; }
    if (p === null) continue;
    return validShape(p) ? { ok: true, source: 'REVIEWED_ADAPTER', providers: p } : { ok: false, code: 'ADAPTER_INVALID', detail: 'el adaptador revisado no cumple el contrato de puertos' };
  }
  const synthetic = syntheticProvidersDecision(env);
  if (synthetic.ok) {
    // Importación DIFERIDA y solo si la compuerta lo permite: el código de laboratorio no entra en el arranque de un proceso externo.
    const mod = await (options.loadSynthetic ?? (() => import('./synthetic-providers')))();
    const providers = mod.createSyntheticProviders(env.PS_HOMOLOG_SYNTHETIC_KEY as string);
    return validShape(providers) ? { ok: true, source: 'SYNTHETIC_TEST_ONLY', providers } : { ok: false, code: 'ADAPTER_INVALID', detail: 'proveedores sintéticos inválidos' };
  }
  return synthetic.reason === 'NOT_REQUESTED'
    ? { ok: false, code: 'PROVIDERS_NOT_AVAILABLE', detail: 'no hay un adaptador revisado (verificador D02, KMS y contrato D06 pendientes): el runtime permanece cerrado' }
    : { ok: false, code: 'SYNTHETIC_PROVIDERS_REFUSED', detail: `los proveedores sintéticos de prueba se rechazan: ${synthetic.reason}` };
}
