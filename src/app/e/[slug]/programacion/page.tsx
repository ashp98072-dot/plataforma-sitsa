import { hoyLocal } from "@/lib/rrhh/dates";
import { ProgramacionClient } from "./programacion-client";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ plan?: string }>;
};

/**
 * Operaciones → Programación: pantalla operativa de viajes. Consume tal
 * cual GET /api/empresas/[slug]/tms/planes (mismo endpoint que ya usa
 * tms/page.tsx). "Hoy" se calcula server-side (mismo patrón que
 * portal/marcajes/page.tsx) para evitar desfaces de reloj cliente/servidor.
 *
 * VIAT-1b: ?plan=ID (enlace "Ver en Programación" desde TMS) abre
 * directamente ese viaje en modo edición al cargar — puramente un valor
 * inicial para el estado de ProgramacionClient, sin lógica nueva de
 * backend.
 */
export default async function ProgramacionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { plan } = await searchParams;
  const planInicialId = plan ? Number(plan) : null;
  return (
    <ProgramacionClient
      slug={slug}
      hoy={hoyLocal()}
      planInicialId={Number.isFinite(planInicialId) ? planInicialId : null}
    />
  );
}
