import { createHash } from 'node:crypto';
import { checkInstallationEligibility, type InstallationInput, type InstallationTrust } from './installation-gate';
import type { AttestationTarget, CompositionDescriptor, Attestation, ResourceIdentityAuthority } from './conformance-attestation';
import { assertDisjointTrust } from './registry-identity-authority';
import { createKmsKeyProvider, parseKmsConfig, type KmsClient } from './kms-adapter';
import { REVIEWED_KMS_ADAPTERS, selectKmsClient, type KmsAdapterRegistry } from './kms-provider-selection';
import { accountMatches, parseAccount, validateDatabaseSeparation, type DbIdentity } from './database-identity';
import { auditGrants, type PrivilegePolicy } from './grants-audit';
import type { TrustedClock } from './security-contracts';

// PRICESMART API-20 — PREFLIGHT de una futura composición productiva. Comprueba, SIN EJECUTAR la composición y sin escribir nada, que sus piezas de seguridad están en orden: configuración y salud del KMS, separación
// de identidades de base de datos frente a laboratorio, sesión y privilegios mínimos de la cuenta de ejecución, confianza LAB/PRODUCTION disjunta y —si se aporta— atestación vigente de la composición.
// Es una VERIFICACIÓN TÉCNICA: `passed` NO autoriza instalar nada, NO cambia el readiness (siguen `ready=false` / 503 DISABLED) y NO declara nada de producción listo. Solo usa lecturas fijas e idénticas
// (`PreflightDatabase`: identidad de sesión y `SHOW GRANTS`), una comprobación de salud de solo lectura del KMS y verificaciones locales; no consume nonces ni crea claves. El informe contiene identificadores,
// estados y códigos, jamás valores de configuración, claves ni mensajes de error, y lleva un resumen SHA-256 para que una auditoría pueda comparar ejecuciones.
export type PreflightStatus = 'PASS' | 'FAIL' | 'SKIPPED';
export type PreflightCheck = { id: string; status: PreflightStatus; code?: string };
export type PreflightReport = { target: AttestationTarget; passed: boolean; ready: false; authorizesInstallation: false; checks: PreflightCheck[]; digest: string };
/** Lecturas FIJAS de solo lectura contra la base: no se admite SQL libre. */
export interface PreflightDatabase { identity(): Promise<{ db: string; account: string }>; grants(): Promise<string[]> }

export type PreflightInput = {
  target: AttestationTarget;
  env: Record<string, string | undefined>;
  /** SOLO laboratorio (cliente sintético). En PRODUCCIÓN se IGNORA por completo: el cliente verificado procede exclusivamente de la selección oficial del registro revisado. */
  kmsClient?: KmsClient;
  database: { lab: DbIdentity; production: DbIdentity };
  db: PreflightDatabase;
  trust: InstallationTrust;
  policy?: PrivilegePolicy;
  /** Opcionales: si se aportan los cinco, se verifica la atestación de la composición (sin consumir el nonce). */
  attestation?: { composition: CompositionDescriptor; attestation: Attestation; key: Uint8Array; authority: ResourceIdentityAuthority; clock: TrustedClock };
};

async function step(id: string, fn: () => Promise<{ pass: boolean; code?: string }>): Promise<PreflightCheck> {
  try { const r = await fn(); return r.pass ? { id, status: 'PASS' } : { id, status: 'FAIL', code: r.code ?? 'FAILED' }; }
  catch { return { id, status: 'FAIL', code: 'UNAVAILABLE' }; }   // cualquier excepción = fallo cerrado, sin detalles
}

/** Ejecutor del preflight ligado a UN registro de proveedores revisados. El ejecutor público (`runProductionPreflight`) está ligado al registro OFICIAL; solo las pruebas construyen otro para simular, de forma aislada,
 *  un futuro registro oficial no vacío. El llamador del preflight NUNCA elige el registro ni, en PRODUCCIÓN, el cliente. */
export function createProductionPreflightRunnerForTests(reviewed: KmsAdapterRegistry) { return (input: PreflightInput) => runWith(reviewed, input); }
export const runProductionPreflight = (input: PreflightInput): Promise<PreflightReport> => runWith(REVIEWED_KMS_ADAPTERS, input);

async function runWith(reviewed: KmsAdapterRegistry, input: PreflightInput): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const target = input?.target === 'LAB' || input?.target === 'PRODUCTION' ? input.target : 'PRODUCTION';
  const kms = parseKmsConfig(input?.env ?? {});
  checks.push(await step('KMS_CONFIG', async () => (kms.ok ? { pass: true } : { pass: false, code: 'KMS_CONFIG_INVALID' })));
  checks.push(await step('KMS_TARGET', async () => (kms.ok && kms.config.target === target ? { pass: true } : { pass: false, code: kms.ok ? 'KMS_TARGET_MISMATCH' : 'KMS_CONFIG_INVALID' })));
  // API-21 (auditoría de #615): el cliente KMS que se verifica en PRODUCCIÓN se obtiene EXCLUSIVAMENTE de la selección oficial (registro revisado ligado a este ejecutor); `input.kmsClient` se ignora. Hoy el registro oficial está vacío ⇒ falla.
  // En LAB se usa el cliente sintético inyectado (nunca puede ratificar PRODUCCIÓN).
  let client: KmsClient | null = null;
  checks.push(await step('KMS_PROVIDER_REVIEWED', async () => {
    if (target === 'LAB') { client = input.kmsClient ?? null; return client ? { pass: true } : { pass: false, code: 'KMS_CLIENT_MISSING' }; }
    if (!kms.ok) return { pass: false, code: 'KMS_CONFIG_INVALID' };
    if (kms.config.target !== 'PRODUCTION') return { pass: false, code: 'KMS_TARGET_MISMATCH' };   // un proveedor aprobado para otro destino no se selecciona
    const selection = selectKmsClient(kms.config, reviewed);
    if (!selection.ok) return { pass: false, code: selection.reason };
    client = selection.client; return { pass: true };
  }));
  checks.push(await step('KMS_HEALTH', async () => {
    if (!kms.ok) return { pass: false, code: 'KMS_CONFIG_INVALID' };
    if (!client) return { pass: false, code: 'BLOCKED_BY_PREVIOUS' };
    return (await createKmsKeyProvider({ client, config: kms.config }).health()) ? { pass: true } : { pass: false, code: 'KMS_UNHEALTHY' };
  }));
  const separation = validateDatabaseSeparation(input?.database ?? {});
  checks.push(await step('DB_SEPARATION', async () => (separation.ok ? { pass: true } : { pass: false, code: separation.issues[0]?.code ?? 'SEPARATION_INVALID' })));
  const expected = input?.database?.[target === 'LAB' ? 'lab' : 'production'];
  checks.push(await step('DB_SESSION_IDENTITY', async () => {
    if (!expected) return { pass: false, code: 'MISSING_IDENTITY' };
    const id = await input.db.identity();
    if (id?.db !== expected.schema) return { pass: false, code: 'SESSION_IDENTITY_MISMATCH' };
    if (parseAccount(id?.account) === null) return { pass: false, code: 'SESSION_IDENTITY_MALFORMED' };   // sin '@', varios '@', vacío, caracteres inválidos
    // CUENTA EFECTIVA COMPLETA: usuario Y host exactos (otro host, comodín o mismo usuario con otro host = otra identidad)
    return accountMatches(id.account, { user: expected.runtimeUser, host: expected.runtimeHost }) ? { pass: true } : { pass: false, code: 'SESSION_IDENTITY_MISMATCH' };
  }));
  checks.push(await step('DB_GRANTS', async () => {
    if (!expected) return { pass: false, code: 'MISSING_IDENTITY' };
    const audit = auditGrants(await input.db.grants(), { schema: expected.schema, policy: input.policy });
    if (!audit.ok) return { pass: false, code: audit.findings[0]?.code ?? 'GRANTS_INVALID' };
    return audit.complete ? { pass: true } : { pass: false, code: 'MISSING_PRIVILEGE' };
  }));
  checks.push(await step('TRUST_SEPARATION', async () => { assertDisjointTrust({ lab: input.trust?.lab, production: input.trust?.production }); return { pass: true }; }));
  const a = input?.attestation;
  if (!a || !a.composition || !a.attestation || !a.key || !a.authority || !a.clock) checks.push({ id: 'ATTESTATION', status: 'SKIPPED', code: 'NOT_PROVIDED' });
  else checks.push(await step('ATTESTATION', async () => {
    const decision = await checkInstallationEligibility({ composition: a.composition, attestation: a.attestation, target, key: a.key, authority: a.authority, trust: input.trust, clock: a.clock } as InstallationInput);
    return decision.eligible ? { pass: true } : { pass: false, code: decision.reason };
  }));
  const digest = createHash('sha256').update(JSON.stringify(['pricesmart-api20-preflight-v1', target, checks])).digest('hex');
  return { target, passed: checks.every(c => c.status === 'PASS'), ready: false, authorizesInstallation: false, checks, digest };
}
