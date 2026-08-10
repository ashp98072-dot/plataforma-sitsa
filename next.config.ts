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
