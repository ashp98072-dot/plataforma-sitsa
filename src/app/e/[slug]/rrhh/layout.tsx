import { redirect } from "next/navigation";
import { SinAccesoRrhh } from "@/components/rrhh/sin-acceso-rrhh";
import { RRHH_SUBMODULOS } from "@/lib/permisos-shared";
import { guardRrhhAlguno } from "@/lib/rrhh-page-guard";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

/** Bloquea todo /rrhh/* si el usuario no tiene ningún permiso RRHH. */
export default async function RrhhAreaLayout({ children, params }: Props) {
  const { slug } = await params;
  // RRHH-REQUERIMIENTOS-PROVEEDORES-1: "rrhh_requerimientos"/"rrhh_proveedores" también dan acceso a /rrhh/* aunque
  // no vivan en RRHH_SUBMODULOS (ver guardRrhhAlguno).
  const g = await guardRrhhAlguno([...RRHH_SUBMODULOS, "rrhh_requerimientos", "rrhh_proveedores"]);
  if (g.ok === false && g.reason === "login") redirect("/login");
  if (g.ok === false) {
    return (
      <SinAccesoRrhh
        slug={slug}
        detalle="Este módulo es de RRHH. Tu perfil (p. ej. Operaciones) no tiene permisos de Personal / Empleados. Los pilotos se eligen en TMS al crear el plan."
      />
    );
  }
  return children;
}
