import { accesoCanecas } from "@/lib/canecas/acceso";
import { CanecasClient } from "@/components/canecas/canecas-client";
import { notFound } from "next/navigation";

export default async function CanecasPage({ params }: { params: Promise<{ slug: string; seccion?: string[] }> }) {
  const { slug, seccion = [] } = await params;
  const vista = seccion[0] ?? "panel";
  if (seccion.length > 1 || !["panel", "productos", "ubicaciones", "compras", "recepciones", "inventario", "movimientos"].includes(vista)) notFound();
  const acciones = ["catalogo", "compras", "recepciones", "confirmar"] as const;
  const resultados = await Promise.all(acciones.map(accion => accesoCanecas(slug, accion)));
  const permisos = Object.fromEntries(acciones.map((accion, i) => [accion, !resultados[i].error]));
  return <CanecasClient slug={slug} vista={vista} permisos={permisos} />;
}
