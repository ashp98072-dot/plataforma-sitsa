import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { CombustibleEstacionesClient } from "@/components/flota/combustible-estaciones-client";
export default async function EstacionesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await requireTenantFlotaCombustible(slug, "gestionar_estaciones");
  if (guard.error) return <p className="p-6">Sin acceso a estaciones de combustible.</p>;
  return <CombustibleEstacionesClient slug={slug} puedeEditar />;
}
