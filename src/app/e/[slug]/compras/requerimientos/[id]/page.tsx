import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerAccesoComprasPagina } from "@/lib/compras/acceso";
import { obtenerRequerimiento } from "@/lib/compras/requerimientos";
import { tienePermiso } from "@/lib/permisos-shared";
import { RequerimientoFormClient } from "@/components/compras/requerimiento-form-client";
export default async function DetalleRequerimientoPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ editar?: string }> }) {
  const { slug, id } = await params;
  const guard = await obtenerAccesoComprasPagina(slug, "compras_requerimientos");
  if (guard.error) return <p className="p-6">Sin acceso a requerimientos de compra.</p>;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) notFound();
  const detalle = await obtenerRequerimiento(guard.empresa.id, Number(id));
  if (!detalle) notFound();
  const puedeEditar = detalle.estado === "Pendiente" && tienePermiso(guard.permisos, "compras_requerimientos", "editar");
  const editable = puedeEditar && (await searchParams).editar === "1";
  return <>{puedeEditar && !editable && <Link className="inline-block px-6 pt-5 underline" href={`/e/${slug}/compras/requerimientos/${id}?editar=1`}>Editar requerimiento</Link>}
    <RequerimientoFormClient key={`${detalle.id}-${detalle.version}-${editable}`} slug={slug} detalle={detalle} editable={editable} solicitante={guard.session.nombre ?? guard.session.username} fechaHoy={detalle.fecha_requerimiento} puedeEliminar={tienePermiso(guard.permisos, "compras_requerimientos", "eliminar")} puedeVerProveedores={tienePermiso(guard.permisos, "compras_proveedores", "ver")} puedeSubirDocumentos={tienePermiso(guard.permisos, "compras_requerimientos", "editar")} /></>;
}
