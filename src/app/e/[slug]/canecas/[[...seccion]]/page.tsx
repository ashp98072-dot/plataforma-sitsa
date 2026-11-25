import { accesoCanecas } from "@/lib/canecas/acceso";
import { CanecasClient } from "@/components/canecas/canecas-client";
import { ReportesComerciales } from "@/components/canecas/reportes-comerciales";
import { MapeoProveedores } from "@/components/canecas/mapeo-proveedores";
import { notFound, redirect } from "next/navigation";

export default async function CanecasPage({ params }: { params: Promise<{ slug: string; seccion?: string[] }> }) {
  const { slug, seccion = [] } = await params;
  const vista = seccion[0] ?? "panel";
  if (seccion.length > 1 || !["panel", "productos", "ubicaciones", "compras", "inventario", "movimientos", "salidas", "proveedores", "clientes", "ventas", "redistribuciones", "reportes", "proveedores-historicos"].includes(vista)) notFound();
  const lectura = await accesoCanecas(slug, "ver", { soloLectura: true });
  if (lectura.error?.status === 401) redirect("/login");
  if (lectura.error) return <p role="alert">No tienes permiso para consultar Gestión de Canecas.</p>;
  const acciones = ["catalogo", "compras", "recepciones", "confirmar", "ventas"] as const;
  const resultados = await Promise.all(acciones.map(accion => accesoCanecas(slug, accion, { soloLectura: true })));
  const permisos = Object.fromEntries(acciones.map((accion, i) => [accion, !resultados[i].error]));
  if (vista === "reportes") return permisos.ventas ? <ReportesComerciales slug={slug} /> : <p role="alert">No tienes permiso para ver los reportes comerciales.</p>;
  if (vista === "proveedores-historicos") return permisos.catalogo ? <MapeoProveedores slug={slug} /> : <p role="alert">No tienes permiso para administrar proveedores.</p>;
  return <CanecasClient slug={slug} vista={vista} permisos={permisos} empresaId={lectura.empresa?.id} usuarioId={lectura.session?.id} empresaNombre={lectura.empresa?.nombre} logoUrl={lectura.empresa?.logoUrl} />;
}
