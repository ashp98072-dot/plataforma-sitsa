import type { Pool } from 'mysql2/promise';
import { fileKillSwitch, homologationGate, installHomologationRuntime, type HomologationDeps } from './runtime';
import { resolveHomologationProviders, type ProviderResolution } from './providers';
import { installPriceSmartHandler } from '../runtime-state';

// PRICESMART — ARRANQUE REAL del runtime de homologación en el proceso de Next.js (lo invoca `src/instrumentation.ts`). Es el ÚNICO punto que llama a `installHomologationRuntime` fuera de las pruebas.
// Principios:
//  · POR DEFECTO NO HACE NADA: sin `PRICESMART_RUNTIME_MODE` (o `DISABLED`) no abre conexiones, no resuelve proveedores y las rutas responden 503 DISABLED.
//  · FALLA CERRADO: cualquier condición que falte (compuerta del proceso, cuenta del worker, interruptor, proveedores, decisiones ratificadas, ACK, sondas) deja el handler DESINSTALADO y devuelve un informe con códigos, sin valores ni mensajes de terceros.
//  · NO AUTORIZA nada por sí mismo: ENABLED sigue exigiendo las decisiones ratificadas por PriceSmart, la frase de confirmación del operador (aprobación humana), proveedores revisados (verificador D02, KMS, contrato D06) y el interruptor en `ON`.
//  · No lee `process.env` (lo recibe como parámetro) y no importa nada del laboratorio: los proveedores sintéticos de prueba entran solo por `providers.ts`, con su propia compuerta.
export type BootState = 'DISABLED' | 'CLOSED' | 'INSTALLED';
export type BootReport = { state: BootState; mode: string; blockers: { code: string; detail: string }[]; consumerStarted: boolean; providers: 'NONE' | ProviderResolutionSource };
type ProviderResolutionSource = Extract<ProviderResolution, { ok: true }>['source'];

export type ShutdownOutcome = { drained: boolean; waitedMs: number; poolClosed: boolean };
export type BootPools = { pool: Pool; workerPool: Pool; close(): Promise<void> };
export type BootIO = {
  createPools(env: Record<string, string | undefined>): Promise<BootPools>;
  resolveProviders(env: Record<string, string | undefined>): Promise<ProviderResolution>;
  install: typeof installHomologationRuntime;
  onShutdown(stop: () => Promise<ShutdownOutcome>): void;
};

const STORE = Symbol.for('novalvion.pricesmart.homologation.boot');
const memo = globalThis as unknown as Record<symbol, Promise<BootReport> | undefined>;
const closedReport = (mode: string, code: string, detail: string, providers: BootReport['providers'] = 'NONE'): BootReport => ({ state: 'CLOSED', mode, blockers: [{ code, detail }], consumerStarted: false, providers });
const ABS_PATH = /^\/[A-Za-z0-9._\/-]{3,200}$|^[A-Za-z]:[\\/][A-Za-z0-9._\\/ -]{3,200}$/;

/** Implementación real de los efectos (conexiones, cierre). Se importa de forma diferida para no tocar mysql2 si el runtime está apagado. */
export async function defaultBootIO(): Promise<BootIO> {
  return {
    async createPools(env) {
      const mysql = (await import('mysql2/promise')).default; const { getPool } = await import('@/lib/db'); const { sandboxPool } = await import('@/lib/sandbox-db');
      const raw = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.PS_HOMOLOG_WORKER_USER, password: env.PS_HOMOLOG_WORKER_PASSWORD, database: env.DB_NAME, connectionLimit: 5, waitForConnections: true });
      return { pool: getPool(), workerPool: sandboxPool(raw), close: async () => { await raw.end().catch(() => undefined); } };
    },
    resolveProviders: (env) => resolveHomologationProviders(env),
    install: installHomologationRuntime,
    onShutdown(stop) {
      // Un solo apagado por proceso (SIGTERM y SIGINT comparten la misma promesa). Next.js conserva su propio manejo de la señal: este solo ordena lo del runtime.
      for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { void stop().then((o) => console.log(`[pricesmart] apagado ordenado: ${o.drained ? 'consumidor drenado' : 'espera agotada (los trabajos pendientes se recuperan al reiniciar)'} (${o.waitedMs} ms)`)).catch(() => undefined); });
    },
  };
}

export function bootHomologationRuntime(env: Record<string, string | undefined>, io?: BootIO): Promise<BootReport> {
  // Una sola vez por proceso (recarga en caliente / varias evaluaciones del módulo): nunca dos consumidores.
  return (memo[STORE] ??= run(env, io).catch((): BootReport => closedReport(env.PRICESMART_RUNTIME_MODE ?? 'DISABLED', 'BOOT_FAILED', 'el arranque falló; el runtime permanece cerrado')));
}
/** Olvida el arranque previo del proceso (uso: pruebas). */
export function clearHomologationBootMemo(): void { memo[STORE] = undefined; }

async function run(env: Record<string, string | undefined>, ioIn?: BootIO): Promise<BootReport> {
  const mode = env.PRICESMART_RUNTIME_MODE ?? '';
  if (mode === '' || mode === 'DISABLED') return { state: 'DISABLED', mode: 'DISABLED', blockers: [{ code: 'MODE_DISABLED', detail: 'PRICESMART_RUNTIME_MODE ausente o DISABLED (estado seguro por defecto)' }], consumerStarted: false, providers: 'NONE' };
  installPriceSmartHandler(null);   // falla cerrado: nada previo sigue activo mientras se evalúa
  const gate = homologationGate(env);
  if (!gate.ok) return closedReport(mode, 'HOMOLOGATION_GATE', gate.reason);
  if (!env.PS_HOMOLOG_WORKER_USER || !env.PS_HOMOLOG_WORKER_PASSWORD) return closedReport(mode, 'WORKER_ACCOUNT_MISSING', 'faltan las credenciales de la cuenta del worker de la outbox');
  if (!env.PS_HOMOLOG_KILLSWITCH_FILE || !ABS_PATH.test(env.PS_HOMOLOG_KILLSWITCH_FILE)) return closedReport(mode, 'KILLSWITCH_MISSING', 'falta una ruta absoluta válida para el interruptor de emergencia');
  const io = ioIn ?? await defaultBootIO();
  const resolved = await io.resolveProviders(env);
  if (!resolved.ok) return closedReport(mode, resolved.code, resolved.detail);
  let pools: BootPools | null = null;
  try {
    pools = await io.createPools(env);
    const deps: HomologationDeps = { pool: pools.pool, workerPool: pools.workerPool, schema: env.DB_NAME as string, runtimeUser: env.DB_USER as string, workerUser: env.PS_HOMOLOG_WORKER_USER, ...resolved.providers, killSwitch: fileKillSwitch(env.PS_HOMOLOG_KILLSWITCH_FILE) };
    const everyMs = Number(env.PS_HOMOLOG_CONSUMER_EVERY_MS ?? 2000);
    const report = await io.install(env, deps, { consumerEveryMs: Number.isSafeInteger(everyMs) && everyMs >= 500 ? everyMs : 2000 });
    if (!report.ready) { await pools.close(); pools = null; installPriceSmartHandler(null); return { state: 'CLOSED', mode: report.mode, blockers: report.blockers, consumerStarted: false, providers: resolved.source }; }
    // Apagado seguro del proceso: detiene el temporizador, espera el ciclo en curso y cierra el pool del worker. Lo recibido ya está confirmado en la base; el resto se retoma al reiniciar.
    // Apagado ORDENADO: (1) deja de atender solicitudes nuevas (handler fuera); (2) el consumidor no inicia ejecuciones nuevas y se ESPERA la activa, con límite; (3) solo entonces se cierra el pool del worker.
    // Si se agota la espera, el pool se cierra igual y el trabajo en curso se recupera al reiniciar (lease con vencimiento, reclamo con token, entrega al-menos-una-vez): no hay solicitudes TMS duplicadas ni órdenes perdidas.
    const held = pools; const waitMs = Number(env.PS_HOMOLOG_SHUTDOWN_TIMEOUT_MS ?? 10_000); let stopping: Promise<ShutdownOutcome> | null = null;
    io.onShutdown(() => (stopping ??= (async (): Promise<ShutdownOutcome> => {
      installPriceSmartHandler(null);
      let drain = { drained: true, waitedMs: 0 };
      try { if (report.shutdownConsumer) drain = await report.shutdownConsumer(Number.isSafeInteger(waitMs) && waitMs >= 0 && waitMs <= 60_000 ? waitMs : 10_000); else report.stopConsumer?.(); } catch { drain = { drained: false, waitedMs: 0 }; }
      let poolClosed = true; try { await held.close(); } catch { poolClosed = false; }
      return { ...drain, poolClosed };
    })()));
    return { state: 'INSTALLED', mode: report.mode, blockers: [], consumerStarted: report.consumerStarted, providers: resolved.source };
  } catch {
    installPriceSmartHandler(null); if (pools) await pools.close().catch(() => undefined);
    return closedReport(mode, 'BOOT_FAILED', 'la composición no pudo construirse; el runtime permanece cerrado', resolved.source);
  }
}
