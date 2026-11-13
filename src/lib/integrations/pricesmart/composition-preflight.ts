import { createHash } from 'node:crypto';
import { parseCompositionConfig } from './composition-config';
import { REVIEWED_KMS_ADAPTERS, sanitizeLabAdapters, selectKmsClient, type KmsAdapterRegistry } from './kms-provider-selection';
import { accountMatches, type DbIdentity } from './database-identity';
import { auditRoleGrants, type AccountRole } from './grants-audit';
import { runProductionPreflight, type PreflightCheck, type PreflightDatabase, type PreflightInput } from './production-preflight';
import type { AttestationTarget } from './conformance-attestation';

// PRICESMART API-21 — PREFLIGHT DE COMPOSICIÓN (nivel superior). Reúne, sin ejecutar nada de la composición y sin escribir, lo que hace falta para considerar siquiera instalar una composición real: configuración
// por destino válida y estrictamente separada, proveedor KMS SELECCIONADO y aprobado para el destino (hoy ninguno: falla cerrado con `KMS_PROVIDER_NOT_SELECTED`), el preflight de API-20 (KMS, separación de BD, sesión y
// privilegios de la cuenta de EJECUCIÓN, confianza, atestación) y las sesiones y privilegios mínimos de las otras DOS cuentas (escritura del registro y migración), que además deben ser cuentas efectivas DISTINTAS.
// Cada sesión se lee con una conexión PROPIA de esa cuenta mediante lecturas fijas (`PreflightDatabase`); este módulo no recibe contraseñas ni crea conexiones. `passed` es una verificación técnica: NO autoriza instalar,
// NO cambia el readiness y NO activa nada (`ready=false`, `authorizesInstallation=false` fijos). El informe contiene ids, estados y códigos —nunca valores— y un resumen SHA-256.
export type CompositionPreflightInput = {
  env: Record<string, string | undefined>;
  /** SOLO laboratorio y pruebas: adaptadores sintéticos. Se ignoran por completo para PRODUCCIÓN (que usa siempre el registro oficial `REVIEWED_KMS_ADAPTERS`) y, aun en LAB, cada entrada se fuerza a `['LAB']`. */
  labAdapters?: KmsAdapterRegistry;
  databases: { runtime: PreflightDatabase; registryWriter: PreflightDatabase; migration: PreflightDatabase };
  trust: PreflightInput['trust'];
  attestation?: PreflightInput['attestation'];
};
export type CompositionPreflightReport = { target: AttestationTarget; passed: boolean; ready: false; authorizesInstallation: false; checks: PreflightCheck[]; digest: string };

// Descriptores de REFERENCIA del destino contrario: solo permiten ejecutar las reglas de separación del preflight de API-20 sin pedir datos del otro entorno (la configuración ya garantiza las reglas de su destino).
const REFERENCE_LAB: DbIdentity = { host: '127.0.0.1', port: 3306, schema: 'sandbox_api02_reference', runtimeUser: 'sandbox_api02_ref_run', registryWriterUser: 'sandbox_api02_ref_reg', migrationUser: 'sandbox_api02_ref_mig', runtimeHost: '127.0.0.1', registryWriterHost: '127.0.0.1', migrationHost: '127.0.0.1' };
const REFERENCE_PRODUCTION: DbIdentity = { host: 'produccion.referencia.invalid', port: 3306, schema: 'referencia_produccion', runtimeUser: 'ref_prod_run', registryWriterUser: 'ref_prod_reg', migrationUser: 'ref_prod_mig', runtimeHost: 'referencia.invalid', registryWriterHost: 'referencia.invalid', migrationHost: 'referencia.invalid' };

async function step(id: string, fn: () => Promise<{ pass: boolean; code?: string }>): Promise<PreflightCheck> {
  try { const r = await fn(); return r.pass ? { id, status: 'PASS' } : { id, status: 'FAIL', code: r.code ?? 'FAILED' }; } catch { return { id, status: 'FAIL', code: 'UNAVAILABLE' }; }
}
const BLOCKED = (id: string): PreflightCheck => ({ id, status: 'FAIL', code: 'BLOCKED_BY_PREVIOUS' });
const PREFLIGHT_IDS = ['KMS_CONFIG', 'KMS_TARGET', 'KMS_HEALTH', 'DB_SEPARATION', 'DB_SESSION_IDENTITY', 'DB_GRANTS', 'TRUST_SEPARATION', 'ATTESTATION'];

export async function runCompositionPreflight(input: CompositionPreflightInput): Promise<CompositionPreflightReport> {
  const checks: PreflightCheck[] = [];
  const parsed = parseCompositionConfig(input?.env ?? {});
  checks.push(await step('COMPOSITION_CONFIG', async () => (parsed.ok ? { pass: true } : { pass: false, code: 'COMPOSITION_CONFIG_INVALID' })));
  const target: AttestationTarget = parsed.ok ? parsed.config.target : input?.env?.PRICESMART_COMPOSITION_TARGET === 'LAB' ? 'LAB' : 'PRODUCTION';   // si es inválida, el destino declarado solo rotula el informe (por omisión, el más estricto)
  let client: ReturnType<typeof selectKmsClient> | null = null;
  checks.push(await step('KMS_PROVIDER', async () => {
    if (!parsed.ok) return { pass: false, code: 'BLOCKED_BY_PREVIOUS' };
    // FUENTE DE CONFIANZA OBLIGATORIA: PRODUCCIÓN solo usa el registro revisado oficial; el llamador no puede sustituirlo. Los adaptadores sintéticos solo existen para LAB y no pueden aprobar PRODUCCIÓN.
    const registry = parsed.config.target === 'LAB' && input.labAdapters !== undefined ? sanitizeLabAdapters(input.labAdapters) : REVIEWED_KMS_ADAPTERS;
    client = selectKmsClient(parsed.config.kms, registry);
    return client.ok ? { pass: true } : { pass: false, code: client.reason };
  }));
  const kms = client as ReturnType<typeof selectKmsClient> | null;
  if (parsed.ok && kms?.ok) {
    const base = await runProductionPreflight({
      target, env: input.env, kmsClient: kms.client, db: input.databases.runtime, trust: input.trust, attestation: input.attestation,
      database: target === 'LAB' ? { lab: parsed.config.database, production: REFERENCE_PRODUCTION } : { lab: REFERENCE_LAB, production: parsed.config.database },
    });
    checks.push(...base.checks);
  } else for (const id of PREFLIGHT_IDS) checks.push(BLOCKED(id));

  const accounts: [string, AccountRole, PreflightDatabase | undefined, 'registryWriterUser' | 'migrationUser', 'registryWriterHost' | 'migrationHost'][] = [
    ['ACCOUNT_REGISTRY_WRITER', 'registryWriter', input?.databases?.registryWriter, 'registryWriterUser', 'registryWriterHost'],
    ['ACCOUNT_MIGRATION', 'migration', input?.databases?.migration, 'migrationUser', 'migrationHost'],
  ];
  const effective: string[] = [];
  for (const [id, role, db, userField, hostField] of accounts) {
    if (!parsed.ok || !db) { checks.push(BLOCKED(`${id}_SESSION`), BLOCKED(`${id}_GRANTS`)); continue; }
    const cfg = parsed.config.database;
    checks.push(await step(`${id}_SESSION`, async () => {
      const who = await db.identity(); effective.push(String(who?.account ?? '').toLowerCase());
      return who?.db === cfg.schema && accountMatches(who.account, { user: cfg[userField], host: cfg[hostField] }) ? { pass: true } : { pass: false, code: 'SESSION_IDENTITY_MISMATCH' };
    }));
    checks.push(await step(`${id}_GRANTS`, async () => {
      const audit = auditRoleGrants(role, await db.grants(), { schema: cfg.schema });
      if (!audit.ok) return { pass: false, code: audit.findings[0]?.code ?? 'GRANTS_INVALID' };
      return audit.complete ? { pass: true } : { pass: false, code: 'MISSING_PRIVILEGE' };
    }));
  }
  checks.push(await step('ACCOUNTS_DISTINCT', async () => {
    if (!parsed.ok) return { pass: false, code: 'BLOCKED_BY_PREVIOUS' };
    const runtime = String((await input.databases.runtime.identity())?.account ?? '').toLowerCase();
    const all = [runtime, ...effective];
    return all.length === 3 && all.every(Boolean) && new Set(all).size === 3 ? { pass: true } : { pass: false, code: 'ACCOUNTS_NOT_DISTINCT' };   // tres sesiones, tres cuentas efectivas diferentes
  }));
  const digest = createHash('sha256').update(JSON.stringify(['pricesmart-api21-composition-preflight-v1', target, checks])).digest('hex');
  return { target, passed: checks.every(c => c.status === 'PASS'), ready: false, authorizesInstallation: false, checks, digest };
}
