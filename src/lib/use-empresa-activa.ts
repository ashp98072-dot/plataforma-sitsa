"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export function useEmpresaActiva(): { slug: string; nombre: string } {
  const slug = String(useParams().slug ?? "");
  const [nombre, setNombre] = useState(slug);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const match = (data.empresas ?? []).find(
          (e: { slug: string; nombre: string }) => e.slug === slug,
        );
        if (match?.nombre) setNombre(String(match.nombre));
        else if (data.user?.empresaNombre && data.user?.empresaSlug === slug) {
          setNombre(String(data.user.empresaNombre));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { slug, nombre };
}
