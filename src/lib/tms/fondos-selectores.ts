export type LineaSeleccionFondo = {
  planId: string; clienteId: string; fechaViaje: string; vehiculoId: string; empleadoId: string;
  empleadoNombre: string; cuenta: string; cargo: string;
};
export type PlanSeleccionFondo = {
  id: number; clienteId: number | null; fechaPlan: string; vehiculoId: number | null; empleadoId: number | null;
  empleadoNombre: string | null; empleadoCuenta: string | null; empleadoPuesto: string | null;
};

/** Reflejo client-side del autocompletado; el servidor continúa siendo la autoridad final. */
export function aplicarPlanSeleccionado(linea: LineaSeleccionFondo, plan: PlanSeleccionFondo | undefined, value: string): LineaSeleccionFondo {
  return {
    ...linea,
    planId: value,
    clienteId: plan?.clienteId ? String(plan.clienteId) : "",
    fechaViaje: plan?.fechaPlan ?? "",
    vehiculoId: plan?.vehiculoId ? String(plan.vehiculoId) : "",
    empleadoId: plan?.empleadoId ? String(plan.empleadoId) : "",
    empleadoNombre: plan?.empleadoNombre ?? "",
    cuenta: plan?.empleadoCuenta ?? "",
    cargo: plan?.empleadoPuesto ?? "",
  };
}
