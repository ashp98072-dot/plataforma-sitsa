import { obtenerAccesoRrhhReqPagina } from "@/lib/rrhh/requerimiento-acceso";
import { tienePermiso } from "@/lib/permisos-shared";
import { hoyLocal } from "@/lib/rrhh/dates";
import { RequerimientosRrhhClient } from "@/components/rrhh/requerimientos-rrhh-client";

export default async function RequerimientosRrhhPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoRrhhReqPagina(slug, "rrhh_requerimientos");
  if (guard.error) return <p className="p-6">Sin acceso a requerimientos de RRHH.</p>;
  const permisos = guard.permisos;
  return <RequerimientosRrhhClient
    slug={slug}
    puedeCrear={tienePermiso(permisos, "rrhh_requerimientos", "crear")}
    puedeEditar={tienePermiso(permisos, "rrhh_requerimientos", "editar")}
    puedeAutorizar={tienePermiso(permisos, "rrhh_requerimientos_autorizar", "editar")}
    puedeVerProveedores={tienePermiso(permisos, "rrhh_proveedores", "ver")}
    fechaHoy={hoyLocal()}
  />;
}
