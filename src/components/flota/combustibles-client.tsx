"use client";
import { CombustibleRevisionPanel } from "./combustible-revision";
export function CombustiblesClient({ slug, puedeEditar }: { slug: string; puedeEditar: boolean }) {
  return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Combustibles</h1>
    <CombustibleRevisionPanel slug={slug} can={(_sub, accion = "ver") => accion === "ver" || (accion === "editar" && puedeEditar)} />
  </section>;
}
