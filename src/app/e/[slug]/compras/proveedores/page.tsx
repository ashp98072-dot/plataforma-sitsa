import { obtenerAccesoComprasPagina } from "@/lib/compras/acceso";
import { tienePermiso } from "@/lib/permisos-shared";
import { ProveedoresComercialesClient } from "@/components/compras/proveedores-comerciales-client";
export default async function ProveedoresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoComprasPagina(slug, "compras_proveedores");
  if (guard.error) return <p className="p-6">Sin acceso a proveedores comerciales.</p>;
  const permisos = guard.permisos;
  return <ProveedoresComercialesClient slug={slug} puedeCrear={tienePermiso(permisos, "compras_proveedores", "crear")} puedeEditar={tienePermiso(permisos, "compras_proveedores", "editar")} />;
}
