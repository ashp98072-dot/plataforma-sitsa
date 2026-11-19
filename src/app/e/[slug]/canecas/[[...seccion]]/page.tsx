import { accesoCanecas } from "@/lib/canecas/acceso";
import { CanecasClient } from "@/components/canecas/canecas-client";
import { TrasladosClient } from "@/components/canecas/traslados-client";
import { notFound, redirect } from "next/navigation";

export default async function CanecasPage({ params }: { params: Promise<{ slug: string; seccion?: string[] }> }) {
  const { slug, seccion = [] } = await params;
  const vista = seccion[0] ?? "panel";
  if (seccion.length > 1 || !["panel", "productos", "ubicaciones", "compras", "recepciones", "inventario", "movimientos", "traslados"].includes(vista)) notFound();
  const lectura = await accesoCanecas(slug, "ver", { soloLectura: true });
  if (lectura.error?.status === 401) redirect("/login");
  if (lectura.error) return <p role="alert">No tienes permiso para consultar Gestión de Canecas.</p>;
  const acciones = ["catalogo", "compras", "recepciones", "confirmar"] as const;
  const resultados = await Promise.all(acciones.map(accion => accesoCanecas(slug, accion, { soloLectura: true })));
  const permisos = Object.fromEntries(acciones.map((accion, i) => [accion, !resultados[i].error]));
  if (vista === "traslados") return <TrasladosClient slug={slug} permisos={permisos} />;
  return <CanecasClient slug={slug} vista={vista} permisos={permisos} />;
}

