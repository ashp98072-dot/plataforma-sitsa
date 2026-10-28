import { CalendarioContable } from "@/components/contabilidad/calendario-contable";
import { requireTenantCalendario } from "@/lib/tenant";

export default async function CalendarioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = await requireTenantCalendario(slug, "ver");
  if (g.error) return <p>Sin acceso al calendario contable.</p>;
  const crear = await requireTenantCalendario(slug, "crear");
  return <CalendarioContable slug={slug} puedeCrear={!crear.error} />;
}
