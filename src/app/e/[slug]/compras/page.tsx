import Link from "next/link";
import { obtenerAccesoComprasPagina } from "@/lib/compras/acceso";
import { tienePermiso } from "@/lib/permisos-shared";
export default async function ComprasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoComprasPagina(slug);
  if (guard.error) return <p className="p-6">Sin acceso a Compras / Repuestos.</p>;
  return <main className="p-6 space-y-6"><h1 className="text-2xl font-semibold">Compras / Repuestos</h1>
    {tienePermiso(guard.permisos, "compras_requerimientos", "ver") && <Link className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-6" href={`/e/${slug}/compras/requerimientos`}>
      <h2 className="font-semibold">Requerimientos de compra</h2><p>Crear, consultar y administrar requerimientos de repuestos.</p>
    </Link>}
    {tienePermiso(guard.permisos, "compras_proveedores", "ver") && <Link className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-6" href={`/e/${slug}/compras/proveedores`}>
      <h2 className="font-semibold">Proveedores comerciales</h2><p>Administrar proveedores de compras.</p>
    </Link>}</main>;
}
