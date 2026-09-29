import { redirect } from "next/navigation";
import { SinAccesoRrhh } from "@/components/rrhh/sin-acceso-rrhh";
import { guardRrhhSub } from "@/lib/rrhh-page-guard";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

/**
 * ATRACCION-TALENTO-1 — bloquea todo /atraccion-talento/* si el usuario no
 * tiene permiso `entrevistas:ver` (mismo permiso RrhhSubmodulo ya
 * existente, reutilizado sin cambios — ver sección 18 del ticket). Admin
 * siempre pasa (guardRrhhSub).
 */
export default async function AtraccionTalentoLayout({ children, params }: Props) {
  const { slug } = await params;
  const g = await guardRrhhSub("entrevistas");
  if (g.ok === false && g.reason === "login") redirect("/login");
  if (g.ok === false) {
    return (
      <SinAccesoRrhh
        slug={slug}
        detalle="Este módulo es de Atracción de Talento Humano. Tu perfil no tiene permiso de Entrevistas."
      />
    );
  }
  return children;
}
