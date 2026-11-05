import { requireTenantModulo } from "@/lib/tenant";
import { BancosClient } from "@/components/contabilidad/bancos-client";

export default async function BancosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return <p role="alert">Sin acceso al catálogo bancario de esta empresa.</p>;
  return <BancosClient key={slug} slug={slug} />;
}
