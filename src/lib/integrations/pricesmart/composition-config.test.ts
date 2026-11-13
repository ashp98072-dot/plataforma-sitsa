import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCompositionConfig } from './composition-config';
import { parseKmsConfig } from './kms-config';
import { REVIEWED_KMS_ADAPTERS, hasReviewedKmsAdapter, selectKmsClient, selectReviewedKmsClient, type KmsAdapterRegistry } from './kms-provider-selection';
import type { KmsClient, KmsConfig } from './kms-config';

const base = (over: Record<string, string | undefined> = {}) => ({
  PRICESMART_COMPOSITION_TARGET: 'PRODUCTION', PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1',
  PRICESMART_DB_HOST: 'db.interno.example', PRICESMART_DB_PORT: '3306', PRICESMART_DB_SCHEMA: 'prod_pricesmart',
  PRICESMART_DB_RUNTIME_USER: 'ps_runtime', PRICESMART_DB_RUNTIME_HOST: 'localhost', PRICESMART_DB_REGISTRY_WRITER_USER: 'ps_registry', PRICESMART_DB_REGISTRY_WRITER_HOST: 'localhost',
  PRICESMART_DB_MIGRATION_USER: 'ps_migrator', PRICESMART_DB_MIGRATION_HOST: 'localhost', ...over });
const lab = (over: Record<string, string | undefined> = {}) => base({
  PRICESMART_COMPOSITION_TARGET: 'LAB', PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1',
  PRICESMART_DB_HOST: '127.0.0.1', PRICESMART_DB_PORT: '3307', PRICESMART_DB_SCHEMA: 'sandbox_api02_x', PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_run', PRICESMART_DB_RUNTIME_HOST: '127.0.0.1',
  PRICESMART_DB_REGISTRY_WRITER_USER: 'sandbox_api02_reg', PRICESMART_DB_REGISTRY_WRITER_HOST: '127.0.0.1', PRICESMART_DB_MIGRATION_USER: 'sandbox_api02_mig', PRICESMART_DB_MIGRATION_HOST: '127.0.0.1', ...over });
const issues = (env: Record<string, string | undefined>) => { const r = parseCompositionConfig(env); return r.ok ? [] : r.issues; };

describe('configuración de composición separada por destino', () => {
  it('PRODUCTION y LAB válidos; resultado congelado con la identidad del destino', () => {
    for (const env of [base(), lab()]) { const r = parseCompositionConfig(env); expect(r.ok).toBe(true); if (r.ok) { expect(Object.isFrozen(r.config) && Object.isFrozen(r.config.database)).toBe(true); expect(r.config.target).toBe(env.PRICESMART_COMPOSITION_TARGET); expect(r.config.kms.target).toBe(r.config.target); } }
  });
  it('falla cerrada ante entorno vacío, destino ausente/ inválido y campos de base de datos ausentes o inválidos', () => {
    expect(parseCompositionConfig({}).ok).toBe(false); expect(parseCompositionConfig(undefined as never).ok).toBe(false);
    for (const t of [undefined, '', 'STAGING', 'prod']) expect(issues(base({ PRICESMART_COMPOSITION_TARGET: t })).join()).toContain('PRICESMART_COMPOSITION_TARGET');
    for (const name of ['PRICESMART_DB_HOST', 'PRICESMART_DB_PORT', 'PRICESMART_DB_SCHEMA', 'PRICESMART_DB_RUNTIME_USER', 'PRICESMART_DB_RUNTIME_HOST', 'PRICESMART_DB_REGISTRY_WRITER_USER', 'PRICESMART_DB_MIGRATION_HOST']) expect(parseCompositionConfig(base({ [name]: undefined })).ok, name).toBe(false);
    for (const port of ['0', '70000', 'abc', '3306x', '-1']) expect(parseCompositionConfig(base({ PRICESMART_DB_PORT: port })).ok, port).toBe(false);
  });
  it('una configuración de PRODUCCIÓN rechaza cualquier resto de laboratorio (variables, nombres, hosts, alias, sandbox)', () => {
    for (const lastro of [{ PRICESMART_LAB_DEMO: 'SINTETICO-LOCAL-SIN-PRODUCCION' }, { PRICESMART_LAB_KEY: 'x'.repeat(40) }, { PRICESMART_LAB_WORKER_MS: '1000' }]) expect(issues(base(lastro)).join(), JSON.stringify(Object.keys(lastro))).toContain('variable de laboratorio presente');
    expect(issues(base({ NOVALVION_ENV: 'sandbox' })).join()).toContain('NOVALVION_ENV');
    expect(parseCompositionConfig(base({ PRICESMART_DB_SCHEMA: 'sandbox_api02_x' })).ok).toBe(false); expect(parseCompositionConfig(base({ PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_run' })).ok).toBe(false);
    expect(parseCompositionConfig(base({ PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1' })).ok).toBe(false);
    expect(parseCompositionConfig(base({ PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1' })).ok).toBe(false);
  });
  it('una configuración de LABORATORIO rechaza NODE_ENV=production, alias/identidad de producción y hosts que no son loopback', () => {
    expect(issues(lab({ NODE_ENV: 'production' })).join()).toContain('NODE_ENV');
    expect(parseCompositionConfig(lab({ PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1' })).ok).toBe(false);
    expect(parseCompositionConfig(lab({ PRICESMART_DB_SCHEMA: 'prod_pricesmart' })).ok).toBe(false); expect(parseCompositionConfig(lab({ PRICESMART_DB_HOST: '10.0.0.5' })).ok).toBe(false);
    expect(parseCompositionConfig(lab({ PRICESMART_DB_RUNTIME_HOST: '%' })).ok).toBe(false); expect(parseCompositionConfig(lab({ PRICESMART_COMPOSITION_TARGET: 'PRODUCTION' })).ok).toBe(false);
  });
  it('producción: cuentas distintas, sin comodines y sin nombres privilegiados; el mismo usuario con otro host no vale', () => {
    expect(parseCompositionConfig(base({ PRICESMART_DB_REGISTRY_WRITER_USER: 'ps_runtime', PRICESMART_DB_REGISTRY_WRITER_HOST: '10.0.0.9' })).ok).toBe(false);
    for (const h of ['%', '10.0.%', 'db_1']) expect(parseCompositionConfig(base({ PRICESMART_DB_RUNTIME_HOST: h })).ok, h).toBe(false);
    for (const u of ['root', 'admin', 'MYSQL']) expect(parseCompositionConfig(base({ PRICESMART_DB_MIGRATION_USER: u })).ok, u).toBe(false);
  });
  it('NUNCA admite credenciales: contraseñas, claves, tokens, certificados en variables de base de datos, de composición o de KMS', () => {
    const names = ['PRICESMART_DB_PASSWORD', 'PRICESMART_DB_RUNTIME_PASSWORD', 'PRICESMART_DB_MIGRATION_PASSWD', 'PRICESMART_DB_TOKEN', 'PRICESMART_DB_SSL_CERT', 'PRICESMART_DB_PRIVATE_KEY', 'PRICESMART_COMPOSITION_SECRET', 'PRICESMART_KMS_API_KEY', 'PRICESMART_KMS_CREDENTIALS', 'PRICESMART_DB_CONNECTION_STRING'];
    for (const name of names) { const r = parseCompositionConfig(base({ [name]: 'valor-secreto-xyz-123' })); expect(r.ok, name).toBe(false); if (!r.ok) { expect(JSON.stringify(r.issues)).not.toContain('valor-secreto-xyz-123'); expect(r.issues.join()).toContain(name); } }
  });
  it('los mensajes citan nombres y códigos, jamás valores (hosts, cuentas, esquema, alias)', () => {
    const r = parseCompositionConfig(base({ PRICESMART_DB_SCHEMA: 'sandbox_api02_x', PRICESMART_DB_RUNTIME_HOST: '10.99.%', PRICESMART_LAB_KEY: 'k'.repeat(40) })); const text = JSON.stringify(r);
    expect(r.ok).toBe(false); for (const v of ['sandbox_api02_x', '10.99.%', 'db.interno.example', 'ps_runtime', 'prod.k1', 'kkkkkkkk']) expect(text).not.toContain(v);
  });
  it('el módulo es puro: no lee process.env ni importa infraestructura', () => {
    const t = readFileSync(path.join(__dirname, 'composition-config.ts'), 'utf8').replace(/\/\/.*$/gm, ''); expect(t).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|node:|@\/)/);
  });
});

describe('configuración KMS: proveedor y identidad de servicio como referencias NO secretas', () => {
  const k = (over: Record<string, string | undefined> = {}) => ({ PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1', ...over });
  it('proveedor e identidad opcionales (null por omisión); formatos válidos e inválidos', () => {
    const none = parseKmsConfig(k()); expect(none.ok && none.config.providerId === null && none.config.serviceIdentityRef === null).toBe(true);
    const some = parseKmsConfig(k({ PRICESMART_KMS_PROVIDER: 'proveedor-a', PRICESMART_KMS_SERVICE_IDENTITY: 'ns/identidad-ps:v1' })); expect(some.ok && some.config.providerId === 'proveedor-a' && some.config.serviceIdentityRef === 'ns/identidad-ps:v1').toBe(true);
    for (const bad of [{ PRICESMART_KMS_PROVIDER: 'A' }, { PRICESMART_KMS_PROVIDER: 'x' }, { PRICESMART_KMS_PROVIDER: 'con espacios' }, { PRICESMART_KMS_SERVICE_IDENTITY: 'con espacios' }, { PRICESMART_KMS_SERVICE_IDENTITY: 'a=b' }, { PRICESMART_KMS_SERVICE_IDENTITY: 'a@b' }, { PRICESMART_KMS_SERVICE_IDENTITY: '/inicia' }]) expect(parseKmsConfig(k(bad)).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe('selección del proveedor KMS: falla cerrada', () => {
  const cfg = (over: Record<string, string | undefined> = {}): KmsConfig => { const r = parseKmsConfig({ PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1', PRICESMART_KMS_PROVIDER: 'lab-memoria', PRICESMART_KMS_SERVICE_IDENTITY: 'identidad-lab', ...over }); if (!r.ok) throw new Error(r.issues.join()); return r.config; };
  const client = (): KmsClient => ({ encrypt: async () => new Uint8Array(1), decrypt: async () => new Uint8Array(32) });
  const registry = (over: Partial<KmsAdapterRegistry[string]> = {}): KmsAdapterRegistry => ({ 'lab-memoria': { targets: ['LAB'], create: () => client(), ...over } });
  it('el registro revisado del repositorio está VACÍO (ningún proveedor seleccionado): cualquier configuración falla con KMS_PROVIDER_NOT_SELECTED', () => {
    expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]); expect(hasReviewedKmsAdapter()).toBe(false); expect(Object.isFrozen(REVIEWED_KMS_ADAPTERS)).toBe(true);
    expect(selectReviewedKmsClient(cfg())).toEqual({ ok: false, reason: 'KMS_PROVIDER_NOT_SELECTED' });
    expect(selectReviewedKmsClient(cfg({ PRICESMART_KMS_PROVIDER: undefined }))).toEqual({ ok: false, reason: 'KMS_PROVIDER_NOT_SELECTED' });
    expect(() => { (REVIEWED_KMS_ADAPTERS as Record<string, unknown>).intruso = {}; }).toThrow();   // no se puede registrar nada en tiempo de ejecución
  });
  it('sin proveedor configurado, proveedor desconocido o sin identidad de servicio: códigos cerrados', () => {
    expect(selectKmsClient(cfg({ PRICESMART_KMS_PROVIDER: undefined }), registry())).toEqual({ ok: false, reason: 'KMS_PROVIDER_NOT_SELECTED' });
    expect(selectKmsClient(cfg({ PRICESMART_KMS_PROVIDER: 'otro-proveedor' }), registry())).toEqual({ ok: false, reason: 'KMS_PROVIDER_UNKNOWN' });
    expect(selectKmsClient(cfg({ PRICESMART_KMS_SERVICE_IDENTITY: undefined }), registry())).toEqual({ ok: false, reason: 'SERVICE_IDENTITY_MISSING' });
    expect(selectKmsClient(cfg({ PRICESMART_KMS_PROVIDER: 'constructor' }), registry())).toEqual({ ok: false, reason: 'KMS_PROVIDER_UNKNOWN' });   // no se resuelve por la cadena de prototipos
  });
  it('un adaptador aprobado solo para LAB no se usa en PRODUCTION', () => {
    const prod = cfg({ PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1' });
    expect(selectKmsClient(prod, registry())).toEqual({ ok: false, reason: 'KMS_PROVIDER_NOT_APPROVED_FOR_TARGET' });
    expect(selectKmsClient(prod, registry({ targets: ['LAB', 'PRODUCTION'] })).ok).toBe(true); expect(selectKmsClient(cfg(), registry()).ok).toBe(true);
  });
  it('un adaptador que lanza, devuelve basura o una entrada mal formada falla cerrado sin detalles', () => {
    const boom = selectKmsClient(cfg(), registry({ create: () => { throw new Error('secreto-adaptador'); } })); expect(boom).toEqual({ ok: false, reason: 'ADAPTER_FAILED' }); expect(JSON.stringify(boom)).not.toContain('secreto');
    for (const bad of [null, {}, { encrypt: () => 1 }, 'x']) expect(selectKmsClient(cfg(), registry({ create: () => bad as never }))).toEqual({ ok: false, reason: 'ADAPTER_FAILED' });
    expect(selectKmsClient(cfg(), registry({ targets: 'LAB' as never }))).toEqual({ ok: false, reason: 'KMS_PROVIDER_NOT_APPROVED_FOR_TARGET' }); expect(selectKmsClient(cfg(), null as never).ok).toBe(false);
  });
  it('la fábrica solo recibe la configuración y una REFERENCIA de identidad (nunca credenciales)', () => {
    let seen: unknown; selectKmsClient(cfg(), registry({ create: (i) => { seen = i; return client(); } }));
    expect(Object.keys(seen as object).sort()).toEqual(['config', 'serviceIdentityRef']); expect((seen as { serviceIdentityRef: string }).serviceIdentityRef).toBe('identidad-lab');
  });
  it('el módulo de selección es puro y no lo importa la aplicación', () => {
    const t = readFileSync(path.join(__dirname, 'kms-provider-selection.ts'), 'utf8').replace(/\/\/.*$/gm, ''); expect(t).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|node:|@\/)/);
  });
});
