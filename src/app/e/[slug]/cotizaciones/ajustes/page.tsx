import { redirect } from "next/navigation";
import { CotizacionAjustesClient } from "@/components/tms/cotizacion-ajustes-client";
import { requireTenantCotizacionesAjustes } from "@/lib/tenant";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const guard=await requireTenantCotizacionesAjustes(slug,"ver");if(guard.error)redirect(`/e/${slug}/cotizaciones`);
 const admin=guard.session.rol==="Admin";const permisos=admin?[]:await permisosEfectivos(guard.session.id,guard.session.rol as RolGlobal);
 return <CotizacionAjustesClient slug={slug} puedeCrear={admin||tienePermiso(permisos,"cotizaciones_ajustes","crear")} puedeEditar={admin||tienePermiso(permisos,"cotizaciones_ajustes","editar")}/>;}
