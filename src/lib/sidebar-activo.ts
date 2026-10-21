/** Red de seguridad: el indicador global de navegación pendiente nunca debe quedar más de este tiempo. */
export const NAV_PENDING_FALLBACK_MS = 8_000;

function rutaSinQuery(href: string): string {
  const url = new URL(href, "https://sidebar.local");
  return url.pathname.replace(/\/$/, "") || "/";
}

/**
 * ¿El clic en un enlace del sidebar debe activar el indicador GLOBAL de navegación (barra + opacidad del contenido)?
 * Solo cuando de verdad se cambia de página: un destino con el MISMO pathname (p. ej. otra pestaña `?tab=` de Flota) no
 * remonta la página ni cambia el slot `children` del layout, así que ese indicador nunca se liberaría por `children`;
 * esas transiciones ya tienen sus indicadores locales. El enlace activo tampoco lo activa (comportamiento previo).
 */
export function debeMarcarNavegacionPendiente(pathnameActual: string, hrefDestino: string, activo: boolean): boolean {
  if (activo) return false;
  return rutaSinQuery(hrefDestino) !== rutaSinQuery(pathnameActual);
}

/** Elige un único enlace visible. Las pestañas son parte de la identidad de la ruta. */
export function enlaceSidebarActivo(pathname: string, query: string, hrefs: string[]): string | null {
  const actual = new URLSearchParams(query);
  const candidatos = hrefs.flatMap((href) => {
    const url = new URL(href, "https://sidebar.local");
    const path = url.pathname.replace(/\/$/, "") || "/";
    // También admite enlaces/bookmarks históricos de Flota con segmento.
    const tab = url.searchParams.get("tab");
    const alias = tab && path.endsWith("/flota") ? path + "/" + tab : null;
    const coincideAlias = alias && (pathname === alias || pathname.startsWith(alias + "/"));
    if (!coincideAlias && pathname !== path && !(path !== "/" && pathname.startsWith(path + "/"))) return [];
    if (!coincideAlias) {
      for (const [key, value] of url.searchParams) if (actual.get(key) !== value) return [];
      // Un dashboard sin tab no gana frente a una pestaña específica.
      if (!url.searchParams.size && pathname === path && actual.has("tab") && path.endsWith("/flota")) return [];
    }
    return [{ href, score: path.length * 10 + url.searchParams.size + (coincideAlias ? 1000 : 0) }];
  });
  candidatos.sort((a, b) => b.score - a.score);
  return candidatos[0]?.href ?? null;
}
