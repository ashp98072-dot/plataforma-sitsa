"use client";
import Link from "next/link";
import { CombustibleRevisionPanel } from "./combustible-revision";
import type { CapacidadesCombustible } from "@/lib/flota/combustible-permisos";
export function CombustiblesClient({ slug, capacidades }: { slug: string; capacidades: CapacidadesCombustible }) {
  return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Combustibles</h1>
    {capacidades.gestionar_estaciones && <Link href={`/e/${slug}/combustibles/estaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Estaciones de combustible</Link>}
    <CombustibleRevisionPanel slug={slug} capacidades={capacidades} />
  </section>;
}
