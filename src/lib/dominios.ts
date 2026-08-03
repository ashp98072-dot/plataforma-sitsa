/**
 * Mapa dominio → slug de empresa.
 *
 * Sobrescribe o completa con env EMPRESA_DOMINIOS (JSON), ej:
 * EMPRESA_DOMINIOS={"logiserviciosmonaco.com":"kt-monaco","tarimacenter.com":"tarimas"}
 *
 * Asignación actual (parcial — ajustar cuando confirmen Francisco / otros):
 * - KT / Mónaco: logiserviciosmonaco.com, monacoexpres.com
 * - Tarimas: tarimacenter.com
 * - Ecoplanet: recicladoraecoplanet.com, ecoplanetreciclaje.com
 * - Francisco: pendiente (candidato: fuginsa.com)
 * - Sin asignar aún: ecowastegt.com, multinegocios12.com, innovacionesplasticas.com
 */
export const DOMINIOS_DEFAULT: Record<string, string> = {
  // KT / Logiservicios Mónaco
  "logiserviciosmonaco.com": "kt-monaco",
  "www.logiserviciosmonaco.com": "kt-monaco",
  "app.logiserviciosmonaco.com": "kt-monaco",
  "monacoexpres.com": "kt-monaco",
  "www.monacoexpres.com": "kt-monaco",
  "app.monacoexpres.com": "kt-monaco",

  // Tarimas Center
  "tarimacenter.com": "tarimas",
  "www.tarimacenter.com": "tarimas",
  "app.tarimacenter.com": "tarimas",

  // Ecoplanet / reciclaje
  "recicladoraecoplanet.com": "ecoplanet",
  "www.recicladoraecoplanet.com": "ecoplanet",
  "app.recicladoraecoplanet.com": "ecoplanet",
  "ecoplanetreciclaje.com": "ecoplanet",
  "www.ecoplanetreciclaje.com": "ecoplanet",
  "app.ecoplanetreciclaje.com": "ecoplanet",

  // Francisco — descomentar cuando confirmen dominio
  // "fuginsa.com": "francisco",
  // "www.fuginsa.com": "francisco",
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
