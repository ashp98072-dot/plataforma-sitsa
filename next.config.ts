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
        source: "/e/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
