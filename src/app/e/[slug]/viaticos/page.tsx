"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import ViaticosControlPanel from "@/components/tms/viaticos-control-panel";
import ViaticosPorPagarPanel from "@/components/tms/viaticos-por-pagar-panel";

/**
 * VIAT-3 — Operaciones > Viáticos: módulo visible dedicado a administrar
 * TODOS los viáticos de la empresa. No es un motor nuevo — reutiliza
 * completamente tms_viaticos, los permisos existentes (viaticos,
 * viaticos_autorizar, viaticos_pagar), los endpoints ya construidos en
 * VIAT-1/VIAT-2 (autorizar/entrega/liquidar/control/por-pagar/exportar) y
 * los mismos componentes (ViaticosControlPanel con selección+autorizar+
 * liquidar agregado aquí; ViaticosPorPagarPanel sin cambios).
 *
 * Programación conserva "Viáticos del viaje" solo para definir el monto
 * mientras el viático está PROGRAMADO (ver viaticos-panel.tsx) — autorizar/
 * pagar/liquidar viven únicamente aquí, para no duplicar la UX de acciones
 * en dos pantallas distintas.
 *
 * TMS / Logística ya no repite este listado (antes "Control de Viáticos" +
 * "Viáticos por pagar"): solo conserva la configuración de montos por
 * puesto y un enlace hacia esta página.
 */
export default function ViaticosPage() {
  const slug = String(useParams().slug);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Viáticos</h1>
        <p className="text-sm text-[var(--muted)]">
          Administración de viáticos de todos los viajes: autorizar, pagar/entregar y liquidar.
          Para definir o ajustar el monto de un viático mientras está Programado, hazlo desde{" "}
          <Link href={`/e/${slug}/programacion`} className="text-[var(--accent)] underline">
            Operaciones → Programación
          </Link>
          , dentro del viaje correspondiente.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
          Listado general
        </h2>
        <ViaticosControlPanel slug={slug} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
          Viáticos por pagar (facturador)
        </h2>
        <ViaticosPorPagarPanel slug={slug} />
      </section>
    </div>
  );
}
