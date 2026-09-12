"use client";

import { useEffect, useRef } from "react";

export const AUTO_REFRESH_INTERVAL_MS = 30_000;

export type AutoRefreshOptions = {
  refresh: () => void | Promise<void>;
  paused?: boolean;
  intervalMs?: number;
  refreshOnFocus?: boolean;
};

type AutoRefreshEnvironment = {
  isVisible: () => boolean;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
  addVisibilityListener: (callback: () => void) => void;
  removeVisibilityListener: (callback: () => void) => void;
  addFocusListener: (callback: () => void) => void;
  removeFocusListener: (callback: () => void) => void;
};

type AutoRefreshControllerOptions = AutoRefreshOptions & {
  environment: AutoRefreshEnvironment;
};

/**
 * Núcleo testeable del hook. Solo invoca el callback entregado: no genera
 * eventos humanos ni llama endpoints de actividad de sesión.
 */
export function createAutoRefreshController({
  refresh,
  paused = false,
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  refreshOnFocus = true,
  environment,
}: AutoRefreshControllerOptions): () => void {
  if (paused) return () => undefined;

  let disposed = false;
  let inFlight = false;
  let intervalId: number | undefined;
  let foregroundTimeoutId: number | undefined;

  async function execute() {
    if (disposed || inFlight || !environment.isVisible()) return;
    inFlight = true;
    try {
      await refresh();
    } catch {
      // El refresco es silencioso: la pantalla conserva su último estado válido.
    } finally {
      inFlight = false;
    }
  }

  function restartInterval() {
    if (intervalId !== undefined) environment.clearInterval(intervalId);
    intervalId = environment.setInterval(() => void execute(), intervalMs);
  }

  function scheduleForegroundRefresh() {
    if (disposed || !environment.isVisible()) return;
    restartInterval();
    if (foregroundTimeoutId !== undefined) return;
    // visibilitychange y focus suelen llegar juntos. Agruparlos evita dos
    // recargas consecutivas sin retrasar perceptiblemente la actualización.
    foregroundTimeoutId = environment.setTimeout(() => {
      foregroundTimeoutId = undefined;
      void execute();
    }, 0);
  }

  function onVisibilityChange() {
    if (environment.isVisible()) scheduleForegroundRefresh();
  }

  restartInterval();
  environment.addVisibilityListener(onVisibilityChange);
  if (refreshOnFocus) environment.addFocusListener(scheduleForegroundRefresh);

  return () => {
    disposed = true;
    if (intervalId !== undefined) environment.clearInterval(intervalId);
    if (foregroundTimeoutId !== undefined) environment.clearTimeout(foregroundTimeoutId);
    environment.removeVisibilityListener(onVisibilityChange);
    if (refreshOnFocus) environment.removeFocusListener(scheduleForegroundRefresh);
  };
}

function browserEnvironment(): AutoRefreshEnvironment {
  return {
    isVisible: () => document.visibilityState === "visible",
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (id) => window.clearTimeout(id),
    addVisibilityListener: (callback) => document.addEventListener("visibilitychange", callback),
    removeVisibilityListener: (callback) => document.removeEventListener("visibilitychange", callback),
    addFocusListener: (callback) => window.addEventListener("focus", callback),
    removeFocusListener: (callback) => window.removeEventListener("focus", callback),
  };
}

export function useAutoRefresh({
  refresh,
  paused = false,
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  refreshOnFocus = true,
}: AutoRefreshOptions): void {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    return createAutoRefreshController({
      refresh: () => refreshRef.current(),
      paused,
      intervalMs,
      refreshOnFocus,
      environment: browserEnvironment(),
    });
  }, [paused, intervalMs, refreshOnFocus]);
}
