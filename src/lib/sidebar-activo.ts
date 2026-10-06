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
