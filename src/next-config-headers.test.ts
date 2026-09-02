import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * CLIENTE-PORTAL-CACHE-HEADERS — regresión: el CDN de Hostinger cachea
 * agresivamente cualquier ruta sin `Cache-Control: no-store` explícito,
 * y puede terminar sirviendo el payload crudo de React Server Components
 * como si fuera la página (incidente real ya visto en /portal/login y
 * ahora también en /cliente-portal/login). Este test fija por contrato
 * que TODAS las áreas autenticadas de la app declaran no-store — evita
 * que una nueva área (o esta misma) se quede fuera de la lista otra vez
 * sin que ningún test lo note.
 */
describe("next.config headers() — no-cache en áreas autenticadas (anti-incidente CDN)", () => {
  async function reglas() {
    const headersFn = nextConfig.headers;
    if (!headersFn) throw new Error("next.config.ts no define headers().");
    return headersFn();
  }

  it.each([
    "/login",
    "/",
    "/select-empresa",
    "/e/:path*",
    "/portal/:path*",
    "/cliente-portal/:path*",
  ])("declara Cache-Control no-store para %s", async (source) => {
    const rules = await reglas();
    const rule = rules.find((r) => r.source === source);
    expect(rule).toBeDefined();
    const cacheControl = rule?.headers.find((h) => h.key === "Cache-Control");
    expect(cacheControl?.value).toBe("private, no-store, no-cache");
  });

  it("assets estáticos con hash SÍ se cachean largo (comportamiento distinto, a propósito)", async () => {
    const rules = await reglas();
    const rule = rules.find((r) => r.source === "/_next/static/:path*");
    const cacheControl = rule?.headers.find((h) => h.key === "Cache-Control");
    expect(cacheControl?.value).toBe("public, max-age=31536000, immutable");
  });
});
