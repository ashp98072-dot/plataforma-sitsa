"use client";
import Link from "next/link";
import { CombustibleRevisionPanel } from "./combustible-revision";
import type { CapacidadesCombustible } from "@/lib/flota/combustible-permisos";
import { CombustiblesCB2 } from "./cb2/panel";
export function CombustiblesClient({ slug, capacidades, admin=false, actorId=0 }: { slug: string; capacidades: CapacidadesCombustible; admin?:boolean; actorId?:number }) {
  return <section className="mx-auto min-w-0 max-w-7xl space-y-6 p-4 text-[var(--text)] sm:p-6"><header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Operaciones</p><h1 className="text-3xl font-semibold tracking-tight">Combustibles</h1><p className="max-w-2xl text-sm text-[var(--muted)]">Controla tus consumos, importa archivos de proveedores y consulta facturas con la trazabilidad de cada operación.</p></header>
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Funciones históricas"><div><h2 className="text-sm font-semibold">Vales y operación histórica</h2><p className="mt-1 text-xs text-[var(--muted)]">Accede al registro de vales, estaciones y conciliación existentes.</p></div><div className="flex flex-wrap gap-2 text-sm">
      {capacidades.ver && <Link href={`/e/${slug}/combustibles/importaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Importaciones históricas / conciliación</Link>}
      {capacidades.registrar && <Link href={`/e/${slug}/combustibles/nuevo`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2 hover:bg-[var(--bg)]">Registrar vale</Link>}
      {capacidades.gestionar_estaciones && <Link href={`/e/${slug}/combustibles/estaciones`} prefetch={false} className="inline-block rounded border border-[var(--border)] px-3 py-2">Estaciones de combustible</Link>}
    </div></section>
    {capacidades.ver && <CombustiblesCB2 key={`${slug}:${actorId}`} slug={slug} actorId={actorId} admin={admin} canWrite={capacidades.conciliar} />}
    <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-semibold">Vales actuales: revisión y conciliación</summary><p className="my-3 text-sm text-[var(--muted)]">Se conservan el registro, aprobación, fondos y conciliación de vales existentes, independientes de los consumos importados.</p><CombustibleRevisionPanel slug={slug} capacidades={capacidades} /></details>
  </section>;
}
