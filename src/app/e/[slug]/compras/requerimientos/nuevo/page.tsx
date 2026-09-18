import { obtenerAccesoComprasPagina } from "@/lib/compras/acceso";
import { tienePermiso } from "@/lib/permisos-shared";
import { RequerimientoFormClient } from "@/components/compras/requerimiento-form-client";
export default async function NuevoRequerimientoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoComprasPagina(slug, "compras_requerimientos", "crear");
  if (guard.error) return <p className="p-6">Sin permiso para crear requerimientos de compra.</p>;
  // puedeSubirDocumentos: false — un requerimiento nuevo aún no tiene
  // líneas con id (compras_linea_documentos exige requerimiento_id/
  // linea_id ya persistidos), así que la sección Documentos nunca se
  // renderiza aquí; el valor es inerte pero se pasa explícito.
  return <RequerimientoFormClient slug={slug} editable solicitante={guard.session.nombre ?? guard.session.username} fechaHoy={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date())} puedeEliminar={false} puedeVerProveedores={tienePermiso(guard.permisos, "compras_proveedores", "ver")} puedeSubirDocumentos={false} />;
}
