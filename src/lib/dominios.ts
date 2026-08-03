/**
 * Mapa dominio → slug de empresa.
 * Configurable por env EMPRESA_DOMINIOS (JSON) sin tocar código.
 *
 * Ejemplo:
 * EMPRESA_DOMINIOS={"logiserviciosmonaco.com":"kt-monaco","www.logiserviciosmonaco.com":"kt-monaco","tarimascenter.com":"tarimas"}
 */
export const DOMINIOS_DEFAULT: Record<string, string> = {
  "logiserviciosmonaco.com": "kt-monaco",
  "www.logiserviciosmonaco.com": "kt-monaco",
  // Ajusta cuando tengas los dominios reales:
  "tarimascenter.com": "tarimas",
  "www.tarimascenter.com": "tarimas",
  "francisco.com": "francisco",
  "www.francisco.com": "francisco",
  "frescofreesh.com": "frescofresh",
  "www.frescofreesh.com": "frescofresh",
  "ecoplanet.com": "ecoplanet",
  "www.ecoplanet.com": "ecoplanet",
};

export function mapaDominios(): Record<string, string> {
  const raw = process.env.EMPRESA_DOMINIOS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return { ...DOMINIOS_DEFAULT, ...parsed };
    } catch {
      /* ignore */
    }
  }
  return DOMINIOS_DEFAULT;
}

export function slugPorHost(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0].toLowerCase().trim();
  if (!host) return null;
  const map = mapaDominios();
  return map[host] ?? null;
}

export function esDominioCorporativo(hostHeader: string | null): boolean {
  return slugPorHost(hostHeader) != null;
}

/** Destino post-login / home según rol, en dominio de empresa. */
export function homePorRol(
  rol: string,
  slug: string,
  dominioEmpresa: boolean,
): string {
  const base = dominioEmpresa ? "" : `/e/${slug}`;
  if (rol === "RRHH" || rol === "Admin") return `${base}/dashboard-rrhh`;
  if (rol === "Operaciones" || rol === "CoordinadorPredios") {
    return `${base}/dashboard-operaciones`;
  }
  if (rol === "Contabilidad") {
    return dominioEmpresa ? `/contabilidad` : `/e/${slug}/contabilidad`;
  }
  return dominioEmpresa ? `/dashboard-rrhh` : `/e/${slug}/dashboard`;
}
