"use client";
import Link from "next/link";
import { CombustibleRevisionPanel } from "./combustible-revision";
import type { CapacidadesCombustible } from "@/lib/flota/combustible-permisos";
export function CombustiblesClient({ slug, capacidades }: { slug: string; capacidades: CapacidadesCombustible }) {
  return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Combustibles</h1>
    <div className="flex flex-wrap gap-2">
      {capacidades.ver && <Link href={`/e/${slug}/combustibles/importaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Importaciones de proveedor</Link>}
      {capacidades.registrar && <Link href={`/e/${slug}/combustibles/nuevo`} prefetch={false} className="inline-block rounded bg-sky-700 px-3 py-2 text-white">Registrar vale</Link>}
      {capacidades.gestionar_estaciones && <Link href={`/e/${slug}/combustibles/estaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Estaciones de combustible</Link>}
    </div>
    <CombustibleRevisionPanel slug={slug} capacidades={capacidades} />
  </section>;
}
