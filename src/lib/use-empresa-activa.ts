"use client";

import { useParams } from "next/navigation";
import { useEmpresaSession } from "@/lib/empresa-session";

/** Nombre de empresa desde el layout (sin fetch extra a /api/auth/me). */
export function useEmpresaActiva(): { slug: string; nombre: string } {
  const slug = String(useParams().slug ?? "");
  const { empresaNombre } = useEmpresaSession();
  return { slug, nombre: empresaNombre || slug };
}
