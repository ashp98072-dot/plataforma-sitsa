import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxRunSummary } from '../outbox';
import { createOutboxConsumer } from './runtime';

// PRICESMART API-26 — el consumidor de la outbox: un solo ciclo a la vez, `kick` sin bloquear la solicitud, y recuperación ante fallos del despachador sin rechazos no manejados ni timers duplicados.
const summary = (n = 1): OutboxRunSummary => ({ claimed: n, done: n, retried: 0, review: 0, lostLease: 0, unrecorded: 0 });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const unhandled: unknown[] = []; const onUnhandled = (e: unknown) => { unhandled.push(e); };
beforeEach(() => { unhandled.length = 0; process.on('unhandledRejection', onUnhandled); });
afterEach(() => { process.off('unhandledRejection', onUnhandled); vi.useRealTimers(); });

describe('API-26 consumidor de la outbox', () => {
  it('un solo ciclo en vuelo: 6 llamadas simultáneas comparten UNA ejecución del despachador y reciben el mismo resultado', async () => {
    const d = deferred<OutboxRunSummary>(); const runOnce = vi.fn(() => d.promise); const c = createOutboxConsumer({ runOnce });
    const calls = Array.from({ length: 6 }, () => c.runOnce()); expect(runOnce).toHaveBeenCalledTimes(1); d.resolve(summary(3));
    expect((await Promise.all(calls)).every((r) => r.claimed === 3)).toBe(true); expect(runOnce).toHaveBeenCalledTimes(1);
    await c.runOnce(); expect(runOnce).toHaveBeenCalledTimes(2);   // terminado el ciclo, el siguiente sí se ejecuta
  });
  it('kick: sin ciclo en curso lanza uno; con ciclo en curso encadena EXACTAMENTE uno más (aunque haya muchos kicks) y nunca bloquea al llamador', async () => {
    const gates = [deferred<OutboxRunSummary>(), deferred<OutboxRunSummary>(), deferred<OutboxRunSummary>()]; let n = 0;
    const runOnce = vi.fn(() => gates[n++].promise); const c = createOutboxConsumer({ runOnce });
    const t = performance.now(); c.kick(); expect(performance.now() - t).toBeLessThan(50); expect(runOnce).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) c.kick(); expect(runOnce).toHaveBeenCalledTimes(1);   // en curso: no se lanzan más
    gates[0].resolve(summary()); await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(2));   // el seguimiento encadenado
    gates[1].resolve(summary()); await new Promise((r) => setTimeout(r, 20)); expect(runOnce).toHaveBeenCalledTimes(2);   // y nada más
  });
  it('recuperación: si el despachador falla (almacén no disponible) la llamada rechaza, el consumidor queda libre y el siguiente ciclo funciona; kick/start jamás producen rechazos no manejados', async () => {
    const runOnce = vi.fn<() => Promise<OutboxRunSummary>>().mockRejectedValueOnce(new Error('almacén caído')).mockRejectedValueOnce(new Error('sigue caído')).mockResolvedValue(summary(2));
    const c = createOutboxConsumer({ runOnce });
    await expect(c.runOnce()).rejects.toThrow('almacén caído'); c.kick(); await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(2));   // kick con fallo: se traga
    expect(await c.runOnce()).toMatchObject({ claimed: 2 }); await new Promise((r) => setTimeout(r, 30)); expect(unhandled).toEqual([]);
  });
  it('start: un solo temporizador aunque se llame varias veces, intervalo mínimo 500 ms, los fallos no lo detienen y stop lo detiene (y se puede reiniciar)', async () => {
    vi.useFakeTimers(); const runOnce = vi.fn<() => Promise<OutboxRunSummary>>().mockRejectedValueOnce(new Error('fallo transitorio')).mockResolvedValue(summary());
    const c = createOutboxConsumer({ runOnce });
    for (const bad of [0, 100, 499, 1.5, Number.NaN, -1, 2 ** 40 + 0.5]) c.start(bad); await vi.advanceTimersByTimeAsync(5000); expect(runOnce).not.toHaveBeenCalled();   // intervalos inválidos: no arranca
    c.start(1000); c.start(1000); c.start(2000); await vi.advanceTimersByTimeAsync(3000); expect(runOnce).toHaveBeenCalledTimes(3);   // 1 temporizador: el primer ciclo falla y los siguientes siguen
    c.stop(); await vi.advanceTimersByTimeAsync(5000); expect(runOnce).toHaveBeenCalledTimes(3); c.stop();   // stop idempotente
    c.start(1000); await vi.advanceTimersByTimeAsync(1000); expect(runOnce).toHaveBeenCalledTimes(4); c.stop(); expect(unhandled).toEqual([]);
  });
  it('un ciclo lento no se solapa con el siguiente tick del temporizador', async () => {
    vi.useFakeTimers(); const d = deferred<OutboxRunSummary>(); const runOnce = vi.fn(() => d.promise); const c = createOutboxConsumer({ runOnce });
    c.start(500); await vi.advanceTimersByTimeAsync(5000); expect(runOnce).toHaveBeenCalledTimes(1); d.resolve(summary()); await vi.advanceTimersByTimeAsync(500); expect(runOnce).toHaveBeenCalledTimes(2); c.stop();
  });
});

describe('API-26 apagado ordenado del consumidor (shutdown)', () => {
  it('sin ciclo activo: termina al instante, detiene el temporizador y NINGÚN disparo posterior (kick, temporizador, runOnce) ejecuta el despachador', async () => {
    vi.useFakeTimers(); const runOnce = vi.fn(async () => summary()); const c = createOutboxConsumer({ runOnce }); c.start(1000);
    expect(await c.shutdown(1000)).toEqual({ drained: true, waitedMs: 0 });
    c.kick(); c.start(1000); await vi.advanceTimersByTimeAsync(5000); expect(runOnce).not.toHaveBeenCalled();
    await expect(c.runOnce()).rejects.toThrow('CONSUMER_CLOSED'); expect(runOnce).not.toHaveBeenCalled(); expect(await c.shutdown()).toEqual({ drained: true, waitedMs: 0 });   // idempotente
  });
  it('con un ciclo activo: espera su terminación; el `kick` pendiente NO encadena otro ciclo; los `kick` posteriores se ignoran', async () => {
    const d = deferred<OutboxRunSummary>(); const runOnce = vi.fn(() => d.promise); const c = createOutboxConsumer({ runOnce });
    c.kick(); expect(runOnce).toHaveBeenCalledTimes(1); c.kick(); c.kick();   // quedan «kicked» para encadenar
    let done = false; const sd = c.shutdown(5000).then((r) => { done = true; return r; }); await new Promise((r) => setTimeout(r, 30)); expect(done).toBe(false);   // sigue esperando
    c.kick(); d.resolve(summary(4)); const r = await sd; expect(r.drained).toBe(true); await new Promise((x) => setTimeout(x, 30)); expect(runOnce).toHaveBeenCalledTimes(1);   // ningún ciclo encadenado ni nuevo
    expect(unhandled).toEqual([]);
  });
  it('callbacks ya programados: un `kick` que está leyendo el interruptor (off) cuando se apaga NO inicia el ciclo al terminar de leerlo', async () => {
    const gate = deferred<boolean>(); const runOnce = vi.fn(async () => summary()); const c = createOutboxConsumer({ runOnce }, () => gate.promise);
    c.kick();   // queda esperando el interruptor
    const sd = c.shutdown(1000); gate.resolve(false); await sd; await new Promise((r) => setTimeout(r, 30)); expect(runOnce).not.toHaveBeenCalled(); expect(unhandled).toEqual([]);
  });
  it('límite de espera: si el ciclo no termina, drained=false al agotarse, sin colgarse; el ciclo que termina después no provoca rechazos no manejados ni ciclos nuevos', async () => {
    vi.useFakeTimers(); const d = deferred<OutboxRunSummary>(); const runOnce = vi.fn(() => d.promise); const c = createOutboxConsumer({ runOnce }); void c.runOnce().catch(() => undefined);
    const sd = c.shutdown(3000); await vi.advanceTimersByTimeAsync(2999); let settled = false; void sd.then(() => { settled = true; }); await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2); expect(await sd).toEqual({ drained: false, waitedMs: 3000 }); d.reject(new Error('tarde')); await vi.advanceTimersByTimeAsync(100); expect(runOnce).toHaveBeenCalledTimes(1); expect(unhandled).toEqual([]);
  });
  it('un ciclo activo que FALLA también cuenta como terminado; los valores de espera inválidos usan el valor seguro por omisión', async () => {
    const c = createOutboxConsumer({ runOnce: async () => { throw new Error('almacén caído'); } }); void c.runOnce().catch(() => undefined); expect((await c.shutdown(1000)).drained).toBe(true);
    vi.useFakeTimers(); const d = deferred<OutboxRunSummary>(); const c2 = createOutboxConsumer({ runOnce: () => d.promise }); void c2.runOnce().catch(() => undefined);
    const sd = c2.shutdown(-5); await vi.advanceTimersByTimeAsync(9999); let settled = false; void sd.then(() => { settled = true; }); await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false); await vi.advanceTimersByTimeAsync(5); expect((await sd).drained).toBe(false);   // -5 → 10000 ms
    d.resolve(summary());
  });
});

