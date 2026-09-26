/**
 * PROGRAMACIÓN — datos de un viaje TERCERIZADO en el formulario (funciones PURAS, testeables sin React).
 *
 * - `precargaTipoViajeDesdePlan(plan)`: lo que el formulario muestra al ABRIR la edición (piloto externo, auxiliares externos con sus saltos de
 *   línea, unidad/placa externa, descripción, transportista, TC externo y costo).
 * - `payloadTipoViaje(form)`: lo que el formulario ENVÍA al guardar (mismo shape que espera patchTipoViaje / POST).
 * Ida y vuelta: guardar y reabrir devuelve los mismos datos. Todo es texto externo: nunca se convierte en empleados de RRHH.
 */
export type PlanTipoViajeEntrada = {
  tipo_viaje?: string | null;
  piloto_externo_nombre?: string | null;
  auxiliares_externos?: string | null;
  unidad_externa_placa?: string | null;
  unidad_externa_descripcion?: string | null;
  transportista_externo?: string | null;
  tc?: string | null;
  tc_externo_placa?: string | null;
  costo_tercerizado?: number | null;
};

export type FormTipoViaje = {
  tipoViaje: "Propio" | "Tercerizado";
  pilotoExternoNombre: string;
  /** Un nombre por línea (los saltos de línea se conservan). */
  auxiliaresExternosTexto: string;
  unidadExternaPlaca: string;
  unidadExternaDescripcion: string;
  transportistaExterno: string;
  tcExternoPlaca: string;
  costoTercerizado: string;
};

export function precargaTipoViajeDesdePlan(plan: PlanTipoViajeEntrada | null | undefined): FormTipoViaje {
  const terc = plan?.tipo_viaje === "Tercerizado";
  return {
    tipoViaje: terc ? "Tercerizado" : "Propio",
    pilotoExternoNombre: plan?.piloto_externo_nombre ?? "",
    auxiliaresExternosTexto: plan?.auxiliares_externos ?? "",
    unidadExternaPlaca: plan?.unidad_externa_placa ?? "",
    unidadExternaDescripcion: plan?.unidad_externa_descripcion ?? "",
    transportistaExterno: plan?.transportista_externo ?? "",
    tcExternoPlaca: terc ? (plan?.tc_externo_placa ?? "") : "",
    costoTercerizado: plan?.costo_tercerizado != null ? String(plan.costo_tercerizado) : "",
  };
}

export function payloadTipoViaje(form: FormTipoViaje) {
  const terc = form.tipoViaje === "Tercerizado";
  return {
    tipoViaje: form.tipoViaje,
    pilotoExternoNombre: terc ? form.pilotoExternoNombre.trim() || undefined : undefined,
    auxiliaresExternos: terc ? form.auxiliaresExternosTexto.split(/\r?\n/).map((n) => n.trim()).filter(Boolean).slice(0, 8) : undefined,
    unidadExternaPlaca: terc ? form.unidadExternaPlaca.trim() || undefined : undefined,
    unidadExternaDescripcion: terc ? form.unidadExternaDescripcion.trim() || undefined : undefined,
    transportistaExterno: terc ? form.transportistaExterno.trim() || undefined : undefined,
    tcExternoPlaca: terc ? form.tcExternoPlaca.trim().toUpperCase() || undefined : undefined,
    costoTercerizado: terc && form.costoTercerizado !== "" ? Number(form.costoTercerizado) : undefined,
  };
}
