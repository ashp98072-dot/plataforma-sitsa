import type { Metadata } from "next";
import "./globals.css";
import { SessionInactivityGuard } from "@/components/session-inactivity-guard";

export const metadata: Metadata = {
  title: "SITSA Plataforma Corporativa",
  description: "Multiempresa · RRHH · TMS · Flota · Contabilidad",
};

const themeBoot = `
(function(){
  try {
    var t = localStorage.getItem('sitsa-theme');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        {/*
          SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — una sola instancia para
          las 3 sesiones (staff/colaborador/cliente); se autoconfigura
          según el prefijo de la ruta actual y no hace nada en rutas
          públicas (login de cualquiera de los 3 dominios, /site) — ver
          resolverConfiguracionGuard en session-inactivity-guard.tsx.
        */}
        <SessionInactivityGuard />
        {children}
      </body>
    </html>
  );
}
