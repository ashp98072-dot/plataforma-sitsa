import { destinoPagoEmpleado } from "./destino-pago-empleado";
export type LineaSeleccionFondo = {
  metodoPago?: string;
  planId: string; clienteId: string; fechaViaje: string; vehiculoId: string; empleadoId: string;
  empleadoNombre: string; cuenta: string; cargo: string;
};
export type PlanSeleccionFondo = {
  id: number; clienteId: number | null; fechaPlan: string; vehiculoId: number | null; empleadoId: number | null;
  empleadoNombre: string | null; empleadoCuenta: string | null; empleadoPuesto: string | null;
  empleadoTelefono?: string | null;
};
export type EmpleadoSeleccionFondo = {
  id: number; nombre: string; cuentaBancaria: string | null; puesto: string | null;
  telefono?: string | null;
};

/** Sugiere los datos vigentes de RRHH al cambiar explícitamente de empleado. */
export function aplicarEmpleadoSeleccionado(
  linea: LineaSeleccionFondo,
  empleado: EmpleadoSeleccionFondo | undefined,
  value: string,
): LineaSeleccionFondo {
  return {
    ...linea,
    empleadoId: value,
    empleadoNombre: empleado?.nombre ?? "",
    cuenta: linea.metodoPago === undefined ? empleado?.cuentaBancaria ?? "" : destinoPagoEmpleado(linea.metodoPago, empleado),
    cargo: empleado?.puesto ?? "",
  };
}

/** Reflejo client-side del autocompletado; el servidor continúa siendo la autoridad final. */
export function aplicarPlanSeleccionado(
  linea: LineaSeleccionFondo,
  plan: PlanSeleccionFondo | undefined,
  value: string,
  empleado: EmpleadoSeleccionFondo | undefined,
): LineaSeleccionFondo {
  const empleadoDelPlan = empleado && plan?.empleadoId === empleado.id ? empleado : undefined;
  return {
    ...linea,
    planId: value,
    clienteId: plan?.clienteId ? String(plan.clienteId) : "",
    fechaViaje: plan?.fechaPlan ?? "",
    vehiculoId: plan?.vehiculoId ? String(plan.vehiculoId) : "",
    empleadoId: plan?.empleadoId ? String(plan.empleadoId) : "",
    empleadoNombre: empleadoDelPlan ? empleadoDelPlan.nombre : plan?.empleadoNombre ?? "",
    cuenta: linea.metodoPago === undefined ? (empleadoDelPlan ? empleadoDelPlan.cuentaBancaria ?? "" : plan?.empleadoCuenta ?? "") : destinoPagoEmpleado(linea.metodoPago, empleadoDelPlan ?? { cuentaBancaria: plan?.empleadoCuenta, telefono: plan?.empleadoTelefono }),
    cargo: empleadoDelPlan ? empleadoDelPlan.puesto ?? "" : plan?.empleadoPuesto ?? "",
  };
}
