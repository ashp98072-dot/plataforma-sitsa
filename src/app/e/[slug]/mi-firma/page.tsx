"use client";

import { useParams } from "next/navigation";
import MiFirmaPanel from "@/components/mi-firma-panel";

/**
 * MI-FIRMA-1 — accesible para CUALQUIER usuario corporativo autenticado
 * (no solo Admin/Administración — ver enlace en app-shell.tsx junto a
 * "Cambiar empresa"/"Salir"). La firma es global por usuario, este
 * endpoint solo vive bajo /e/[slug]/ por conveniencia de sesión.
 */
export default function MiFirmaPage() {
  const slug = String(useParams().slug);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mi firma</h1>
        <p className="text-sm text-[var(--muted)]">
          Firma manuscrita personal que puedes usar para autorizar y liquidar viáticos sin dibujarla cada vez.
        </p>
      </div>
      <MiFirmaPanel slug={slug} />
    </div>
  );
}
