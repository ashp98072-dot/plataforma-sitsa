"use client";

import { Suspense } from "react";
import PlanesViajesClient from "./planes-viajes-client";

/**
 * Operaciones → Planes / Viajes (OPERACIONES-UX-PLANES-SIMPLIFICADO-1).
 * El cliente usa useSearchParams (deep-link ?plan=<id>&cerrado=1 desde
 * Programación tras cerrar un viaje) — Next exige envolverlo en <Suspense>.
 */
export default function PlanesPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--muted)]">Cargando planes…</p>}
    >
      <PlanesViajesClient modo="operativo" />
    </Suspense>
  );
}
