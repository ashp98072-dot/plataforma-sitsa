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
        <SessionInactivityGuard />
        {children}
      </body>
    </html>
  );
}
