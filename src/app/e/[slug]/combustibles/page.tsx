import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { permisosEfectivos } from "@/lib/permisos";
import { capacidadesCombustible } from "@/lib/flota/combustible-permisos";
import type { RolGlobal } from "@/lib/roles";
import { CombustiblesClient } from "@/components/flota/combustibles-client";

export default async function CombustiblesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return <p className="p-6">Sin acceso a Combustibles.</p>;
  const permisos = await permisosEfectivos(guard.session.id, guard.session.rol as RolGlobal);
  return <CombustiblesClient slug={slug} actorId={guard.session.id} admin={guard.session.rol === "Admin"} capacidades={capacidadesCombustible(permisos, guard.session.rol === "Admin")} />;
}
