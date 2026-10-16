import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { ImportacionesCombustible } from "@/components/flota/combustible-importaciones-client";
export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params; const g = await requireTenantFlotaCombustible(slug, "ver");
  if (g.error) return <p>Sin acceso a importaciones.</p>;
  return <ImportacionesCombustible key={`${slug}:${id}`} slug={slug} id={id} puedeImportar={false} />;
}
