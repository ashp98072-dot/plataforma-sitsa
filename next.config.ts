import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Hostinger CDN a veces trunca respuestas gzip/zstd grandes → pantalla blanca.
  // Desactivar compresión de Next; el proxy puede recomprimir de forma más estable.
  compress: false,
  serverExternalPackages: ["exceljs", "pdfkit"],
  async headers() {
    return [
      {
        // HTML de login / entrada: no cachear. Si el CDN sirve HTML viejo,
        // el navegador pide CSS/JS con hash de un build anterior → 404 y página sin estilos.
        source: "/login",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
      {
        source: "/select-empresa",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
      {
        source: "/e/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
      {
        // Igual que /e/:path* arriba, pero para el portal de colaboradores:
        // se había quedado fuera de esta lista, por eso el CDN de Hostinger
        // cacheaba /portal/login y servía versiones viejas (sin estilos, o
        // el payload crudo de React Server Components) en algunos equipos.
        source: "/portal/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
      {
        // MISMO fix que /portal/:path* arriba, aplicado ahora también al
        // Portal del Cliente: se había quedado fuera de esta lista (nunca
        // se agregó cuando se construyó CLIENTE-PORTAL-1) y por eso el CDN
        // de Hostinger reproducía el mismo incidente ya diagnosticado y
        // corregido para /portal/*  — /cliente-portal/login servía el
        // payload crudo de React Server Components ("404: This page could
        // not be found" en texto plano) en vez de la página real.
        source: "/cliente-portal/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
      {
        // Assets con hash: cache largo (el nombre cambia en cada build).
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;