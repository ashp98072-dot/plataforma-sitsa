import { redirect } from "next/navigation";
import { SinAccesoRrhh } from "@/components/rrhh/sin-acceso-rrhh";
import { guardRrhhSub } from "@/lib/rrhh-page-guard";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function EmpleadosLayout({ children, params }: Props) {
  const { slug } = await params;
  const g = await guardRrhhSub("empleados");
  if (g.ok === false && g.reason === "login") redirect("/login");
  if (g.ok === false) {
    return (
      <SinAccesoRrhh
        slug={slug}
        detalle="No tienes permiso «Empleados» en RRHH. Un administrador debe marcar Ver/Crear en tu usuario si realmente lo necesitas."
      />
    );
  }
  return children;
}
