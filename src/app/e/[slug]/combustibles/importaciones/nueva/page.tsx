import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { NuevaImportacionCombustible } from "@/components/flota/combustible-importaciones-client";
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const g = await requireTenantFlotaCombustible(slug, "conciliar");
  if (g.error) return <p>Sin permiso para importar.</p>;
  return <NuevaImportacionCombustible key={slug} slug={slug} />;
}
