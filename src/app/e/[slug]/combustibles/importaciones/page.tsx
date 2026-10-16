import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { permisosEfectivos } from "@/lib/permisos";
import { capacidadesCombustible } from "@/lib/flota/combustible-permisos";
import type { RolGlobal } from "@/lib/roles";
import { ImportacionesCombustible } from "@/components/flota/combustible-importaciones-client";
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const g = await requireTenantFlotaCombustible(slug, "ver");
  if (g.error) return <p>Sin acceso a importaciones.</p>;
  const caps = capacidadesCombustible(await permisosEfectivos(g.session.id, g.session.rol as RolGlobal), g.session.rol === "Admin");
  return <ImportacionesCombustible key={slug} slug={slug} puedeImportar={caps.conciliar} />;
}
