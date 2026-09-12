import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_REFRESH_INTERVAL_MS,
  createAutoRefreshController,
  type AutoRefreshOptions,
} from "./use-auto-refresh";

type Listener = () => void;

function createEnvironment() {
  let visible = true;
  const visibilityListeners = new Set<Listener>();
  const focusListeners = new Set<Listener>();

  return {
    environment: {
      isVisible: () => visible,
      setInterval: (callback: Listener, delay: number) => Number(setInterval(callback, delay)),
      clearInterval: (id: number) => clearInterval(id),
      setTimeout: (callback: Listener, delay: number) => Number(setTimeout(callback, delay)),
      clearTimeout: (id: number) => clearTimeout(id),
      addVisibilityListener: (callback: Listener) => visibilityListeners.add(callback),
      removeVisibilityListener: (callback: Listener) => visibilityListeners.delete(callback),
      addFocusListener: (callback: Listener) => focusListeners.add(callback),
      removeFocusListener: (callback: Listener) => focusListeners.delete(callback),
    },
    setVisible(value: boolean) {
      visible = value;
      visibilityListeners.forEach((listener) => listener());
    },
    focus() {
      focusListeners.forEach((listener) => listener());
    },
    listenerCounts() {
      return { visibility: visibilityListeners.size, focus: focusListeners.size };
    },
  };
}

function start(options: Partial<AutoRefreshOptions> = {}) {
  const testEnvironment = createEnvironment();
  const refresh = options.refresh ?? vi.fn();
  const dispose = createAutoRefreshController({
    refresh,
    paused: options.paused,
    intervalMs: options.intervalMs,
    refreshOnFocus: options.refreshOnFocus,
    environment: testEnvironment.environment,
  });
  return { ...testEnvironment, refresh, dispose };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutoRefresh controller", () => {
  it("usa 30 segundos como intervalo predeterminado", async () => {
    const { refresh, dispose } = start();
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledOnce();
    dispose();
  });

  it("no refresca mientras la pestaña está oculta", async () => {
    const state = start();
    state.setVisible(false);
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS * 2);
    expect(state.refresh).not.toHaveBeenCalled();
    state.dispose();
  });

  it("refresca al volver visible y reinicia el intervalo", async () => {
    const state = start();
    await vi.advanceTimersByTimeAsync(20_000);
    state.setVisible(false);
    state.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS - 1);
    expect(state.refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.refresh).toHaveBeenCalledTimes(2);
    state.dispose();
  });

  it("deduplica visibilitychange y focus consecutivos", async () => {
    const state = start();
    state.setVisible(false);
    state.setVisible(true);
    state.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.refresh).toHaveBeenCalledOnce();
    state.dispose();
  });

  it("evita ejecuciones concurrentes", async () => {
    let resolveRefresh!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
    const state = start({ refresh, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    state.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledOnce();
    resolveRefresh();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(2);
    state.dispose();
  });

  it("paused evita timers, listeners y recargas", async () => {
    const state = start({ paused: true });
    expect(state.listenerCounts()).toEqual({ visibility: 0, focus: 0 });
    state.focus();
    state.setVisible(true);
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS);
    expect(state.refresh).not.toHaveBeenCalled();
    state.dispose();
  });

  it("cleanup elimina timers, refrescos pendientes y listeners", async () => {
    const state = start();
    state.focus();
    state.dispose();
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_INTERVAL_MS * 2);
    expect(state.refresh).not.toHaveBeenCalled();
    expect(state.listenerCounts()).toEqual({ visibility: 0, focus: 0 });
  });

  it("un error libera el candado y permite el siguiente refresco", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValue(undefined);
    const state = start({ refresh, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(2);
    state.dispose();
  });
});
