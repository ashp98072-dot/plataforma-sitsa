import { hoyLocal } from "@/lib/rrhh/dates";
import { ProgramacionClient } from "./programacion-client";

type Props = { params: Promise<{ slug: string }> };

/**
 * Operaciones → Programación (Fase P3): tablero operativo de SOLO LECTURA
 * sobre los planes TMS existentes. No crea escrituras nuevas — consume tal
 * cual GET /api/empresas/[slug]/tms/planes (mismo endpoint que ya usa
 * tms/page.tsx). "Hoy" se calcula server-side (mismo patrón que
 * portal/marcajes/page.tsx) para evitar desfaces de reloj cliente/servidor.
 */
export default async function ProgramacionPage({ params }: Props) {
  const { slug } = await params;
  return <ProgramacionClient slug={slug} hoy={hoyLocal()} />;
}
