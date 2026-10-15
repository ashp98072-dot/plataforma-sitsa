import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { CombustibleNuevoClient } from "@/components/flota/combustible-nuevo-client";

export default async function NuevoValePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await requireTenantFlotaCombustible(slug, "registrar");
  if (guard.error) return <p className="p-6">Sin permiso para registrar vales de combustible.</p>;
  return <CombustibleNuevoClient slug={slug} />;
}
