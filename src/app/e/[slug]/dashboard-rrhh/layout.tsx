import { redirect } from "next/navigation";
import { SinAccesoRrhh } from "@/components/rrhh/sin-acceso-rrhh";
import { RRHH_SUBMODULOS } from "@/lib/permisos-shared";
import { guardRrhhAlguno } from "@/lib/rrhh-page-guard";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function DashboardRrhhLayout({ children, params }: Props) {
  const { slug } = await params;
  const g = await guardRrhhAlguno([...RRHH_SUBMODULOS]);
  if (g.ok === false && g.reason === "login") redirect("/login");
  if (g.ok === false) {
    return (
      <SinAccesoRrhh
        slug={slug}
        detalle="El dashboard de RRHH solo está disponible si tienes permisos de Control de Asistencias."
      />
    );
  }
  return children;
}
