import { describe, expect, it } from "vitest";
import {
  debeReportarPorThrottle,
  esEventoDeActividadHumana,
  resolverConfiguracionGuard,
} from "./session-inactivity-guard";

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — solo se prueba la lógica PURA
 * y exportada del guard (sin DOM, sin React, sin fetch/localStorage
 * reales): el proyecto no tiene infraestructura de testing de
 * componentes React (vitest.config.ts usa `environment: "node"` y solo
 * incluye `src/**\/*.test.ts`, nunca `.test.tsx` — no hay jsdom ni
 * @testing-library/react instalados). Añadir esa infraestructura sería
 * una ampliación de alcance/tooling fuera de "núcleo de sesiones" — se
 * reporta como incompatibilidad encontrada en vez de expandirla sin
 * autorización. El resto del componente (listeners, fetch, localStorage,
 * BroadcastChannel/coordinación entre pestañas, redirección) queda sin
 * cobertura automatizada; requiere revisión manual/QA manual.
 */

describe("resolverConfiguracionGuard — qué sesión corresponde a cada ruta", () => {
  it("rutas de staff (todo lo que no sea /portal, /cliente-portal, /login, /site) -> config de staff", () => {
    for (const p of ["/", "/select-empresa", "/e/sitsa/dashboard", "/admin/algo"]) {
      expect(resolverConfiguracionGuard(p)?.activityEndpoint).toBe("/api/auth/activity");
    }
  });

  it("/login y /login/* -> null (pública, sin guard, evita loop)", () => {
    expect(resolverConfiguracionGuard("/login")).toBeNull();
    expect(resolverConfiguracionGuard("/login/recuperar")).toBeNull();
  });

  it("/site y /site/* -> null (pública)", () => {
    expect(resolverConfiguracionGuard("/site")).toBeNull();
    expect(resolverConfiguracionGuard("/site/nosotros")).toBeNull();
  });

  it("rutas /portal/* -> config de colaborador", () => {
    expect(resolverConfiguracionGuard("/portal")?.activityEndpoint).toBe("/api/portal/auth/activity");
    expect(resolverConfiguracionGuard("/portal/marcajes")?.loginPath).toBe("/portal/login");
  });

  it("/portal/login y /portal/login/* -> null (pública del colaborador, evita loop)", () => {
    expect(resolverConfiguracionGuard("/portal/login")).toBeNull();
    expect(resolverConfiguracionGuard("/portal/login/recuperar")).toBeNull();
  });

  it("rutas /cliente-portal/* -> config de cliente", () => {
    expect(resolverConfiguracionGuard("/cliente-portal")?.activityEndpoint).toBe("/api/cliente-portal/auth/activity");
    expect(resolverConfiguracionGuard("/cliente-portal/viajes")?.loginPath).toBe("/cliente-portal/login");
  });

  it("/cliente-portal/login y /cliente-portal/login/* -> null (pública del cliente, evita loop)", () => {
    expect(resolverConfiguracionGuard("/cliente-portal/login")).toBeNull();
    expect(resolverConfiguracionGuard("/cliente-portal/login/recuperar")).toBeNull();
  });

  it("las 3 configuraciones tienen storageKey distinta — el throttle de una sesión nunca se cruza con otra", () => {
    const claves = new Set([
      resolverConfiguracionGuard("/e/sitsa/dashboard")!.storageKey,
      resolverConfiguracionGuard("/portal")!.storageKey,
      resolverConfiguracionGuard("/cliente-portal")!.storageKey,
    ]);
    expect(claves.size).toBe(3);
  });
});

describe("esEventoDeActividadHumana — solo pointerdown/keydown/touchstart CONFIABLES cuentan", () => {
  it.each(["pointerdown", "keydown", "touchstart"])("%s con isTrusted=true -> cuenta como actividad", (type) => {
    expect(esEventoDeActividadHumana({ type, isTrusted: true })).toBe(true);
  });

  it.each(["pointerdown", "keydown", "touchstart"])("%s con isTrusted=false (sintético) -> NUNCA cuenta", (type) => {
    expect(esEventoDeActividadHumana({ type, isTrusted: false })).toBe(false);
  });

  it.each(["focus", "visibilitychange", "mousemove", "scroll", "click", "resize"])(
    "%s NUNCA cuenta como actividad, aunque sea isTrusted=true",
    (type) => {
      expect(esEventoDeActividadHumana({ type, isTrusted: true })).toBe(false);
    },
  );
});

describe("debeReportarPorThrottle — coordinación/throttle entre pestañas", () => {
  it("sin reporte previo -> siempre reporta (primera actividad)", () => {
    expect(debeReportarPorThrottle(null, 1_000_000)).toBe(true);
  });

  it("dentro del intervalo -> NO reporta (evita tormenta de requests)", () => {
    expect(debeReportarPorThrottle(1_000_000, 1_000_000 + 59_000, 60_000)).toBe(false);
  });

  it("justo al cumplirse el intervalo -> SÍ reporta", () => {
    expect(debeReportarPorThrottle(1_000_000, 1_000_000 + 60_000, 60_000)).toBe(true);
  });

  it("más allá del intervalo -> SÍ reporta", () => {
    expect(debeReportarPorThrottle(1_000_000, 1_000_000 + 61_000, 60_000)).toBe(true);
  });
});
