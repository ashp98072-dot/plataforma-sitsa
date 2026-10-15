"use client";
import Link from "next/link";
import { CombustibleRevisionPanel } from "./combustible-revision";
export function CombustiblesClient({ slug, puedeEditar }: { slug: string; puedeEditar: boolean }) {
  return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Combustibles</h1>
    <Link href={`/e/${slug}/combustibles/estaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Estaciones de combustible</Link>
    <CombustibleRevisionPanel slug={slug} can={(_sub, accion = "ver") => accion === "ver" || (accion === "editar" && puedeEditar)} />
  </section>;
}
