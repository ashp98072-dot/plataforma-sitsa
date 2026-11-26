import { readFileSync } from 'node:fs';
import type { Pool } from 'mysql2/promise';
import { guardEvidenceVerifier } from '../guarded-evidence-verifier';
import type { HttpEvidencePort } from '../http-transport';
import { installControlledRuntime, type Readiness, type RuntimePorts } from '../runtime-assembly';
import { mariaDbOrderRepository, type PayloadCipher } from '../mariadb-repository';
import { mariaDbSecurityPorts } from '../security-mariadb';
import { mariaDbOutboxStore } from '../outbox-mariadb';
import { DEFAULT_OUTBOX_POLICY, OutboxDispatcher, type OutboxLogEntry, type OutboxPolicy, type OutboxRunSummary } from '../outbox';
import type { OrderContractOptions } from '../contracts';
import type { EvidenceVerifier } from '../security-contracts';
import { createLinkRetry } from '../lab-demo/link-retry';
import { createTmsLinker } from '../lab-demo/tms-link';
import { createLinkOutboxHandler } from '../lab-demo/outbox-link-handler';

// PRICESMART API-26 — COMPOSICIÓN del sandbox de HOMOLOGACIÓN (host dedicado, base y aplicación en loopback). Reutiliza SIN reconstruir: puertos de seguridad M2M (security-mariadb), repositorio cifrado
// (mariadb-repository), outbox (outbox-mariadb + despachador), vinculación al TMS (tms-link, link-retry, outbox-link-handler) y el ensamblaje controlado (`installControlledRuntime`: modo, decisiones
// ratificadas, sondas, interruptor de emergencia).
// NO decide nada que dependa de PriceSmart: el VERIFICADOR (D02), el EXTRACTOR de evidencia (D02), el CIFRADO con KMS aprobado y el CONTRATO de la orden (D06) llegan INYECTADOS. Sin ellos este módulo no
// se puede completar, y mientras PRICESMART_RUNTIME_MODE=DISABLED o las decisiones no estén ratificadas, `installControlledRuntime` no instala nada (las rutas siguen en 503 DISABLED).
// Aislamiento: NO importa nada del laboratorio salvo la lógica de vinculación al TMS (tms-link / link-retry / outbox-link-handler); jamás `lab-crypto` (verificador HMAC), `composition`, `gate` ni `autoinstall`
// (una prueba estática lo verifica). El verificador inyectado SIEMPRE se envuelve con `guardEvidenceVerifier` (entorno exacto, copia, tiempo máximo, aserción válida o denegado).
export type HomologationDeps = {
  /** Pool verificado de sandbox con la cuenta de la APLICACIÓN. */ pool: Pool;
  /** Pool verificado de sandbox con la cuenta del WORKER de la outbox (privilegios acotados). */ workerPool: Pool;
  schema: string; runtimeUser: string; workerUser: string;
  evidence: HttpEvidencePort; verifier: EvidenceVerifier; cipher: PayloadCipher; contract: OrderContractOptions;
  /** true = apagar. Por omisión, `fileKillSwitch` sobre PS_HOMOLOG_KILLSWITCH_FILE. */ killSwitch: () => boolean | Promise<boolean>;
  outbox?: { policy?: OutboxPolicy; log?: (entry: OutboxLogEntry) => void };
};
export type OutboxConsumer = { runOnce(): Promise<OutboxRunSummary>; kick(): void; start(everyMs: number): void; stop(): void };
export type HomologationRuntime = { ports: RuntimePorts; consumer: OutboxConsumer };

/** Interruptor de emergencia por ARCHIVO: el servicio solo opera si el archivo existe y contiene exactamente `ON`. Ausente, ilegible o con otro contenido ⇒ APAGADO (cierra). Se lee en cada solicitud. */
export function fileKillSwitch(file: string): () => boolean {
  return () => { try { return readFileSync(file, 'utf8').trim() !== 'ON'; } catch { return true; } };
}

/** Consumidor de la outbox: un despachador (reclamo con lease, fencing, backoff, REVIEW) sobre el almacén real con la cuenta del worker. `kick` solicita un ciclo pronto sin bloquear la solicitud. */
export function createOutboxConsumer(dispatcher: Pick<OutboxDispatcher, 'runOnce'>, paused?: () => boolean | Promise<boolean>): OutboxConsumer {
  let running: Promise<OutboxRunSummary> | null = null; let timer: ReturnType<typeof setInterval> | undefined; let kicked = false;
  // APAGADO SEGURO: si el interruptor de emergencia apaga el servicio, el temporizador y la vía rápida NO procesan nada hacia el TMS (lo recibido queda durable y se procesa al reactivarlo). Un fallo al leerlo cuenta como apagado.
  // `runOnce` (uso explícito: pruebas y operación manual) no se ve afectado.
  const off = async (): Promise<boolean> => { if (!paused) return false; try { return (await paused()) !== false; } catch { return true; } };
  const go = () => { if (!paused) { void run().catch(() => undefined); return; } void off().then((o) => { if (!o) return run(); return undefined; }).catch(() => undefined); };
  const run = (): Promise<OutboxRunSummary> => {
    if (running) return running;
    running = dispatcher.runOnce().finally(() => { running = null; if (kicked) { kicked = false; go(); } });
    return running;
  };
  return {
    runOnce: run,
    kick() { if (running) { kicked = true; return; } go(); },
    start(everyMs) { if (timer || !Number.isSafeInteger(everyMs) || everyMs < 500) return; timer = setInterval(go, everyMs); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}

const SCHEMA = /^sandbox_api02_homolog_[a-z0-9_]{1,30}$/;
/** Patrón GENERAL de los puertos (los mismos guardas `sandbox_api02_*` de siempre). La exigencia más estricta `homolog` se aplica en la COMPUERTA DE PROCESO (`homologationGate`), no aquí: así esta función puede
 *  probarse contra el laboratorio sin relajar nada del entorno real. */
const PORT_NAME = /^sandbox_api02_[a-z0-9_]{1,60}$/;
/** Construye los PUERTOS del runtime y el consumidor. No instala nada ni abre conexiones por sí mismo (los pools los aporta quien llama). */
export function createHomologationRuntime(deps: HomologationDeps): HomologationRuntime {
  if (!PORT_NAME.test(deps.schema) || !PORT_NAME.test(deps.runtimeUser) || !PORT_NAME.test(deps.workerUser) || deps.workerUser === deps.runtimeUser) throw new Error('INVALID_HOMOLOGATION_NAMES');
  const { pool, schema, runtimeUser } = deps;
  const security = mariaDbSecurityPorts(pool, { schema, runtimeUser });
  const repository = mariaDbOrderRepository(pool, { schema, runtimeUser, cipher: deps.cipher, contract: deps.contract });
  const linker = createTmsLinker({ pool, schema, repository });
  const retry = createLinkRetry({ pool, schema, linker });
  const handler = createLinkOutboxHandler({ pool, schema, retry, linker });
  const store = mariaDbOutboxStore(deps.workerPool, { schema, workerUser: deps.workerUser });
  const consumer = createOutboxConsumer(new OutboxDispatcher(store, handler, deps.outbox?.policy ?? DEFAULT_OUTBOX_POLICY, deps.outbox?.log), deps.killSwitch);
  const ports: RuntimePorts = {
    evidence: deps.evidence,
    security: { verifier: guardEvidenceVerifier(deps.verifier, { environment: 'sandbox' }), catalog: security.catalog, revocation: security.revocation, clock: security.clock, counter: security.counter, replay: security.replay },
    repository,
    extensions: {
      order: deps.contract,
      readExtra: ({ scope, externalOrderId, view }) => linker.status(scope, externalOrderId, view),
      afterCommit: async () => { consumer.kick(); },   // el procesamiento es SIEMPRE por la outbox; esto solo reduce la latencia
    },
    probes: {
      database: async () => { const [rows] = await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT environment, sandbox_id FROM novalvion_environment WHERE id = 1'); return rows.length === 1 && rows[0].environment === 'sandbox'; },
      // El runtime NO se activa con un aprovisionamiento incompleto: ambos pasos deben figurar COMPLETE (y ninguno FAILED/STARTED). Un esquema parcial o sin marcador bloquea la instalación.
      provisioning: async () => { const [rows] = await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT step, state FROM ps_homolog_provisioning'); const m = Object.fromEntries(rows.map((r) => [String(r.step), String(r.state)])); return m.bootstrap === 'COMPLETE' && m.finalize === 'COMPLETE' && rows.length >= 2 && rows.every((r) => String(r.state) === 'COMPLETE'); },   // el aprovisionamiento real añade pasos `account:*`: TODOS deben figurar COMPLETE (ninguno FAILED/STARTED)
      outbox: async () => { const [rows] = await deps.workerPool.execute<import('mysql2/promise').RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${schema}\`.ps_api01_outbox WHERE status = 'REVIEW'`); return rows.length === 1; },
    },
    killSwitch: deps.killSwitch,
  };
  return { ports, consumer };
}

/** Condiciones de PROCESO del sandbox de homologación (puro): sandbox declarado, identificador `homolog-*`, base y cuenta `sandbox_api02_homolog_*`, y NINGUNA variable del laboratorio. */
export function homologationGate(env: Record<string, string | undefined>): { ok: true } | { ok: false; reason: string } {
  if (env.NOVALVION_ENV !== 'sandbox') return { ok: false, reason: 'NOT_SANDBOX' };
  if (!/^homolog-[a-z0-9]{1,16}$/.test(env.SANDBOX_ID ?? '')) return { ok: false, reason: 'SANDBOX_ID_NOT_HOMOLOG' };
  if (env.DB_HOST !== '127.0.0.1') return { ok: false, reason: 'DB_NOT_LOOPBACK' };
  if (!SCHEMA.test(env.DB_NAME ?? '') || !SCHEMA.test(env.DB_USER ?? '') || env.PRICESMART_DB_SCHEMA !== env.DB_NAME || env.PRICESMART_DB_RUNTIME_USER !== env.DB_USER) return { ok: false, reason: 'DB_NAMES_MISMATCH' };
  if (env.PRICESMART_RUNTIME_ENVIRONMENT !== 'sandbox') return { ok: false, reason: 'RUNTIME_ENVIRONMENT_NOT_SANDBOX' };
  if (Object.keys(env).some((k) => k.startsWith('PRICESMART_LAB_') && env[k] !== undefined && env[k] !== '')) return { ok: false, reason: 'LAB_VARIABLES_PRESENT' };
  return { ok: true };
}

/** Único camino de instalación: valida el proceso y delega en `installControlledRuntime` (modo, decisiones ratificadas, ACK, sondas, interruptor). Si algo falla, no instala nada. */
export async function installHomologationRuntime(env: Record<string, string | undefined>, deps: HomologationDeps, options: { consumerEveryMs?: number } = {}): Promise<Readiness & { consumerStarted: boolean; stopConsumer?: () => void }> {
  const gate = homologationGate(env);
  if (!gate.ok) return { ready: false, mode: 'DISABLED', blockers: [{ code: 'HOMOLOGATION_GATE', detail: gate.reason }], consumerStarted: false };
  let runtime: HomologationRuntime;
  try { runtime = createHomologationRuntime(deps); } catch { return { ready: false, mode: 'DISABLED', blockers: [{ code: 'COMPOSITION_FAILED', detail: 'la composición no pudo construirse' }], consumerStarted: false }; }
  const report = await installControlledRuntime(env, runtime.ports);
  // El consumidor corre SOLO si el runtime quedó instalado (ready) y no está en solo lectura: nada se procesa hacia el TMS con el servicio apagado o sin decisiones ratificadas.
  const run = report.ready && report.mode === 'ENABLED';
  if (run) runtime.consumer.start(options.consumerEveryMs ?? 2000);
  return { ...report, consumerStarted: run, stopConsumer: () => runtime.consumer.stop() };
}
