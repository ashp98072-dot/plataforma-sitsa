import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SITSA Plataforma Corporativa",
  description: "Multiempresa · RRHH · TMS · Flota · Contabilidad",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
