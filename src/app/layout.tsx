import type { Metadata } from "next";
import "./globals.css";
import { SessionInactivityGuard } from "@/components/session-inactivity-guard";

export const metadata: Metadata = {
  title: "Novalvion | Plataforma Corporativa",
  description: "Plataforma corporativa para RRHH, TMS, Flota y Contabilidad",
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
