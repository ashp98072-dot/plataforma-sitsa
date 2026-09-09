export type LineaSeleccionFondo = { planId: string; clienteId: string; fechaViaje: string };
export type PlanSeleccionFondo = { id: number; clienteId: number | null; fechaPlan: string };

/** Reflejo client-side del autocompletado; el servidor continúa siendo la autoridad final. */
export function aplicarPlanSeleccionado(linea: LineaSeleccionFondo, plan: PlanSeleccionFondo | undefined, value: string): LineaSeleccionFondo {
  return {
    ...linea,
    planId: value,
    clienteId: plan?.clienteId ? String(plan.clienteId) : linea.clienteId,
    fechaViaje: !linea.fechaViaje && plan?.fechaPlan ? plan.fechaPlan : linea.fechaViaje,
  };
}
