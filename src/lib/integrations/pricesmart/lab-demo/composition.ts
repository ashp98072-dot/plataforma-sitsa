import { getPool } from '@/lib/db';
import { createIsolatedHttpTransport } from '../http-transport';
import { mariaDbOrderRepository } from '../mariadb-repository';
import { mariaDbSecurityPorts } from '../security-mariadb';
import type { PriceSmartHandler } from '../runtime';
import { labContract } from './contract';
import { labCipher, labEvidencePort, labVerifier } from './lab-crypto';
import { createLinkRetry, startLinkWorker } from './link-retry';
import { createTmsLinker } from './tms-link';

// PRICESMART API-12 — composición EJECUTABLE solo para un laboratorio local aislado. Autenticación de PRUEBA (HMAC con una clave por ejecución), contrato de prueba `lab-demo-1`.
// No es el runtime productivo: se niega a construirse salvo que TODAS las condiciones se cumplan (ver labDemoGate). Sin las condiciones, devuelve null y las rutas siguen en 503 DISABLED.
export const LAB_DEMO_FLAG = 'SINTETICO-LOCAL-SIN-PRODUCCION';
export const LAB_CLUB = 'QA-CLUB';

export function labDemoGate(env: Record<string, string | undefined>): { ok: true } | { ok: false; reason: string } {
  if (env.NODE_ENV === 'production') return { ok: false, reason: 'NODE_ENV=production' };
  if (env.NOVALVION_ENV !== 'sandbox') return { ok: false, reason: 'no es sandbox' };
  if (env.PRICESMART_LAB_DEMO !== LAB_DEMO_FLAG) return { ok: false, reason: 'bandera de laboratorio ausente' };
  if (env.DB_HOST !== '127.0.0.1') return { ok: false, reason: 'la base no es loopback' };
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(env.DB_NAME ?? '') || !/^sandbox_api02_[a-z0-9_]+$/.test(env.DB_USER ?? '')) return { ok: false, reason: 'base/cuenta sin el patrón del laboratorio' };
  if ((env.PRICESMART_LAB_KEY ?? '').length < 32) return { ok: false, reason: 'clave de laboratorio ausente o corta' };
  return { ok: true };
}

export async function createLabDemoHandler(env: Record<string, string | undefined> = process.env): Promise<PriceSmartHandler | null> {
  if (!labDemoGate(env).ok) return null;
  const labKey = env.PRICESMART_LAB_KEY as string; const schema = env.DB_NAME as string; const runtimeUser = env.DB_USER as string;
  const pool = getPool();   // en modo sandbox ya es un pool verificado (sandboxPool)
  const repository = mariaDbOrderRepository(pool, { schema, runtimeUser, cipher: labCipher(labKey), contract: labContract });
  const security = mariaDbSecurityPorts(pool, { schema, runtimeUser });
  const linker = createTmsLinker({ pool, schema, repository });
  const retry = createLinkRetry({ pool, schema, linker });
  // Trabajador de reintentos en el proceso: SOLO si el entorno del laboratorio lo pide (PRICESMART_LAB_WORKER_MS ≥ 1000). Sin él, los reintentos los ejecuta quien invoque `runOnce`.
  const everyMs = Number(env.PRICESMART_LAB_WORKER_MS ?? 0);
  if (everyMs) startLinkWorker(retry, everyMs);
  const policy = { maxEvidenceBytes: 4096, maxBodyBytes: 8192, requestsPerWindow: 600, windowMs: 60000, maxProofAgeMs: 300000, futureSkewMs: 5000, replayRetentionMs: 400000 };
  const limits = { originClubReference: LAB_CLUB, timeoutMs: 20000, maxHeaderBytes: 8192, maxHeaderCount: 48, maxUrlBytes: 2048, maxBodyChunks: 64 };
  return createIsolatedHttpTransport(
    { evidence: labEvidencePort(), security: { verifier: labVerifier(labKey), catalog: security.catalog, revocation: security.revocation, clock: security.clock, counter: security.counter, replay: security.replay }, repository },
    policy, limits,
    {
      order: labContract,
      readExtra: ({ scope, externalOrderId, view }) => linker.status(scope, externalOrderId, view),
      afterCommit: async ({ operation, scope, externalOrderId }) => {
        // Vía rápida: encola la orden y la vincula de inmediato; si falla, el trabajo queda en cola para el trabajador (no hace falta que PriceSmart reenvíe).
        if (operation === 'orders:create') await retry.attemptNow(scope, externalOrderId);
        else if (operation === 'orders:cancel') await linker.noteCancellation(scope, externalOrderId);
      },
    });
}
