import Link from "next/link";
import { obtenerAccesoComprasPagina } from "@/lib/compras/acceso";
export default async function ComprasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guard = await obtenerAccesoComprasPagina(slug);
  if (guard.error) return <p className="p-6">Sin acceso a proveedores comerciales.</p>;
  return <main className="p-6 space-y-6"><h1 className="text-2xl font-semibold">Compras / Repuestos</h1>
    <Link className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-6" href={`/e/${slug}/compras/proveedores`}>
      <h2 className="font-semibold">Proveedores comerciales</h2><p>Administrar proveedores de compras.</p>
    </Link></main>;
}
