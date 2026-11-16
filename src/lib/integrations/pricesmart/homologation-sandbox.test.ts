import { describe, expect, it } from 'vitest';
import { CURRENT_LAB_PROFILE, evaluateSandboxExposure, sandboxProfileSchema, type SandboxProfile } from './homologation-sandbox';
import { assessDeliveryEvidence, deliveryEvidenceUnavailable } from './delivery-evidence';
import { hasReviewedKmsAdapter } from './kms-provider-selection';

// El registro OFICIAL de adaptadores KMS (vacío hoy) es la fuente del hecho; los módulos de producción no lo importan (guardia estático de API-21).
const official = { kmsAdapterReviewed: hasReviewedKmsAdapter() };
const evaluate = (profile: unknown) => evaluateSandboxExposure(profile, official);

// PRICESMART API-25 — pruebas de los requisitos del sandbox de homologación y de la evidencia de entrega (puras, sin base de datos).
const ideal = (): SandboxProfile => ({
  transport: { httpsOnly: true, tlsTerminationDeclared: true, networkAllowlist: true },
  database: { dedicatedServer: true, sharesServerWithProduction: false, schemaPrefix: 'sandbox_api02_homolog_main' },
  secrets: { distinctFromProduction: true, storedOutsideRepository: true, rotationProcedure: true },
  verifier: { kind: 'EXTERNAL', d02RatifiedByPriceSmart: true },
  data: { syntheticOnly: true, fictitiousCompaniesAndClubs: true },
  limits: { rateLimit: true, bodyLimit: true, replayProtection: true },
  operations: { reproducibleProvisioning: true, destroyProcedure: true, monitoring: true, revocationProcedure: true },
  process: { nodeEnv: 'production-like-staging', novalvionEnv: 'sandbox', labCompositionFlagPresent: false, productionFlagsUntouched: true },
});

describe('API-25 requisitos del sandbox de homologación', () => {
  it('NUNCA autoriza la exposición externa: ni con un perfil ideal (falta el adaptador KMS revisado, que no es declarable)', () => {
    const r = evaluate(ideal());
    expect(r.authorizesExternalExposure).toBe(false); expect(r.exposable).toBe(false);
    expect(r.blockers).toEqual(['KMS_ADAPTER_REVIEWED']);   // lo único que falta con todo declarado: depende del estado real del código
    expect(r.satisfied).toEqual(expect.arrayContaining(['HTTPS_ONLY', 'DB_DEDICATED_SERVER', 'SECRETS_SEPARATED', 'D02_RATIFIED_BY_PRICESMART', 'LAB_COMPOSITION_ABSENT']));
  });
  it('el laboratorio local actual NO es un sandbox de homologación: lista exactamente por qué (HMAC sintético, esquema sandbox_api02_, sin HTTPS, flag de laboratorio presente…)', () => {
    const r = evaluate(CURRENT_LAB_PROFILE);
    expect(r.blockers).toEqual(expect.arrayContaining(['HTTPS_ONLY', 'NETWORK_ALLOWLIST', 'DB_DEDICATED_SERVER', 'DB_SCHEMA_PREFIX_NOT_LAB', 'LAB_VERIFIER_NOT_ALLOWED_EXTERNALLY', 'LAB_COMPOSITION_ABSENT', 'KMS_ADAPTER_REVIEWED', 'SECRET_ROTATION_PROCEDURE', 'MONITORING']));
    expect(r.exposable).toBe(false);
  });
  it('cada requisito incumplido añade su propio bloqueante (aislado de los demás)', () => {
    const cases: Array<[string, (p: SandboxProfile) => void]> = [
      ['HTTPS_ONLY', (p) => { p.transport.httpsOnly = false; }], ['HTTPS_ONLY', (p) => { p.transport.tlsTerminationDeclared = false; }], ['NETWORK_ALLOWLIST', (p) => { p.transport.networkAllowlist = false; }],
      ['DB_DEDICATED_SERVER', (p) => { p.database.sharesServerWithProduction = true; }], ['DB_DEDICATED_SERVER', (p) => { p.database.dedicatedServer = false; }],
      ['DB_SCHEMA_PREFIX_NOT_LAB', (p) => { p.database.schemaPrefix = 'sandbox_api02_x'; }], ['DB_SCHEMA_PREFIX_NOT_LAB', (p) => { p.database.schemaPrefix = 'novalvion'; }], ['DB_SCHEMA_PREFIX_NOT_LAB', (p) => { p.database.schemaPrefix = 'sandbox_api02_0123456789abcdef'; }],
      ['SECRETS_SEPARATED', (p) => { p.secrets.distinctFromProduction = false; }], ['SECRETS_SEPARATED', (p) => { p.secrets.storedOutsideRepository = false; }], ['SECRET_ROTATION_PROCEDURE', (p) => { p.secrets.rotationProcedure = false; }],
      ['DATA_SYNTHETIC_ONLY', (p) => { p.data.syntheticOnly = false; }], ['DATA_SYNTHETIC_ONLY', (p) => { p.data.fictitiousCompaniesAndClubs = false; }],
      ['LIMITS_AND_REPLAY', (p) => { p.limits.replayProtection = false; }], ['LIMITS_AND_REPLAY', (p) => { p.limits.rateLimit = false; }], ['LIMITS_AND_REPLAY', (p) => { p.limits.bodyLimit = false; }],
      ['PROVISIONING_REPRODUCIBLE', (p) => { p.operations.reproducibleProvisioning = false; }], ['DESTROY_PROCEDURE', (p) => { p.operations.destroyProcedure = false; }],
      ['MONITORING', (p) => { p.operations.monitoring = false; }], ['REVOCATION_PROCEDURE', (p) => { p.operations.revocationProcedure = false; }],
      ['PRODUCTION_UNTOUCHED', (p) => { p.process.nodeEnv = 'production'; }], ['PRODUCTION_UNTOUCHED', (p) => { p.process.novalvionEnv = 'production'; }], ['PRODUCTION_UNTOUCHED', (p) => { p.process.productionFlagsUntouched = false; }],
      ['LAB_COMPOSITION_ABSENT', (p) => { p.process.labCompositionFlagPresent = true; }], ['D02_RATIFIED_BY_PRICESMART', (p) => { p.verifier.d02RatifiedByPriceSmart = false; }],
      ['LAB_VERIFIER_NOT_ALLOWED_EXTERNALLY', (p) => { p.verifier.kind = 'LAB_HMAC'; }], ['VERIFIER_NOT_PROVIDED', (p) => { p.verifier.kind = 'NONE'; }],
    ];
    for (const [id, mutate] of cases) { const p = ideal(); mutate(p); expect(evaluate(p).blockers, id).toContain(id); }
  });
  it('el hecho del KMS lo aporta el llamador: solo `true` estricto cuenta como revisado, y con todo cumplido la lista de bloqueantes queda vacía pero la exposición NO se autoriza', () => {
    for (const v of [undefined, null, 1, 'true', {}]) expect(evaluateSandboxExposure(ideal(), { kmsAdapterReviewed: v } as never).blockers, String(v)).toContain('KMS_ADAPTER_REVIEWED');
    expect(evaluateSandboxExposure(ideal(), undefined as never).blockers).toContain('KMS_ADAPTER_REVIEWED');
    const allClear = evaluateSandboxExposure(ideal(), { kmsAdapterReviewed: true });
    expect(allClear.blockers).toEqual([]); expect(allClear.exposable).toBe(false); expect(allClear.authorizesExternalExposure).toBe(false);   // lista vacía ≠ autorización: la decide una revisión humana
    expect(official.kmsAdapterReviewed).toBe(false);   // hoy el registro oficial está vacío
  });
  it('perfiles inválidos, con campos de más (secretos) o de otro tipo → PROFILE_INVALID, y el informe nunca contiene valores del perfil', () => {
    for (const bad of [null, undefined, 'x', {}, { ...ideal(), apiKey: 'secreto-1234' }, { ...ideal(), secrets: { ...ideal().secrets, value: 'secreto-1234' } }, { ...ideal(), transport: { httpsOnly: 'sí' } }]) {
      const r = evaluate(bad); expect(r.blockers).toEqual(['PROFILE_INVALID']); expect(r.exposable).toBe(false); expect(JSON.stringify(r)).not.toContain('secreto-1234');
    }
    expect(sandboxProfileSchema.safeParse(ideal()).success).toBe(true);
    const leaked = evaluate({ ...ideal(), database: { ...ideal().database, schemaPrefix: 'sandbox_api02_homolog_main' } });
    expect(JSON.stringify(leaked)).not.toContain('sandbox_api02_homolog_main');
  });
});

describe('API-25 evidencia mínima de entrega (interna, sin política externa)', () => {
  const stops = [{ id: 1, type: 'Carga' }, { id: 2, type: 'Entrega' }, { id: 3, type: 'Entrega' }, { id: 4, type: 'Descarga' }];
  const ok = (stopId: number) => ({ stopId, result: 'ENTREGADA_POR_PILOTO', revision: 'NO_REQUERIDA', hasEvidence: true });
  it('sin confirmaciones → NONE; una de dos → PARTIAL; todas las entregas con evidencia → PILOT_CONFIRMED_ALL; siempre confirmsDelivery=false, publishable=false, no aceptada por PriceSmart', () => {
    for (const [conf, level, n] of [[[], 'NONE', 0], [[ok(2)], 'PARTIAL', 1], [[ok(2), ok(3)], 'PILOT_CONFIRMED_ALL', 2]] as const) {
      const r = assessDeliveryEvidence(stops, [...conf]);
      expect(r).toMatchObject({ level, deliveryStops: 2, pilotConfirmed: n, pendingReview: 0, confirmsDelivery: false, publishable: false, officialAcceptance: 'NOT_ACCEPTED_BY_PRICESMART', blockedBy: ['D13_PENDING'] });
    }
  });
  it('Carga y Descarga (centro de distribución) no cuentan como entregas; confirmar solo la Descarga no confirma nada', () => {
    expect(assessDeliveryEvidence(stops, [ok(4), ok(1)]).level).toBe('REVIEW_REQUIRED');   // confirmaciones de paradas que no son entregas: incoherente
    expect(assessDeliveryEvidence(stops, []).deliveryStops).toBe(2);
  });
  it('PARCIAL/RECHAZADA/INCIDENCIA pendientes, confirmación sin evidencia, resultados desconocidos o plan sin paradas de entrega → REVIEW_REQUIRED (nunca «entregada»)', () => {
    const pend = (r: string) => ({ stopId: 2, result: r, revision: 'PENDIENTE', hasEvidence: true });
    for (const r of ['PARCIAL', 'RECHAZADA', 'INCIDENCIA']) expect(assessDeliveryEvidence(stops, [ok(3), pend(r)])).toMatchObject({ level: 'REVIEW_REQUIRED', pendingReview: 1 });
    expect(assessDeliveryEvidence(stops, [{ ...ok(2), hasEvidence: false }]).level).toBe('REVIEW_REQUIRED');
    expect(assessDeliveryEvidence(stops, [{ ...ok(2), result: 'ENTREGADO' }]).level).toBe('REVIEW_REQUIRED');
    expect(assessDeliveryEvidence(stops, [{ stopId: 2, result: 'PARCIAL', revision: 'NO_REQUERIDA', hasEvidence: true }]).level).toBe('REVIEW_REQUIRED');
    expect(assessDeliveryEvidence([{ id: 1, type: 'Carga' }, { id: 4, type: 'Descarga' }], []).level).toBe('REVIEW_REQUIRED');
    expect(assessDeliveryEvidence(stops, [ok(2), ok(3), ok(9)]).level).toBe('REVIEW_REQUIRED');   // parada ajena al plan
  });
  it('duplicados de la misma parada no inflan el conteo; «no disponible» nunca se confunde con «sin entregas»', () => {
    expect(assessDeliveryEvidence(stops, [ok(2), ok(2)])).toMatchObject({ level: 'PARTIAL', pilotConfirmed: 1 });
    expect(deliveryEvidenceUnavailable()).toMatchObject({ level: 'UNAVAILABLE', confirmsDelivery: false, publishable: false });
    expect(JSON.stringify(assessDeliveryEvidence(stops, [ok(2), ok(3)]))).not.toMatch(/DELIVERED|ENTREGADA/);
  });
});
