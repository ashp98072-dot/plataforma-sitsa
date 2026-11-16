import { z } from 'zod';

// PRICESMART API-25 — requisitos EJECUTABLES para que Mónaco entregue un sandbox de homologación a PriceSmart. Función PURA: no lee el entorno, no abre conexiones, no instala nada y no autoriza nada.
// Recibe un PERFIL DECLARATIVO del sandbox propuesto (solo booleanos y nombres: nunca secretos, claves ni URLs con credenciales) y devuelve los BLOQUEANTES que siguen vigentes.
// El adaptador KMS revisado NO forma parte del perfil declarativo: lo aporta el LLAMADOR desde el registro oficial (`hasReviewedKmsAdapter()`, hoy falso) como segundo argumento OBLIGATORIO. Este módulo no importa módulos de
// composición (lo impide un guardia estático) y no puede sustituir ese hecho por un valor por omisión.
// Por eso `authorizesExternalExposure` es SIEMPRE false: este módulo lista lo que falta; la exposición externa solo podrá autorizarla una revisión humana cuando la lista esté vacía.
// El laboratorio local (esquemas `sandbox_api02_*`, verificador HMAC sintético, `PRICESMART_LAB_*`) NO es un sandbox de homologación y se rechaza explícitamente.
const bool = z.boolean();
export const sandboxProfileSchema = z.object({
  transport: z.object({ httpsOnly: bool, tlsTerminationDeclared: bool, networkAllowlist: bool }).strict(),
  database: z.object({ dedicatedServer: bool, sharesServerWithProduction: bool, schemaPrefix: z.string().max(64) }).strict(),
  secrets: z.object({ distinctFromProduction: bool, storedOutsideRepository: bool, rotationProcedure: bool }).strict(),
  verifier: z.object({ kind: z.enum(['NONE', 'LAB_HMAC', 'EXTERNAL']), d02RatifiedByPriceSmart: bool }).strict(),
  data: z.object({ syntheticOnly: bool, fictitiousCompaniesAndClubs: bool }).strict(),
  limits: z.object({ rateLimit: bool, bodyLimit: bool, replayProtection: bool }).strict(),
  operations: z.object({ reproducibleProvisioning: bool, destroyProcedure: bool, monitoring: bool, revocationProcedure: bool }).strict(),
  process: z.object({ nodeEnv: z.string().max(32), novalvionEnv: z.string().max(32), labCompositionFlagPresent: bool, productionFlagsUntouched: bool }).strict(),
}).strict();
export type SandboxProfile = z.infer<typeof sandboxProfileSchema>;

export type SandboxExposureReport = { authorizesExternalExposure: false; exposable: false; blockers: string[]; satisfied: string[] };

/**
 * Nombre propio de un sandbox de homologación. Cumple los guardas VIGENTES del repositorio (`sandbox_api02_[a-z0-9_]+`, que NO se relajan) pero se distingue del laboratorio local, cuyos nombres son
 * `sandbox_api02_<id hexadecimal del run>`: `homolog` contiene letras no hexadecimales, así que un nombre de laboratorio jamás puede coincidir.
 */
export const HOMOLOGATION_SCHEMA_PREFIX = /^sandbox_api02_homolog_[a-z0-9_]{1,30}$/;

export function evaluateSandboxExposure(input: unknown, facts: { kmsAdapterReviewed: boolean }): SandboxExposureReport {
  const report = (blockers: string[], satisfied: string[]): SandboxExposureReport => ({ authorizesExternalExposure: false, exposable: false, blockers: [...new Set(blockers)], satisfied });
  const parsed = sandboxProfileSchema.safeParse(input);
  if (!parsed.success) return report(['PROFILE_INVALID'], []);
  const p = parsed.data; const blockers: string[] = []; const satisfied: string[] = [];
  const need = (id: string, ok: boolean) => { (ok ? satisfied : blockers).push(id); };
  need('HTTPS_ONLY', p.transport.httpsOnly && p.transport.tlsTerminationDeclared);
  need('NETWORK_ALLOWLIST', p.transport.networkAllowlist);
  need('DB_DEDICATED_SERVER', p.database.dedicatedServer && !p.database.sharesServerWithProduction);
  need('DB_SCHEMA_PREFIX_NOT_LAB', HOMOLOGATION_SCHEMA_PREFIX.test(p.database.schemaPrefix));
  need('SECRETS_SEPARATED', p.secrets.distinctFromProduction && p.secrets.storedOutsideRepository);
  need('SECRET_ROTATION_PROCEDURE', p.secrets.rotationProcedure);
  need('DATA_SYNTHETIC_ONLY', p.data.syntheticOnly && p.data.fictitiousCompaniesAndClubs);
  need('LIMITS_AND_REPLAY', p.limits.rateLimit && p.limits.bodyLimit && p.limits.replayProtection);
  need('PROVISIONING_REPRODUCIBLE', p.operations.reproducibleProvisioning);
  need('DESTROY_PROCEDURE', p.operations.destroyProcedure);
  need('MONITORING', p.operations.monitoring);
  need('REVOCATION_PROCEDURE', p.operations.revocationProcedure);
  need('PRODUCTION_UNTOUCHED', p.process.productionFlagsUntouched && p.process.nodeEnv !== 'production' && p.process.novalvionEnv !== 'production');
  need('LAB_COMPOSITION_ABSENT', !p.process.labCompositionFlagPresent);
  // El verificador: el HMAC sintético JAMÁS sirve para un sandbox externo; uno externo exige el acuerdo D02 de PriceSmart.
  if (p.verifier.kind === 'LAB_HMAC') blockers.push('LAB_VERIFIER_NOT_ALLOWED_EXTERNALLY');
  else if (p.verifier.kind === 'NONE') blockers.push('VERIFIER_NOT_PROVIDED');
  else need('D02_RATIFIED_BY_PRICESMART', p.verifier.d02RatifiedByPriceSmart);
  // Hecho aportado por el llamador desde el registro oficial (no declarable en el perfil): sin adaptador KMS revisado no hay forma de custodiar claves de un sandbox externo.
  need('KMS_ADAPTER_REVIEWED', facts?.kmsAdapterReviewed === true);   // cualquier otro valor (ausente, truthy no booleano) cuenta como NO revisado
  return report(blockers, satisfied);
}

/** Perfil del estado actual del repositorio/laboratorio, para mostrar qué falta HOY. No se usa para decidir nada. */
export const CURRENT_LAB_PROFILE: SandboxProfile = Object.freeze({
  transport: { httpsOnly: false, tlsTerminationDeclared: false, networkAllowlist: false },
  database: { dedicatedServer: false, sharesServerWithProduction: false, schemaPrefix: 'sandbox_api02_' },
  secrets: { distinctFromProduction: true, storedOutsideRepository: true, rotationProcedure: false },
  verifier: { kind: 'LAB_HMAC', d02RatifiedByPriceSmart: false },
  data: { syntheticOnly: true, fictitiousCompaniesAndClubs: true },
  limits: { rateLimit: true, bodyLimit: true, replayProtection: true },
  operations: { reproducibleProvisioning: true, destroyProcedure: true, monitoring: false, revocationProcedure: true },
  process: { nodeEnv: 'development', novalvionEnv: 'sandbox', labCompositionFlagPresent: true, productionFlagsUntouched: true },
}) as SandboxProfile;
