import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness de hooks sin DOM: ejecuta los callbacks/effects reales, no un poll duplicado.
const hooks = vi.hoisted(() => ({
  callbacks: [] as ((silent?: boolean) => Promise<void>)[],
  effects: [] as (() => (() => void) | void)[],
  writes: [] as unknown[],
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, (next: unknown) => hooks.writes.push(next)],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (fn: (silent?: boolean) => Promise<void>) => { hooks.callbacks.push(fn); return fn; },
  useEffect: (fn: () => (() => void) | void) => { hooks.effects.push(fn); },
}));
import { NotificacionesBell } from "./notificaciones-bell";

beforeEach(() => {
  hooks.callbacks.length = hooks.effects.length = hooks.writes.length = 0;
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount() {
  NotificacionesBell({ slug: "a", rol: "Admin" });
  return hooks.callbacks[0];
}
function delayed() {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, finish: () => finish(Response.json({ notificaciones: [], pendientes: 0 })) };
}

describe("campana sin requests solapadas", () => {
  it("poll + abrir + actualizar en curso producen 1 request; terminado permite otro", async () => {
    const request = delayed();
    const load = mount();
    const running = load(true);
    await load();
    await load(true);
    expect(request.fetcher).toHaveBeenCalledOnce();
    request.finish();
    await running;
    const next = load(true);
    expect(request.fetcher).toHaveBeenCalledTimes(2);
    request.finish();
    await next;
  });
  it("fallo de red no deja la guarda tomada ni rechaza el poll sin manejar", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("red")).mockResolvedValueOnce(Response.json({ notificaciones: [], pendientes: 0 }));
    vi.stubGlobal("fetch", fetcher);
    const load = mount();
    await load(true);
    await load(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cleanup aborta y evita aplicar respuesta del tenant anterior", async () => {
    const request = delayed();
    const load = mount();
    const cleanup = hooks.effects[0]();
    const running = load(true);
    const options = request.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    cleanup?.();
    expect(options[1].signal?.aborted).toBe(true);
    request.finish();
    await running;
    expect(hooks.writes).toEqual([]);
  });
  it("Actualizar abortado por cambio de empresa libera el indicador de carga (no queda colgado)", async () => {
    const request = delayed();
    const load = mount();
    const cleanup = hooks.effects[0]();
    const running = load(); // no silencioso: pone loading=true
    expect(hooks.writes).toEqual([true]);
    cleanup?.(); // cambio de slug / desmontaje
    request.finish();
    await running;
    expect(hooks.writes).toEqual([true, false]);
  });
  it("conserva 150 segundos y el timer no solapa un request lento", async () => {
    const request = delayed();
    mount();
    const cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(2500);
    expect(request.fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300000);
    expect(request.fetcher).toHaveBeenCalledOnce();
    request.finish();
    await vi.advanceTimersByTimeAsync(150000);
    expect(request.fetcher).toHaveBeenCalledTimes(2);
    cleanup?.();
    request.finish();
  });
});
