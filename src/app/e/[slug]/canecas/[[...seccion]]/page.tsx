import { CanecasClient } from "@/components/canecas/canecas-client";
import { notFound } from "next/navigation";

export default async function CanecasPage({ params }: { params: Promise<{ slug: string; seccion?: string[] }> }) {
  const { slug, seccion = [] } = await params;
  const vista = seccion[0] ?? "panel";
  if (seccion.length > 1 || !["panel", "productos", "ubicaciones", "compras", "recepciones", "inventario", "movimientos"].includes(vista)) notFound();
  return <CanecasClient slug={slug} vista={vista} />;
}
