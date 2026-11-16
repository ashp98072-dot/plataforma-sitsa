import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KMS_CONFORMANCE_CHECKS, runKmsClientConformance, type KmsConformanceCheckId } from './kms-client-conformance';
import { createLabKmsClient } from './lab-demo/lab-kms-client';
import { createKmsKeyProvider, parseKmsConfig } from './kms-adapter';
import { REVIEWED_KMS_ADAPTERS } from './kms-provider-selection';
import type { KmsClient } from './kms-config';

const ALIASES = ['lab.conformidad-a', 'lab.conformidad-b'] as const;
type Mode = 'deterministic' | 'ignoreContext' | 'sharedKey' | 'malleable' | 'echo' | 'leakyErrors' | 'noHealth' | 'hangsOnAbort' | 'acceptsAnyAlias' | 'badHealth' | 'honorsAbort';

/** Cliente de PRUEBA con un defecto concreto (cada uno debe ser detectado por exactamente la comprobación que lo cubre). Sin defecto = AES-256-GCM correcto. */
function fake(mode: Mode | null): KmsClient {
  const masters = new Map(ALIASES.map((a) => [a, randomBytes(32)] as const)); const shared = randomBytes(32); const fixedIv = Buffer.alloc(12, 7);
  const masterOf = (alias: string) => { if (mode === 'sharedKey') return shared; const k = masters.get(alias as (typeof ALIASES)[number]); if (!k) { if (mode === 'acceptsAnyAlias') return shared; throw new Error('alias desconocido'); } return k; };
  return {
    async encrypt({ alias, plaintext, context, signal }) {
      if (mode === 'hangsOnAbort' && signal?.aborted) return new Promise<Uint8Array>(() => undefined);
      if (mode === 'honorsAbort' && signal?.aborted) throw new Error('cancelado');
      if (mode === 'echo') return new Uint8Array(Buffer.concat([Buffer.from(plaintext), Buffer.alloc(16, 1)]));
      if (mode === 'malleable') { const k = masterOf(alias); return Uint8Array.from(plaintext, (b, i) => b ^ k[i % 32]); }
      const iv = mode === 'deterministic' ? fixedIv : randomBytes(12); const c = createCipheriv('aes-256-gcm', masterOf(alias), iv); if (mode !== 'ignoreContext') c.setAAD(Buffer.from(context));
      const body = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]); return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), body]));
    },
    async decrypt({ alias, ciphertext, context }) {
      try {
        if (mode === 'echo') return new Uint8Array(Buffer.from(ciphertext).subarray(0, 32));
        if (mode === 'malleable') { const k = masterOf(alias); return Uint8Array.from(ciphertext, (b, i) => b ^ k[i % 32]); }
        const w = Buffer.from(ciphertext); if (w.length < 28) throw new Error('inválido');
        const d = createDecipheriv('aes-256-gcm', masterOf(alias), w.subarray(0, 12)); if (mode !== 'ignoreContext') d.setAAD(Buffer.from(context)); d.setAuthTag(w.subarray(12, 28));
        return new Uint8Array(Buffer.concat([d.update(w.subarray(28)), d.final()]));
      } catch (error) { if (mode === 'leakyErrors') throw new Error(`fallo al descifrar ${Buffer.from(ciphertext).toString('hex')}`); throw error; }
    },
    ...(mode === 'noHealth' ? {} : { async health() { return mode === 'badHealth' ? ('sí' as unknown as boolean) : true; } }),
  };
}
const failing = (report: { checks: Array<{ id: KmsConformanceCheckId; pass: boolean }> }) => report.checks.filter((c) => !c.pass).map((c) => c.id);

describe('API-27 kit de conformidad de clientes KMS', () => {
  it('CANCELACIÓN con señal ya abortada: terminar es EXIGIDO (ABORT_SETTLES); rechazar (`HONORED`) vs completar (`IGNORED`) se informa APARTE y un cliente que ignora la señal NO se da por validado en cancelación', async () => {
    const honors = await runKmsClientConformance(fake('honorsAbort'), { aliases: ALIASES }); expect(honors).toMatchObject({ conformant: true, cancellation: 'HONORED' });
    const ignores = await runKmsClientConformance(fake(null), { aliases: ALIASES }); expect(ignores.conformant).toBe(true); expect(ignores.cancellation).toBe('IGNORED'); expect(ignores.cancellation).not.toBe('HONORED');   // conforme en seguridad de cifrado, pero la cancelación NO está validada
    const hangs = await runKmsClientConformance(fake('hangsOnAbort'), { aliases: ALIASES, abortTimeoutMs: 80 }); expect(hangs).toMatchObject({ conformant: false, cancellation: 'HUNG' }); expect(failing(hangs)).toContain('ABORT_SETTLES');
    expect((await runKmsClientConformance({} as KmsClient, { aliases: ALIASES })).cancellation).toBe('HUNG');
  });
  it('el envoltorio `createKmsKeyProvider` NO envía nada al cliente con una señal ya abortada, aunque el cliente la ignore (la protección no depende de que el cliente coopere)', async () => {
    let calls = 0; const base = fake(null); const counting: KmsClient = { encrypt: async (i) => { calls++; return base.encrypt(i); }, decrypt: async (i) => { calls++; return base.decrypt(i); }, health: async () => true };
    const cfg = parseKmsConfig({ PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: ALIASES[0], PRICESMART_KMS_ALLOWED_ALIASES: ALIASES.join(',') }); if (!cfg.ok) throw new Error(cfg.issues.join());
    const provider = createKmsKeyProvider({ client: counting, config: cfg.config }); const controller = new AbortController(); controller.abort();
    await expect(provider.wrapKey({ keyReference: ALIASES[0], dataKey: randomBytes(32), aad: Buffer.from('aad'), signal: controller.signal })).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(calls).toBe(0);
    const wrapped = await provider.wrapKey({ keyReference: ALIASES[0], dataKey: randomBytes(32), aad: Buffer.from('aad') }); expect(calls).toBe(1);
    await expect(provider.unwrapKey({ keyReference: ALIASES[0], wrappedKey: wrapped, aad: Buffer.from('aad'), signal: controller.signal })).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(calls).toBe(1);
  });
  it('un cliente correcto (AES-256-GCM con contexto y alias) pasa TODAS las comprobaciones, y el cliente de laboratorio también', async () => {
    const good = await runKmsClientConformance(fake(null), { aliases: ALIASES }); expect(good).toMatchObject({ conformant: true, cancellation: 'IGNORED' }); expect(good.checks.map((c) => c.id)).toEqual([...KMS_CONFORMANCE_CHECKS]);
    const lab = await runKmsClientConformance(createLabKmsClient([...ALIASES]), { aliases: ALIASES }); expect(failing(lab)).toEqual([]); expect(lab.conformant).toBe(true); expect(lab.cancellation).toBe('HONORED');   // el cliente de laboratorio SÍ respeta una señal ya abortada
  });
  it.each([
    ['deterministic', 'NON_DETERMINISTIC'], ['ignoreContext', 'CONTEXT_BINDING'], ['sharedKey', 'ALIAS_BINDING'], ['malleable', 'TAMPER_DETECTED'], ['echo', 'NO_PLAINTEXT_IN_CIPHERTEXT'],
    ['leakyErrors', 'ERRORS_DO_NOT_LEAK'], ['noHealth', 'HEALTH_BOOLEAN'], ['badHealth', 'HEALTH_BOOLEAN'], ['hangsOnAbort', 'ABORT_SETTLES'], ['acceptsAnyAlias', 'UNKNOWN_ALIAS_REJECTED'],
  ] as const)('defecto «%s» → NO conforme y falla la comprobación %s', async (mode, expected) => {
    const report = await runKmsClientConformance(fake(mode), { aliases: ALIASES, abortTimeoutMs: 80 });
    expect(report.conformant).toBe(false); expect(failing(report)).toContain(expected);
  });
  it('entradas inválidas (mismo alias dos veces, cliente sin encrypt/decrypt) → NO conforme sin lanzar', async () => {
    expect((await runKmsClientConformance(fake(null), { aliases: [ALIASES[0], ALIASES[0]] })).conformant).toBe(false);
    expect((await runKmsClientConformance({} as KmsClient, { aliases: ALIASES })).conformant).toBe(false);
    expect((await runKmsClientConformance({ encrypt: async () => { throw new Error('x'); }, decrypt: async () => { throw new Error('x'); } }, { aliases: ALIASES })).conformant).toBe(false);
  });
  it('el informe solo contiene identificadores y booleanos (ni datos ni claves ni mensajes)', async () => {
    const report = await runKmsClientConformance(fake('leakyErrors'), { aliases: ALIASES }); expect(Object.keys(report).sort()).toEqual(['cancellation', 'checks', 'conformant']);
    for (const c of report.checks) expect(Object.keys(c).sort()).toEqual(['id', 'pass']);
  });
  it('un cliente conforme funciona dentro de `createKmsKeyProvider` (cifrado de sobre real) y un alias fuera de la lista se rechaza con NOT_ALLOWED', async () => {
    const cfg = parseKmsConfig({ PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: ALIASES[0], PRICESMART_KMS_ALLOWED_ALIASES: ALIASES.join(',') }); if (!cfg.ok) throw new Error(cfg.issues.join());
    const provider = createKmsKeyProvider({ client: fake(null), config: cfg.config }); const dataKey = randomBytes(32); const aad = Buffer.from('aad-de-prueba');
    const wrapped = await provider.wrapKey({ keyReference: ALIASES[0], dataKey, aad }); expect(Buffer.from(await provider.unwrapKey({ keyReference: ALIASES[0], wrappedKey: wrapped, aad })).equals(dataKey)).toBe(true);
    await expect(provider.unwrapKey({ keyReference: ALIASES[0], wrappedKey: wrapped, aad: Buffer.from('otro-aad') })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(provider.wrapKey({ keyReference: 'lab.fuera-de-lista', dataKey, aad })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });
  it('BARRERA: `REVIEWED_KMS_ADAPTERS` sigue VACÍO (ningún proveedor aprobado) y cualquier entrada futura debe pasar este kit con su propia fábrica', async () => {
    expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]);
    for (const [providerId, registration] of Object.entries(REVIEWED_KMS_ADAPTERS)) {   // hoy no itera: cuando exista un adaptador revisado, esta prueba lo obliga a ser conforme
      const cfg = parseKmsConfig({ PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: ALIASES[0], PRICESMART_KMS_ALLOWED_ALIASES: ALIASES.join(',') }); if (!cfg.ok) throw new Error('configuración de prueba inválida');
      const report = await runKmsClientConformance(registration.create({ config: { ...cfg.config, providerId }, serviceIdentityRef: 'conformidad' }), { aliases: ALIASES }); expect(report.conformant, providerId).toBe(true);
    }
  });
});
