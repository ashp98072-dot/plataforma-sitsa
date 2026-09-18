import { obtenerAccesoComprasPagina } from "@/lib/compras/acceso";
import { tienePermiso } from "@/lib/permisos-shared";
import { RequerimientosClient } from "@/components/compras/requerimientos-client";
export default async function RequerimientosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoComprasPagina(slug, "compras_requerimientos");
  if (guard.error) return <p className="p-6">Sin acceso a requerimientos de compra.</p>;
  return <RequerimientosClient slug={slug} puedeCrear={tienePermiso(guard.permisos, "compras_requerimientos", "crear")} puedeEditar={tienePermiso(guard.permisos, "compras_requerimientos", "editar")} puedeAutorizar={tienePermiso(guard.permisos, "compras_autorizar", "editar")} />;
}
