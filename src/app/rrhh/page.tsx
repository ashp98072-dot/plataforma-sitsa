"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** RRHH usa el mismo selector de empresa que Contabilidad. */
export default function RrhhRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/select-empresa");
  }, [router]);
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <p className="text-[var(--muted)]">Cargando selector de empresa…</p>
    </main>
  );
}
