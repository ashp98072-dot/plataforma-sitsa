"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

/**
 * Flota es un módulo muy grande. En Hostinger un SSR/HTML completo a veces
 * llega truncado (pantalla blanca con restos tipo n"]). Cargamos el cliente
 * solo en el browser; el shell de empresa ya viene del layout.
 */
const FlotaClient = dynamic(() => import("./flota-client"), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-[var(--muted)]">Cargando flota…</p>
  ),
});

export default function FlotaPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--muted)]">Cargando flota…</p>}
    >
      <FlotaClient />
    </Suspense>
  );
}
