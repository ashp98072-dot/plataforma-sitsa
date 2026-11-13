import { z } from 'zod';
import { reference } from './contracts';
import { policySchema, type AbusePolicy } from './security-contracts';

// PRICESMART API-14 — configuración validada del runtime. Función PURA: recibe un objeto de entorno, no lee process.env, no abre conexiones, no contiene secretos.
// Seguridad por defecto: sin PRICESMART_RUNTIME_MODE (o con un valor inválido) el modo es DISABLED. Nada de lo definido aquí inventa valores de PriceSmart
// (endpoints, certificados, contrato de orden): esos llegan como puertos inyectados y se reportan como bloqueos mientras D02/D06/D08/D09/D12 sigan pendientes.
export const RUNTIME_MODES = ['DISABLED', 'READ_ONLY', 'ENABLED'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
/** Frase de confirmación explícita para ENABLED: evita activar el runtime por una variable mal copiada. */
export const ENABLE_ACK = 'CONFIRMO-ACTIVAR-PRICESMART-SANDBOX';

/** Decisiones de PriceSmart que deben estar ratificadas (declaradas por el operador) para cada modo. Supuesto conservador de este PR; ajustable cuando PriceSmart las confirme. */
export const REQUIRED_DECISIONS: Readonly<Record<Exclude<RuntimeMode, 'DISABLED'>, readonly string[]>> = {
  READ_ONLY: ['D02', 'D06'],
  ENABLED: ['D02', 'D06', 'D08', 'D09', 'D12'],
};
const num = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const envSchema = z.object({
  PRICESMART_RUNTIME_MODE: z.enum(RUNTIME_MODES),
  PRICESMART_RUNTIME_ACK: z.string().optional(),
  PRICESMART_RUNTIME_ENVIRONMENT: z.literal('sandbox'),   // el contrato de seguridad solo modela `sandbox`; `production` es una decisión pendiente (ver docs/api14)
  PRICESMART_RATIFIED_DECISIONS: z.string().regex(/^(D\d{2})(,D\d{2})*$/).optional(),   // lo declara el operador SOLO tras la confirmación escrita de PriceSmart
  PRICESMART_ORIGIN_CLUB: reference.max(64),
  PRICESMART_DB_SCHEMA: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
  PRICESMART_DB_RUNTIME_USER: z.string().regex(/^[A-Za-z0-9_]{1,32}$/),
  PRICESMART_TIMEOUT_MS: num(1000, 60000).default(20000),
  PRICESMART_MAX_BODY_BYTES: num(1024, 1_048_576).default(8192),
  PRICESMART_MAX_EVIDENCE_BYTES: num(256, 65536).default(4096),
  PRICESMART_RATE_PER_WINDOW: num(1, 100000).default(120),
  PRICESMART_RATE_WINDOW_MS: num(1000, 3_600_000).default(60000),
  PRICESMART_MAX_PROOF_AGE_MS: num(1000, 3_600_000).default(300000),
  PRICESMART_FUTURE_SKEW_MS: num(0, 60000).default(5000),
  PRICESMART_REPLAY_RETENTION_MS: num(1000, 86_400_000).default(400000),
}).strict();

export type RuntimeConfig = Readonly<{
  ratified: readonly string[];
  mode: RuntimeMode; environment: 'sandbox'; originClub: string; schema: string; runtimeUser: string;
  policy: AbusePolicy;
  limits: { originClubReference: string; timeoutMs: number; maxHeaderBytes: number; maxHeaderCount: number; maxUrlBytes: number; maxBodyChunks: number };
}>;
export type ConfigResult =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; mode: 'DISABLED'; issues: string[] };

const KEYS = Object.keys(envSchema.shape);
/** Devuelve SIEMPRE un resultado cerrado: `ok:false` implica modo DISABLED. Los mensajes citan nombres de variables, nunca valores. */
export function parseRuntimeConfig(env: Record<string, string | undefined>): ConfigResult {
  const mode = env.PRICESMART_RUNTIME_MODE;
  // Sin modo (o DISABLED explícito) no se exige nada más: el estado por defecto es apagado y válido.
  if (mode === undefined || mode === '' || mode === 'DISABLED') return { ok: false, mode: 'DISABLED', issues: [] };
  const picked: Record<string, string> = {};
  for (const k of KEYS) { const v = env[k]; if (v !== undefined && v !== '') picked[k] = v; }
  const parsed = envSchema.safeParse(picked);
  const issues = parsed.success ? [] : [...new Set(parsed.error.issues.map(i => `${String(i.path[0] ?? 'config')}: inválida o ausente`))];
  if (parsed.success && parsed.data.PRICESMART_RUNTIME_MODE === 'ENABLED' && parsed.data.PRICESMART_RUNTIME_ACK !== ENABLE_ACK) issues.push('PRICESMART_RUNTIME_ACK: confirmación explícita ausente');
  if (!parsed.success || issues.length) return { ok: false, mode: 'DISABLED', issues };
  const d = parsed.data;
  const policy = {
    maxEvidenceBytes: d.PRICESMART_MAX_EVIDENCE_BYTES, maxBodyBytes: d.PRICESMART_MAX_BODY_BYTES, requestsPerWindow: d.PRICESMART_RATE_PER_WINDOW, windowMs: d.PRICESMART_RATE_WINDOW_MS,
    maxProofAgeMs: d.PRICESMART_MAX_PROOF_AGE_MS, futureSkewMs: d.PRICESMART_FUTURE_SKEW_MS, replayRetentionMs: d.PRICESMART_REPLAY_RETENTION_MS,
  };
  const checked = policySchema.safeParse(policy);
  if (!checked.success) return { ok: false, mode: 'DISABLED', issues: ['política antiabuso incoherente (retención de replay menor que edad máxima + desfase)'] };
  return { ok: true, config: Object.freeze({
    ratified: Object.freeze([...new Set((d.PRICESMART_RATIFIED_DECISIONS ?? '').split(',').filter(Boolean))].sort()),
    mode: d.PRICESMART_RUNTIME_MODE, environment: d.PRICESMART_RUNTIME_ENVIRONMENT, originClub: d.PRICESMART_ORIGIN_CLUB, schema: d.PRICESMART_DB_SCHEMA, runtimeUser: d.PRICESMART_DB_RUNTIME_USER,
    policy: Object.freeze(checked.data),
    limits: Object.freeze({ originClubReference: d.PRICESMART_ORIGIN_CLUB, timeoutMs: d.PRICESMART_TIMEOUT_MS, maxHeaderBytes: 8192, maxHeaderCount: 48, maxUrlBytes: 2048, maxBodyChunks: 64 }),
  }) };
}
