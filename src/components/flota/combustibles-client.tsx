"use client";
import Link from "next/link";
import { CombustibleRevisionPanel } from "./combustible-revision";
import type { CapacidadesCombustible } from "@/lib/flota/combustible-permisos";
import { CombustiblesCB2 } from "./cb2/panel";
export function CombustiblesClient({ slug, capacidades, admin=false, actorId=0 }: { slug: string; capacidades: CapacidadesCombustible; admin?:boolean; actorId?:number }) {
  return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Combustibles</h1>
    <div className="flex flex-wrap gap-2">
      {capacidades.ver && <Link href={`/e/${slug}/combustibles/importaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Importaciones históricas / conciliación</Link>}
      {capacidades.registrar && <Link href={`/e/${slug}/combustibles/nuevo`} prefetch={false} className="inline-block rounded bg-sky-700 px-3 py-2 text-white">Registrar vale</Link>}
      {capacidades.gestionar_estaciones && <Link href={`/e/${slug}/combustibles/estaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Estaciones de combustible</Link>}
    </div>
    {capacidades.ver && <CombustiblesCB2 key={`${slug}:${actorId}`} slug={slug} actorId={actorId} admin={admin} canWrite={capacidades.conciliar} />}
    <details className="rounded border border-[var(--border)] p-4"><summary className="cursor-pointer font-semibold">Vales actuales: revisión y conciliación</summary><p className="my-2">Se conservan el registro, aprobación, fondos y conciliación de vales existentes, independientes de los consumos importados.</p><CombustibleRevisionPanel slug={slug} capacidades={capacidades} /></details>
  </section>;
}
