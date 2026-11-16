import type { KmsClient } from './kms-config';

// PRICESMART API-27 — KIT DE CONFORMIDAD de un cliente KMS/HSM. Cualquier adaptador de proveedor que algún día quiera entrar en `REVIEWED_KMS_ADAPTERS` debe pasar este kit ANTES de la revisión humana; pasarlo
// NO lo aprueba (la aprobación sigue siendo una decisión de seguridad pendiente del proveedor/KMS, ver decision-registry.ts). El kit no abre conexiones ni conoce ningún proveedor: recibe un `KmsClient` ya construido
// (con identidad de servicio propia) y dos alias de PRUEBA con claves distintas. Comprueba las propiedades de seguridad que exige `createKmsKeyProvider` del puerto: ligadura al contexto y al alias, detección de
// manipulación, cifrado no determinista, sin texto claro ni material en errores, sin mutar entradas y salud de solo lectura. No imprime ni devuelve datos: solo identificadores de comprobación.

export type KmsConformanceCheckId =
  | 'ROUNDTRIP' | 'NO_PLAINTEXT_IN_CIPHERTEXT' | 'NON_DETERMINISTIC' | 'CONTEXT_BINDING' | 'ALIAS_BINDING' | 'TAMPER_DETECTED' | 'TRUNCATION_REJECTED' | 'UNKNOWN_ALIAS_REJECTED'
  | 'ERRORS_DO_NOT_LEAK' | 'INPUTS_NOT_MUTATED' | 'ABORT_SETTLES' | 'HEALTH_BOOLEAN';
export const KMS_CONFORMANCE_CHECKS: readonly KmsConformanceCheckId[] = ['ROUNDTRIP', 'NO_PLAINTEXT_IN_CIPHERTEXT', 'NON_DETERMINISTIC', 'CONTEXT_BINDING', 'ALIAS_BINDING', 'TAMPER_DETECTED', 'TRUNCATION_REJECTED', 'UNKNOWN_ALIAS_REJECTED', 'ERRORS_DO_NOT_LEAK', 'INPUTS_NOT_MUTATED', 'ABORT_SETTLES', 'HEALTH_BOOLEAN'];
/**
 * Cancelación (señal YA abortada). Dos cosas distintas:
 *  - `ABORT_SETTLES` (EXIGIDA): con una señal ya abortada la llamada debe TERMINAR (resolver o rechazar) en un tiempo acotado; un cliente que se cuelga no es conforme.
 *  - `cancellation` (INFORMATIVA, no bloquea `conformant`): `HONORED` = el cliente RECHAZÓ la llamada con la señal abortada (respeta la cancelación); `IGNORED` = la completó como si nada (ignora la señal). `IGNORED`
 *    NO valida la cancelación: significa que la señal no se respeta y que la protección depende del envoltorio `createKmsKeyProvider` (que no envía ni reintenta tras abortar) y de los tiempos límite. El kit solo ejercita
 *    una señal abortada ANTES de la llamada; la cancelación a mitad de vuelo no se puede probar de forma genérica y debe revisarse en el adaptador concreto.
 */
export type KmsCancellation = 'HONORED' | 'IGNORED' | 'HUNG';
export type KmsConformanceReport = { conformant: boolean; checks: Array<{ id: KmsConformanceCheckId; pass: boolean }>; cancellation: KmsCancellation };
export type KmsConformanceOptions = { aliases: readonly [string, string]; unknownAlias?: string; abortTimeoutMs?: number };

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const contains = (haystack: Uint8Array, needle: Uint8Array) => { for (let i = 0; i + needle.length <= haystack.length; i++) { let k = 0; while (k < needle.length && haystack[i + k] === needle[k]) k++; if (k === needle.length) return true; } return false; };
const rejects = async (run: () => Promise<unknown>): Promise<{ rejected: boolean; error?: unknown; value?: unknown }> => { try { return { rejected: false, value: await run() }; } catch (error) { return { rejected: true, error }; } };
/** Texto observable de un error (mensaje, nombre, código y causa) para buscar fugas. */
const observable = (e: unknown): string => { try { const o = e as { message?: unknown; name?: unknown; code?: unknown; cause?: unknown }; return [String(o?.message ?? ''), String(o?.name ?? ''), String(o?.code ?? ''), o?.cause === undefined ? '' : observable(o.cause), String(e)].join('|'); } catch { return ''; } };
const forms = (b: Uint8Array) => [Buffer.from(b).toString('hex'), Buffer.from(b).toString('base64'), Buffer.from(b).toString('base64url'), Buffer.from(b).toString('latin1')];

export async function runKmsClientConformance(client: KmsClient, options: KmsConformanceOptions): Promise<KmsConformanceReport> {
  const [alias, other] = options.aliases; const unknown = options.unknownAlias ?? 'lab.alias-inexistente-conformidad';
  if (alias === other || typeof client?.encrypt !== 'function' || typeof client?.decrypt !== 'function') return { conformant: false, checks: KMS_CONFORMANCE_CHECKS.map((id) => ({ id, pass: false })), cancellation: 'HUNG' };
  const results = new Map<KmsConformanceCheckId, boolean>(); const record = (id: KmsConformanceCheckId, pass: boolean) => results.set(id, pass);
  const key = () => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) & 0xff);   // clave de datos de PRUEBA (no secreta, determinista para detectar eco)
  const context = 'Y29udGV4dG8tZGUtcHJ1ZWJh';
  const enc = (a = alias, ctx = context, pt = key(), signal?: AbortSignal) => client.encrypt({ alias: a, plaintext: pt, context: ctx, signal });
  const dec = (ct: Uint8Array, a = alias, ctx = context, signal?: AbortSignal) => client.decrypt({ alias: a, ciphertext: ct, context: ctx, signal });
  const guard = async (id: KmsConformanceCheckId, body: () => Promise<boolean>) => { try { record(id, await body()); } catch { record(id, false); } };

  let ct: Uint8Array | null = null; try { ct = await enc(); } catch { ct = null; }
  const valid = ct instanceof Uint8Array && ct.length >= 1 && ct.length <= 4096;
  await guard('ROUNDTRIP', async () => valid && sameBytes(await dec(ct!), key()));
  await guard('NO_PLAINTEXT_IN_CIPHERTEXT', async () => valid && !contains(ct!, key()));
  await guard('NON_DETERMINISTIC', async () => { const second = await enc(); return valid && !sameBytes(ct!, second); });
  await guard('CONTEXT_BINDING', async () => { const r = await rejects(() => dec(ct!, alias, `${context}x`)); return valid && r.rejected; });
  await guard('ALIAS_BINDING', async () => { const r = await rejects(() => dec(ct!, other)); return valid && r.rejected; });
  await guard('TAMPER_DETECTED', async () => {
    if (!valid) return false;
    for (const position of [0, Math.floor(ct!.length / 2), ct!.length - 1]) { const bad = Uint8Array.from(ct!); bad[position] ^= 0x01; const r = await rejects(() => dec(bad)); if (!r.rejected) return false; }
    return true;
  });
  await guard('TRUNCATION_REJECTED', async () => valid && (await rejects(() => dec(ct!.subarray(0, Math.max(0, ct!.length - 1))))).rejected && (await rejects(() => dec(new Uint8Array(0)))).rejected);
  await guard('UNKNOWN_ALIAS_REJECTED', async () => (await rejects(() => enc(unknown))).rejected && valid && (await rejects(() => dec(ct!, unknown))).rejected);
  await guard('ERRORS_DO_NOT_LEAK', async () => {
    if (!valid) return false;
    const secret = key(); const probes = [await rejects(() => dec(ct!, alias, `${context}x`)), await rejects(() => enc(unknown)), await rejects(() => dec(Uint8Array.from(ct!, (b, i) => (i === 0 ? b ^ 1 : b))))];
    const needles = [...forms(secret), ...forms(ct!)].filter((n) => n.length >= 8);
    return probes.every((p) => p.rejected && !needles.some((n) => observable(p.error).includes(n)));
  });
  await guard('INPUTS_NOT_MUTATED', async () => { const pt = key(); const c = await enc(alias, context, pt); const snapshot = Uint8Array.from(c); await dec(c); return valid && sameBytes(pt, key()) && sameBytes(c, snapshot); });
  let cancellation: KmsCancellation = 'HUNG';
  await guard('ABORT_SETTLES', async () => {
    const controller = new AbortController(); controller.abort(); const limit = options.abortTimeoutMs ?? 2000; let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([rejects(() => enc(alias, context, key(), controller.signal)), new Promise<'hung'>((resolve) => { timer = setTimeout(() => resolve('hung'), limit); })]);
      if (outcome === 'hung') return false; cancellation = outcome.rejected ? 'HONORED' : 'IGNORED'; return true;
    } finally { if (timer) clearTimeout(timer); }
  });
  await guard('HEALTH_BOOLEAN', async () => typeof client.health === 'function' && typeof (await client.health()) === 'boolean');

  const checks = KMS_CONFORMANCE_CHECKS.map((id) => ({ id, pass: results.get(id) === true }));
  return { conformant: checks.every((c) => c.pass), checks, cancellation };
}
