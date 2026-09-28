import { obtenerAccesoRrhhReqPagina } from "@/lib/rrhh/requerimiento-acceso";
import { tienePermiso } from "@/lib/permisos-shared";
import { ProveedoresRrhhClient } from "@/components/rrhh/proveedores-rrhh-client";

export default async function ProveedoresRrhhPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoRrhhReqPagina(slug, "rrhh_proveedores");
  if (guard.error) return <p className="p-6">Sin acceso a proveedores de RRHH.</p>;
  const permisos = guard.permisos;
  return <ProveedoresRrhhClient slug={slug} puedeCrear={tienePermiso(permisos, "rrhh_proveedores", "crear")} puedeEditar={tienePermiso(permisos, "rrhh_proveedores", "editar")} />;
}
