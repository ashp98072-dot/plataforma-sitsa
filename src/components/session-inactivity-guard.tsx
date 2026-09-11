"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — núcleo de sesiones.
 *
 * Guardia del lado del cliente: reporta actividad humana REAL al
 * endpoint de actividad correspondiente (staff/colaborador/cliente,
 * según la ruta actual — ver `resolverConfiguracionGuard`), y valida la
 * vigencia de la sesión al recuperar una pestaña, SIN renovarla.
 *
 * Solo cuenta como actividad `pointerdown`/`keydown`/`touchstart`, y
 * únicamente si `event.isTrusted` — jamás `focus`, `visibilitychange`,
 * `mousemove`, `scroll`, polling, `fetch`, `router.refresh()`, timers, ni
 * el futuro autorefresco de datos (Fase 2+, todavía no implementado).
 * `event.isTrusted` es una señal que solo sirve para decidir, del lado
 * del CLIENTE, qué eventos reportar — el servidor (ver los 3 endpoints de
 * actividad) nunca confía en ningún tiempo que el cliente pretenda
 * imponer; la única prueba real de actividad es que la request llegó con
 * una cookie de sesión válida.
 *
 * Montado UNA sola vez en la raíz (`src/app/layout.tsx`), cubre las 3
 * sesiones independientes de la plataforma sin necesitar una instancia
 * por layout — se auto-configura según el prefijo de la ruta actual.
 */

const REPORT_THROTTLE_MS = 60_000; // Como máximo 1 reporte de actividad por minuto — ver debeReportarPorThrottle.
const HUMAN_EVENT_TYPES = new Set(["pointerdown", "keydown", "touchstart"]);

export type GuardConfig = {
  activityEndpoint: string;
  logoutEndpoint: string;
  loginPath: string;
  /** Clave de localStorage usada para coordinar el throttle ENTRE pestañas (nunca solo en memoria de una pestaña). */
  storageKey: string;
};

const STAFF_CONFIG: GuardConfig = {
  activityEndpoint: "/api/auth/activity",
  logoutEndpoint: "/api/auth/logout",
  loginPath: "/login",
  storageKey: "sitsa-session-last-report",
};

const COLABORADOR_CONFIG: GuardConfig = {
  activityEndpoint: "/api/portal/auth/activity",
  logoutEndpoint: "/api/portal/auth/logout",
  loginPath: "/portal/login",
  storageKey: "sitsa-colab-session-last-report",
};

const CLIENTE_CONFIG: GuardConfig = {
  activityEndpoint: "/api/cliente-portal/auth/activity",
  logoutEndpoint: "/api/cliente-portal/auth/logout",
  loginPath: "/cliente-portal/login",
  storageKey: "sitsa-cliente-session-last-report",
};

/**
 * Determina qué sesión (staff/colaborador/cliente) corresponde a la ruta
 * actual, o `null` si la ruta es pública (login de cualquiera de los 3
 * dominios, o `/site`) — en una ruta pública el guard NO debe hacer
 * nada: ni escuchar eventos, ni reportar actividad, ni validar vigencia.
 * Evita loops (nunca redirige desde una página de login hacia sí misma).
 */
export function resolverConfiguracionGuard(pathname: string): GuardConfig | null {
  if (pathname.startsWith("/portal")) {
    if (pathname === "/portal/login" || pathname.startsWith("/portal/login/")) return null;
    return COLABORADOR_CONFIG;
  }
  if (pathname.startsWith("/cliente-portal")) {
    if (pathname === "/cliente-portal/login" || pathname.startsWith("/cliente-portal/login/")) return null;
    return CLIENTE_CONFIG;
  }
  if (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/site" ||
    pathname.startsWith("/site/")
  ) {
    return null;
  }
  return STAFF_CONFIG;
}

/**
 * Solo cuenta como actividad humana REAL: `pointerdown`/`keydown`/
 * `touchstart`, y únicamente si `event.isTrusted` (nunca un evento
 * sintético disparado por script — polling, autorefresco futuro,
 * `dispatchEvent`, etc.).
 */
export function esEventoDeActividadHumana(event: { type: string; isTrusted: boolean }): boolean {
  return event.isTrusted && HUMAN_EVENT_TYPES.has(event.type);
}

/**
 * Throttle compartido entre pestañas: como máximo un reporte cada
 * `intervaloMs`. El llamador debe leer/escribir `ultimoReporteEn` en
 * localStorage (clave `GuardConfig.storageKey`), NUNCA en una variable en
 * memoria de la pestaña — así, si dos pestañas detectan actividad casi al
 * mismo tiempo, solo la primera en escribir el timestamp compartido
 * dispara la request; la otra ve el throttle ya activo y no dispara
 * nada, evitando una tormenta de requests y renovaciones de cookie
 * simultáneas.
 */
export function debeReportarPorThrottle(
  ultimoReporteEn: number | null,
  ahoraMs: number,
  intervaloMs: number = REPORT_THROTTLE_MS,
): boolean {
  if (ultimoReporteEn == null) return true;
  return ahoraMs - ultimoReporteEn >= intervaloMs;
}

export function SessionInactivityGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const config = resolverConfiguracionGuard(pathname ?? "/");
  const enVueloRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!config) return; // Ruta pública: ningún listener, ninguna request.

    let activo = true;

    async function cerrarSesionYRedirigir() {
      if (!activo) return;
      try {
        await fetch(config!.logoutEndpoint, { method: "POST" });
      } catch {
        // Si el logout falla igual redirigimos — el servidor de todas
        // formas rechazará la cookie expirada en la próxima request.
      }
      if (activo) router.push(config!.loginPath);
    }

    function reportarActividad() {
      const ahoraMs = Date.now();
      let ultimo: number | null = null;
      try {
        const guardado = window.localStorage.getItem(config!.storageKey);
        ultimo = guardado ? Number(guardado) : null;
      } catch {
        ultimo = null; // localStorage no disponible: se reporta igual, solo se pierde la coordinación entre pestañas.
      }
      if (!debeReportarPorThrottle(ultimo, ahoraMs)) return;
      try {
        window.localStorage.setItem(config!.storageKey, String(ahoraMs));
      } catch {
        // No bloquea el reporte de esta pestaña si localStorage falla (modo privado estricto, cuota, etc.).
      }

      enVueloRef.current?.abort();
      const controller = new AbortController();
      enVueloRef.current = controller;
      fetch(config!.activityEndpoint, { method: "POST", signal: controller.signal })
        .then((res) => {
          if (res.status === 401) void cerrarSesionYRedirigir();
        })
        .catch(() => {
          // Fallo de red: no es señal de expiración — se reintenta en el próximo evento humano real.
        });
    }

    function alEvento(event: Event) {
      if (!esEventoDeActividadHumana(event)) return;
      reportarActividad();
    }

    function validarSinRenovar() {
      // Recuperar pestaña (focus/visibilitychange): SOLO valida vigencia,
      // nunca reporta actividad ni renueva lastActivityAt (GET, no POST).
      fetch(config!.activityEndpoint, { method: "GET" })
        .then((res) => {
          if (res.status === 401) void cerrarSesionYRedirigir();
        })
        .catch(() => {});
    }

    function alFocus() {
      validarSinRenovar();
    }

    function alVisibilityChange() {
      if (document.visibilityState === "visible") validarSinRenovar();
    }

    window.addEventListener("pointerdown", alEvento);
    window.addEventListener("keydown", alEvento);
    window.addEventListener("touchstart", alEvento);
    window.addEventListener("focus", alFocus);
    document.addEventListener("visibilitychange", alVisibilityChange);

    return () => {
      activo = false;
      window.removeEventListener("pointerdown", alEvento);
      window.removeEventListener("keydown", alEvento);
      window.removeEventListener("touchstart", alEvento);
      window.removeEventListener("focus", alFocus);
      document.removeEventListener("visibilitychange", alVisibilityChange);
      enVueloRef.current?.abort();
    };
  }, [config, router]);

  return null;
}
